import { create } from "zustand";
import type { SceneDocument, SceneEntity } from "../../data/scene";
import { localDrafts } from "../../lib/repositories/local";
import { seedProject } from "./migrations";
import { isTrashed, type ProjectSnapshot } from "./model";
import { markChanged } from "./commands";
import { validateProject, validateScene } from "./validation";

/** Registered by the scene editor, keeping project persistence independent of PixiJS. */
export const sceneLifecycle: {
  finish?: () => void;
  beforeReplace?: () => void;
  reset?: () => void;
  patchEntity?: (key: string, id: string, patch: Partial<SceneEntity>) => void;
} = {};

type ProjectStore = {
  project: ProjectSnapshot | null;
  ready: boolean;
  localStatus: "saving" | "saved" | "error";
  localError: string;
  notice: string;
  mutation: number;
  storageBlocked: boolean;
  change: (job: (project: ProjectSnapshot) => void) => void;
  select: (key: string) => Promise<void>;
  toggle: (key: string) => void;
  editEntity: (
    sceneKey: string,
    id: string,
    patch: Partial<SceneEntity>,
  ) => void;
};
let pending: ProjectSnapshot | null = null;
let writing: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let selectionRequest = 0;
export const useProject = create<ProjectStore>((set, get) => ({
  project: null,
  ready: false,
  localStatus: "saving",
  localError: "",
  notice: "",
  mutation: 0,
  storageBlocked: false,
  change(job) {
    sceneLifecycle.finish?.();
    const current = get().project;
    if (!current) return;
    try {
      const next = structuredClone(current);
      job(next);
      set({ project: next, mutation: get().mutation + 1, notice: "" });
      scheduleDraft(next);
    } catch (error) {
      set({
        notice: error instanceof Error ? error.message : "Action failed.",
      });
    }
  },
  async select(key) {
    sceneLifecycle.finish?.();
    const request = ++selectionRequest;
    try {
      await flushDraft();
    } catch {
      /* The warning stays visible; in-memory scenes remain independent. */
    }
    if (request !== selectionRequest) return;
    const p = get().project;
    if (!p || !p.records[key] || isTrashed(p, key)) return;
    const next = {
      ...p,
      selected_key: key,
      active_scene_key:
        p.records[key].kind === "scene" ? key : p.active_scene_key,
    };
    set({ project: next });
    scheduleDraft(next);
  },
  toggle(key) {
    const p = get().project;
    if (!p) return;
    const next = {
      ...p,
      expanded: p.expanded.includes(key)
        ? p.expanded.filter((x) => x !== key)
        : [...p.expanded, key],
    };
    set({ project: next });
    scheduleDraft(next);
  },
  editEntity(sceneKey, id, patch) {
    if (sceneLifecycle.patchEntity) {
      sceneLifecycle.patchEntity(sceneKey, id, patch);
      return;
    }
    get().change((p) => {
      const scene = p.records[sceneKey];
      if (scene?.kind !== "scene" || isTrashed(p, sceneKey)) return;
      if (
        Object.values(patch).some(
          (value) => typeof value === "number" && !Number.isFinite(value),
        )
      )
        throw new Error("Enter a finite numeric value.");
      scene.scene.entities = scene.scene.entities.map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      );
      markChanged(p, scene);
    });
  },
}));
function scheduleDraft(project: ProjectSnapshot) {
  if (useProject.getState().storageBlocked) return;
  pending = project;
  useProject.setState({ localStatus: "saving" });
  clearTimeout(timer);
  timer = setTimeout(() => {
    void flushDraft().catch(() => {});
  }, 160);
}
export async function flushDraft(): Promise<void> {
  clearTimeout(timer);
  if (writing) {
    await writing;
    if (pending) return flushDraft();
    return;
  }
  if (!pending) return;
  const snapshot = pending;
  pending = null;
  writing = localDrafts
    .write(snapshot)
    .then(() => {
      useProject.setState({
        localStatus: pending ? "saving" : "saved",
        localError: "",
      });
    })
    .catch((error) => {
      pending ??= snapshot;
      useProject.setState({
        localStatus: "error",
        localError:
          error instanceof Error ? error.message : "Local draft save failed.",
      });
      throw error;
    })
    .finally(() => {
      writing = null;
    });
  await writing;
  if (pending) return flushDraft();
}
let initialization: Promise<void> | undefined;
export function initializeProject() {
  return (initialization ??= (async () => {
    try {
      const raw = await localDrafts.read();
      if (raw !== undefined) {
        const project = validateProject(raw);
        useProject.setState({ project, ready: true, localStatus: "saved" });
        return;
      }
      const { project, warnings, legacyRecovery } = seedProject(
        window.localStorage,
      );
      if (Object.keys(legacyRecovery).length)
        await localDrafts.backup(
          { format: "awalem-legacy-recovery", values: legacyRecovery },
          "Unmigrated legacy scene data — export to recover source",
        );
      useProject.setState({
        project,
        ready: true,
        notice: warnings.join("\n"),
      });
      scheduleDraft(project);
      await flushDraft();
    } catch (error) {
      const project = useProject.getState().project ?? seedProject().project;
      useProject.setState({
        project,
        ready: true,
        storageBlocked: true,
        localStatus: "error",
        localError: `${error instanceof Error ? error.message : "Cannot read local drafts."} Original stored data was retained. Current edits are in memory; export a backup.`,
      });
    }
  })());
}
export async function replaceFromCloud(
  project: ProjectSnapshot,
  expectedMutation: number,
) {
  sceneLifecycle.beforeReplace?.();
  if (useProject.getState().mutation !== expectedMutation)
    throw new Error(
      "Local content changed while cloud data was loading. Nothing was replaced; retry the load.",
    );
  const current = useProject.getState().project!;
  await flushDraft();
  await localDrafts.backup(current, "Before explicit cloud load");
  if (useProject.getState().mutation !== expectedMutation)
    throw new Error(
      "Local content changed while backing up. Nothing was replaced.",
    );
  const latest = useProject.getState().project!;
  const selected = latest.selected_key;
  const active = latest.active_scene_key;
  project.selected_key =
    selected && project.records[selected] && !isTrashed(project, selected)
      ? selected
      : null;
  project.active_scene_key =
    active &&
    project.records[active]?.kind === "scene" &&
    !isTrashed(project, active)
      ? active
      : null;
  project.expanded = latest.expanded;
  validateProject(project);
  sceneLifecycle.reset?.();
  useProject.setState({ project, mutation: expectedMutation + 1 });
  scheduleDraft(project);
  await flushDraft();
}
/** Copy only the edited scene and record map; never clone the entire project per transform. */
export function applySceneEdit(
  key: string,
  edit: (scene: SceneDocument) => SceneDocument,
) {
  const current = useProject.getState().project,
    record = current?.records[key];
  if (!current || record?.kind !== "scene" || isTrashed(current, key))
    throw new Error("This scene is unavailable.");
  const scene = validateScene(
    edit(record.scene),
    record.world_id,
    record.volume_id!,
    record.id,
  );
  const nextRecord = { ...record, scene, generation: record.generation + 1 };
  const project = {
    ...current,
    records: { ...current.records, [key]: nextRecord },
    dirty: current.dirty.includes(key)
      ? current.dirty
      : [...current.dirty, key],
  };
  useProject.setState({
    project,
    mutation: useProject.getState().mutation + 1,
    notice: "",
  });
  scheduleDraft(project);
}
export function persistProjectState(project: ProjectSnapshot) {
  useProject.setState({ project });
  scheduleDraft(project);
}
