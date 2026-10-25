import { create } from "zustand";
import type { SceneEntity } from "../../data/scene";
import { applySceneEdit, sceneLifecycle, useProject } from "../project/store";
import { isTrashed } from "../project/model";
import { validateEntityExtensions } from "../project/validation";
import { applyCommand, type EntityDelta, type SceneCommand } from "./commands";
import { type Bounds, type Camera, scales } from "./geometry";
import {
  emptyBackground,
  entityLayerPatch,
  layerEntity,
  validateBackground,
  type BackgroundLayer,
} from "../backgrounds/model";
import type { BackgroundDelta, EditorTarget } from "./commands";
export type ParallaxPreview = {
  playing: boolean;
  elapsed: number;
  startedAt: number;
  cameraBefore: Camera | null;
};

export type Tool = "move" | "rotate" | "scale";
export type EditorSettings = {
  grid: boolean;
  gridSize: number;
  snap: boolean;
  angleSnap: boolean;
  angleStep: number;
  aspect: boolean;
  maxCommands: number;
  memoryMiB: number;
};
const defaults: EditorSettings = {
  grid: true,
  gridSize: 32,
  snap: false,
  angleSnap: false,
  angleStep: 15,
  aspect: true,
  maxCommands: 100,
  memoryMiB: 16,
};
function readSettings(): EditorSettings {
  try {
    const raw = JSON.parse(
      localStorage.getItem("awalem-editor-settings") ?? "{}",
    );
    return validSettings({ ...defaults, ...raw });
  } catch {
    return { ...defaults };
  }
}
function validSettings(s: EditorSettings): EditorSettings {
  if (
    !["grid", "snap", "angleSnap", "aspect"].every(
      (k) => typeof s[k as keyof EditorSettings] === "boolean",
    ) ||
    !Number.isFinite(s.gridSize) ||
    s.gridSize < 1 ||
    s.gridSize > 10000 ||
    !Number.isFinite(s.angleStep) ||
    s.angleStep < 1 ||
    s.angleStep > 180 ||
    !Number.isInteger(s.maxCommands) ||
    s.maxCommands < 1 ||
    s.maxCommands > 10000 ||
    !Number.isFinite(s.memoryMiB) ||
    s.memoryMiB < 1 ||
    s.memoryMiB > 256
  )
    throw new Error("Invalid editor settings.");
  return s;
}
export type SceneSession = {
  selectedIds: string[];
  target?: EditorTarget | null;
  preview?: ParallaxPreview | null;
  undo: SceneCommand[];
  redo: SceneCommand[];
  camera: Camera | null;
  bounds: Record<string, Bounds>;
  viewRequest: number;
  viewMode: "fit" | "reset";
};
export const EMPTY_SESSION: SceneSession = {
  selectedIds: [],
  undo: [],
  redo: [],
  camera: null,
  bounds: {},
  viewRequest: 0,
  viewMode: "fit",
};
type Gesture = {
  sceneKey: string;
  id: string;
  before: SceneEntity;
  patch: Partial<SceneEntity>;
  label: string;
  source: "pointer" | "inspector";
  valid: boolean;
  layerBefore?: BackgroundLayer;
  layerPatch?: Partial<BackgroundLayer>;
};
type EditorState = {
  rename: { sceneKey: string; id: string } | null;
  sessions: Record<string, SceneSession>;
  tool: Tool;
  settings: EditorSettings;
  gesture: Gesture | null;
  message: string;
};
export const useEditor = create<EditorState>(() => ({
  rename: null,
  sessions: {},
  tool: "move",
  settings: readSettings(),
  gesture: null,
  message: "",
}));
let sequence = 0;
export const session = (key: string) =>
  useEditor.getState().sessions[key] ?? EMPTY_SESSION;
function updateSession(key: string, patch: Partial<SceneSession>) {
  useEditor.setState((s) => ({
    sessions: {
      ...s.sessions,
      [key]: { ...(s.sessions[key] ?? EMPTY_SESSION), ...patch },
    },
  }));
}
export function sceneRecord(key: string) {
  const p = useProject.getState().project,
    r = p?.records[key];
  if (!p || r?.kind !== "scene" || isTrashed(p, key))
    throw new Error("This scene is unavailable.");
  return r;
}
export function effectiveEntity(
  key: string,
  id: string,
): SceneEntity | undefined {
  const entity = sceneRecord(key).scene.entities.find((e) => e.id === id),
    gesture = useEditor.getState().gesture;
  return entity && gesture?.sceneKey === key && gesture.id === id
    ? { ...entity, ...gesture.patch }
    : entity;
}
export function selectEntity(key: string, id: string | null) {
  finishGesture();
  const p = useProject.getState().project;
  if (id && !sceneRecord(key).scene.entities.some((e) => e.id === id)) return;
  updateSession(key, {
    selectedIds: id ? [id] : [],
    target: id ? { kind: "entity", id } : null,
  });
  if (p?.active_scene_key === key && p.selected_key !== key) {
    // Focus metadata changes are UI state, not authored content or history.
    useProject.setState({ project: { ...p, selected_key: key } });
  }
}
export function setTool(tool: Tool) {
  finishGesture();
  useEditor.setState({ tool });
}
export function setCamera(key: string, camera: Camera) {
  updateSession(key, { camera });
}
export function requestView(key: string, mode: "fit" | "reset") {
  finishGesture();
  updateSession(key, {
    viewMode: mode,
    viewRequest: session(key).viewRequest + 1,
  });
}
export function setBounds(key: string, bounds: Record<string, Bounds>) {
  if (JSON.stringify(session(key).bounds) !== JSON.stringify(bounds))
    updateSession(key, { bounds });
}
export function setSettings(patch: Partial<EditorSettings>) {
  const settings = validSettings({
    ...useEditor.getState().settings,
    ...patch,
  });
  useEditor.setState({ settings });
  try {
    localStorage.setItem("awalem-editor-settings", JSON.stringify(settings));
  } catch {
    /* Presentation preferences are optional. */
  }
  trimHistory();
}
function trimHistory() {
  const { settings } = useEditor.getState(),
    sessions = { ...useEditor.getState().sessions };
  let pruned = false;
  for (const [key, s] of Object.entries(sessions)) {
    let undo = [...s.undo],
      redo = [...s.redo];
    while (undo.length + redo.length > settings.maxCommands) {
      if (undo.length) undo.shift();
      else redo = [];
      pruned = true;
    }
    sessions[key] = { ...s, undo, redo };
  }
  const bytes = () =>
    Object.values(sessions).reduce(
      (sum, s) => sum + [...s.undo, ...s.redo].reduce((n, c) => n + c.bytes, 0),
      0,
    );
  while (bytes() > settings.memoryMiB * 1024 * 1024) {
    const oldest = Object.entries(sessions)
      .flatMap(([key, s]) => [
        ...s.undo.map((c) => ({ key, c, stack: "undo" as const })),
        ...s.redo.map((c) => ({ key, c, stack: "redo" as const })),
      ])
      .sort((a, b) => a.c.sequence - b.c.sequence)[0];
    if (!oldest) break;
    const s = sessions[oldest.key];
    sessions[oldest.key] = {
      ...s,
      [oldest.stack]:
        oldest.stack === "redo" ? [] : s.undo.filter((c) => c !== oldest.c),
    };
    pruned = true;
  }
  useEditor.setState({
    sessions,
    ...(pruned
      ? {
          message:
            "Oldest undo history was removed to respect the memory budget.",
        }
      : {}),
  });
}
function safely(job: () => void) {
  try {
    job();
    return true;
  } catch (error) {
    useEditor.setState({
      message: error instanceof Error ? error.message : "Scene edit failed.",
    });
    return false;
  }
}
export function execute(
  key: string,
  label: string,
  changes: EntityDelta[],
  selectedAfter = session(key).selectedIds,
  background?: BackgroundDelta,
  targetAfter: EditorTarget | null = selectedAfter[0]
    ? { kind: "entity", id: selectedAfter[0] }
    : null,
) {
  if (
    (!background ||
      JSON.stringify(background.before) === JSON.stringify(background.after)) &&
    changes.every((c) => JSON.stringify(c.before) === JSON.stringify(c.after))
  )
    return true;
  return safely(() => {
    if (session(key).preview)
      throw new Error("Stop the parallax preview before editing.");
    for (const c of changes)
      if (
        c.before?.locked &&
        (!c.after ||
          Object.keys({ ...c.before, ...c.after }).some(
            (k) =>
              !["visible", "locked"].includes(k) &&
              JSON.stringify(c.before![k as keyof SceneEntity]) !==
                JSON.stringify(c.after![k as keyof SceneEntity]),
          ))
      )
        throw new Error("Unlock this object before editing it.");
    const s = session(key),
      command: SceneCommand = {
        label,
        changes: structuredClone(changes),
        sequence: ++sequence,
        bytes: 0,
        selectedBefore: s.selectedIds.slice(0, 1),
        selectedAfter: selectedAfter.slice(0, 1),
        ...(background ? { background: structuredClone(background) } : {}),
        targetBefore:
          s.target ??
          (s.selectedIds[0] ? { kind: "entity", id: s.selectedIds[0] } : null),
        targetAfter,
      };
    command.bytes = JSON.stringify(command).length * 2;
    applySceneEdit(key, (scene) => applyCommand(scene, command));
    updateSession(key, {
      undo: [...s.undo, command],
      redo: [],
      selectedIds: [...selectedAfter].slice(0, 1),
      target: targetAfter,
    });
    useEditor.setState({ message: "" });
    trimHistory();
  });
}
export function beginGesture(
  key: string,
  id: string,
  label: string,
  source: Gesture["source"] = "pointer",
) {
  finishGesture();
  if (session(key).preview) return false;
  const before = sceneRecord(key).scene.entities.find((e) => e.id === id);
  if (!before || (before.locked && !["Visibility", "Lock"].includes(label)))
    return false;
  useEditor.setState({
    gesture: {
      sceneKey: key,
      id,
      before: structuredClone(before),
      patch: {},
      label,
      source,
      valid: true,
    },
    message: "",
  });
  return true;
}
export function previewGesture(patch: Partial<SceneEntity>) {
  const g = useEditor.getState().gesture;
  if (!g) return;
  if (g.layerBefore) {
    previewLayerGesture(entityLayerPatch(patch));
    return;
  }
  const next = { ...g.before, ...g.patch, ...patch };
  if (
    !safely(() => {
      if (
        !["x", "y", "scale", "rotation", "depth"].every((k) =>
          Number.isFinite(next[k as keyof SceneEntity]),
        ) ||
        next.scale <= 0
      )
        throw new Error("Transform values must remain finite.");
      validateEntityExtensions(next as unknown as Record<string, unknown>);
    })
  ) {
    invalidateGesture();
    return;
  }
  useEditor.setState({
    gesture: { ...g, patch: { ...g.patch, ...patch }, valid: true },
  });
}
export function invalidateGesture() {
  const g = useEditor.getState().gesture;
  if (g) useEditor.setState({ gesture: { ...g, valid: false } });
}
export function cancelGesture() {
  useEditor.setState({ gesture: null });
}
export function finishGesture() {
  const g = useEditor.getState().gesture;
  if (!g) return;
  useEditor.setState({ gesture: null });
  if (!g.valid) return;
  safely(() => {
    if (g.layerBefore) {
      const before = sceneRecord(g.sceneKey).scene.background;
      if (
        !before ||
        JSON.stringify(before.layers.find((l) => l.id === g.id)) !==
          JSON.stringify(g.layerBefore)
      )
        throw new Error("Layer changed during editing.");
      execute(
        g.sceneKey,
        g.label,
        [],
        [],
        {
          before,
          after: {
            ...before,
            layers: before.layers.map((l) =>
              l.id === g.id ? { ...l, ...g.layerPatch } : l,
            ),
          },
        },
        { kind: "background", id: g.id },
      );
      return;
    }
    const index = sceneRecord(g.sceneKey).scene.entities.findIndex(
      (e) => e.id === g.id,
    );
    execute(g.sceneKey, g.label, [
      { id: g.id, before: g.before, after: { ...g.before, ...g.patch }, index },
    ]);
  });
}
export function patchEntity(
  key: string,
  id: string,
  patch: Partial<SceneEntity>,
  label = "Edit object",
) {
  finishSceneGesture(key);
  return safely(() => {
    const scene = sceneRecord(key).scene,
      index = scene.entities.findIndex((e) => e.id === id),
      before = scene.entities[index];
    if (!before) throw new Error("Object no longer exists.");
    if (
      before.locked &&
      Object.keys(patch).some((k) => !["visible", "locked"].includes(k))
    )
      throw new Error("Unlock this object before editing it.");
    if (
      !execute(key, label, [
        { id, before, after: { ...before, ...patch }, index },
      ])
    )
      throw new Error(useEditor.getState().message);
  });
}
export function addEntity(key: string, entity: SceneEntity) {
  finishSceneGesture(key);
  return execute(
    key,
    "Create object",
    [
      {
        id: entity.id,
        before: null,
        after: entity,
        index: sceneRecord(key).scene.entities.length,
      },
    ],
    [entity.id],
  );
}
export function removeEntity(key: string, id: string) {
  finishSceneGesture(key);
  const scene = sceneRecord(key).scene,
    index = scene.entities.findIndex((e) => e.id === id),
    before = scene.entities[index];
  if (!before || before.locked) {
    useEditor.setState({ message: "Unlock this object before deleting it." });
    return false;
  }
  return execute(
    key,
    "Delete object",
    [{ id, before, after: null, index }],
    [],
  );
}
export function duplicateEntity(key: string, id: string) {
  finishSceneGesture(key);
  const e = effectiveEntity(key, id);
  if (!e || e.locked) {
    useEditor.setState({
      message: "Unlock this object before duplicating it.",
    });
    return;
  }
  addEntity(key, {
    ...structuredClone(e),
    id: crypto.randomUUID(),
    name: `${e.name} copy`,
    x: e.x + 32,
    y: e.y + 32,
  });
}
export function reorderEntity(key: string, id: string, front: boolean) {
  finishSceneGesture(key);
  const entity = effectiveEntity(key, id);
  if (!entity) return;
  const values = sceneRecord(key)
    .scene.entities.filter((e) => e.layer === entity.layer && e.id !== id)
    .map((e) => e.y + e.depth);
  const z = values.length
    ? front
      ? Math.max(...values) + 1
      : Math.min(...values) - 1
    : entity.y + entity.depth;
  patchEntity(
    key,
    id,
    { depth: z - entity.y },
    front ? "Bring to front" : "Send to back",
  );
}
export function undo(key: string) {
  finishSceneGesture(key);
  replay(key, true);
}
export function redo(key: string) {
  finishSceneGesture(key);
  replay(key, false);
}
function finishSceneGesture(key: string) {
  if (useEditor.getState().gesture?.sceneKey === key) finishGesture();
}
function replay(key: string, reverse: boolean) {
  safely(() => {
    if (session(key).preview)
      throw new Error("Stop the parallax preview before editing.");
    const s = session(key),
      from = reverse ? s.undo : s.redo,
      command = from.at(-1);
    if (!command) return;
    applySceneEdit(key, (scene) => applyCommand(scene, command, reverse));
    updateSession(key, {
      undo: reverse ? s.undo.slice(0, -1) : [...s.undo, command],
      redo: reverse ? [...s.redo, command] : s.redo.slice(0, -1),
      selectedIds: reverse ? command.selectedBefore : command.selectedAfter,
      target: (reverse ? command.targetBefore : command.targetAfter) ?? null,
    });
  });
}
export function resetEditor() {
  cancelGesture();
  useEditor.setState({ sessions: {}, message: "", rename: null });
}
export function requestRename(key: string) {
  finishSceneGesture(key);
  const id = session(key).selectedIds[0],
    entity = id && effectiveEntity(key, id);
  if (entity && !entity.locked)
    useEditor.setState({ rename: { sceneKey: key, id: entity.id } });
}
sceneLifecycle.finish = finishGesture;
sceneLifecycle.beforeReplace = () => {
  if (useEditor.getState().gesture)
    throw new Error(
      "Finish or cancel the current edit before replacing the project.",
    );
};
sceneLifecycle.reset = resetEditor;
sceneLifecycle.patchEntity = (key, id, patch) => {
  patchEntity(key, id, patch);
};
// Also used when the production access gate closes the editor.
export const disposeEditorSession = cancelGesture;
export const scalePatch = (
  entity: SceneEntity,
  axis: "x" | "y",
  value: number,
  aspect: boolean,
): Partial<SceneEntity> => {
  const s = scales(entity),
    ratio = value / s[axis];
  const x = axis === "x" ? value : aspect ? s.x * ratio : s.x,
    y = axis === "y" ? value : aspect ? s.y * ratio : s.y;
  return { scale: x, scaleX: x, scaleY: y };
};

export function selectLayer(key: string, id: string) {
  selectEntity(key, null);
  if (sceneRecord(key).scene.background?.layers.some((l) => l.id === id))
    updateSession(key, { target: { kind: "background", id } });
}
export function effectiveBackground(key: string) {
  const b = sceneRecord(key).scene.background ?? emptyBackground(),
    g = useEditor.getState().gesture;
  return g?.sceneKey === key && g.layerBefore
    ? {
        ...b,
        layers: b.layers.map((l) =>
          l.id === g.id ? { ...l, ...g.layerPatch } : l,
        ),
      }
    : b;
}
export function beginLayerGesture(
  key: string,
  id: string,
  label: string,
  source: Gesture["source"] = "inspector",
) {
  finishGesture();
  const l = sceneRecord(key).scene.background?.layers.find((l) => l.id === id);
  if (!l || l.locked || session(key).preview) return false;
  useEditor.setState({
    gesture: {
      sceneKey: key,
      id,
      label,
      source,
      before: layerEntity(l),
      patch: {},
      valid: true,
      layerBefore: structuredClone(l),
      layerPatch: {},
    },
  });
  return true;
}
export function previewLayerGesture(patch: Partial<BackgroundLayer>) {
  const g = useEditor.getState().gesture;
  if (!g?.layerBefore) return;
  const layerPatch = { ...g.layerPatch, ...patch };
  if (
    !safely(() =>
      validateBackground({
        version: 1,
        showWorldArtwork: true,
        layers: [{ ...g.layerBefore, ...layerPatch }],
      }),
    )
  ) {
    invalidateGesture();
    return;
  }
  useEditor.setState({
    gesture: {
      ...g,
      layerPatch,
      patch: {
        ...g.patch,
        ...layerEntity({ ...g.layerBefore, ...layerPatch }),
      },
      valid: true,
    },
  });
}
export function setParallaxPreview(
  key: string,
  action: "play" | "pause" | "stop",
) {
  finishGesture();
  const s = session(key),
    old = s.preview;
  if (action === "stop") {
    updateSession(key, {
      preview: null,
      ...(old ? { camera: old.cameraBefore } : {}),
    });
    return;
  }
  const now = performance.now();
  updateSession(key, {
    preview: {
      playing: action === "play",
      elapsed: old
        ? old.elapsed + (old.playing ? (now - old.startedAt) / 1000 : 0)
        : 0,
      startedAt: now,
      cameraBefore: old ? old.cameraBefore : s.camera,
    },
  });
}
