import { useEffect, useRef, useState } from "react";
import type { SceneEntity, Shape } from "./data/scene";
import { uploadSprite } from "./lib/cloud";
import { requireStudioAdmin, useStudioAuth } from "./lib/studioAuth";
import {
  acknowledgeSaves,
  cloudError,
  FirestoreProjectRepository,
} from "./lib/repositories/firestore";
import { localDrafts } from "./lib/repositories/local";
import SceneViewport from "./components/SceneViewport";
import EntityInspector from "./components/EntityInspector";
import FirebasePanel from "./components/FirebasePanel";
import PanelDivider, { readPanelSize } from "./components/PanelDivider";
import ProjectExplorer from "./features/project/ProjectExplorer";
import ItemInspector from "./features/project/ItemInspector";
import Dialog from "./features/project/Dialog";
import Recovery from "./features/project/Recovery";
import { downloadJson } from "./features/project/export";
import {
  flushDraft,
  initializeProject,
  persistProjectState,
  replaceFromCloud,
  useProject,
} from "./features/project/store";
import { addAsset } from "./features/project/commands";
import {
  isTrashed,
  volumeKey,
  type AssetRecord,
} from "./features/project/model";
import AssetBrowser from "./features/assets/AssetBrowser";
import { imageDimensions, missingReferences } from "./features/assets/catalog";
import StudioAccess from "./components/StudioAccess";
import Toolbar from "./features/editor/Toolbar";
import SceneHierarchy from "./features/editor/SceneHierarchy";
import MissionSetup from "./features/editor/MissionSetup";
import {
  addEntity as createSceneEntity,
  cancelGesture,
  effectiveEntity,
  EMPTY_SESSION,
  finishGesture,
  selectEntity,
  useEditor,
} from "./features/editor/store";
import { editorShortcuts } from "./features/editor/shortcuts";
import BackgroundPanel from "./features/backgrounds/BackgroundPanel";
import BackgroundInspector from "./features/backgrounds/BackgroundInspector";
import {
  assignBackgroundAsset,
  type AssetAction,
} from "./features/backgrounds/commands";
import { effectiveBackground, session } from "./features/editor/store";
type BackgroundPicker = { sceneKey: string; action: AssetAction; id?: string };

const availableShapes: Shape[] = [
  "fish",
  "coral",
  "bird",
  "plant",
  "rock",
  "crystal",
  "hotspot",
];
const colors: Record<Shape, string> = {
  fish: "#ffd16f",
  coral: "#fc8d9e",
  bird: "#f6b968",
  plant: "#63c6a3",
  rock: "#94b0b5",
  crystal: "#bdeaff",
  hotspot: "#ffe5a3",
  image: "#c3e1ff",
};
export default function App() {
  const auth = useStudioAuth();
  if (
    import.meta.env.PROD &&
    (!auth.user || !auth.admin || auth.checking || auth.error)
  )
    return <StudioAccess auth={auth} />;
  return <StudioEditor auth={auth} />;
}

function StudioEditor({ auth }: { auth: ReturnType<typeof useStudioAuth> }) {
  const { project, ready, localStatus, localError, notice, change } =
    useProject();
  const editor = useEditor();
  const [shape, setShape] = useState<Shape>("fish");
  const [status, setStatus] = useState(
    "Local drafts save automatically. Cloud save/load is explicit.",
  );
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<number | null>(null);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [backgroundPicker, setBackgroundPicker] =
    useState<BackgroundPicker | null>(null);
  const [leftWidth, setLeftWidth] = useState(() => readPanelSize("left", 280));
  const [rightWidth, setRightWidth] = useState(() =>
    readPanelSize("right", 270),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const active = project?.active_scene_key
    ? project.records[project.active_scene_key]
    : null;
  const sceneRecord =
    active?.kind === "scene" && project && !isTrashed(project, active.key)
      ? active
      : null;
  const scene = sceneRecord?.scene;
  const selectedLayer =
    sceneRecord && session(sceneRecord.key).target?.kind === "background"
      ? effectiveBackground(sceneRecord.key).layers.find(
          (l) => l.id === session(sceneRecord.key).target?.id,
        )
      : undefined;
  const preview = !!(sceneRecord && session(sceneRecord.key).preview);
  const selectedRecord = project?.selected_key
    ? project.records[project.selected_key]
    : null;
  const selectedId = sceneRecord
    ? ((editor.sessions[sceneRecord.key] ?? EMPTY_SESSION).selectedIds[0] ??
      null)
    : null;
  const selected =
    sceneRecord && selectedId
      ? (effectiveEntity(sceneRecord.key, selectedId) ?? null)
      : null;
  const context = selectedRecord?.volume_id ? selectedRecord : sceneRecord;
  const volume =
    project && context?.volume_id
      ? project.records[volumeKey(context.world_id, context.volume_id)]
      : null;
  const sceneWorld =
    project && sceneRecord
      ? project.records[`studio_worlds/${sceneRecord.world_id}`]
      : null;
  const sceneVolume =
    project && sceneRecord
      ? project.records[volumeKey(sceneRecord.world_id, sceneRecord.volume_id!)]
      : null;
  useEffect(() => {
    void initializeProject();
  }, []);
  useEffect(() => () => cancelGesture(), []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) =>
      editorShortcuts(
        event,
        useProject.getState().project?.active_scene_key ?? null,
      );
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        useProject.getState().localStatus !== "saved" ||
        useEditor.getState().gesture
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const flush = () => {
      void flushDraft().catch(() => {});
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);
  async function withBusy(job: () => Promise<void>) {
    setBusy(true);
    try {
      await job();
    } catch (error) {
      setStatus(cloudError(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  function addEntity(
    newShape: Shape,
    extras: Partial<SceneEntity> = {},
    target = sceneRecord?.key,
  ) {
    if (!target) {
      setStatus("Open a scene before adding an object.");
      return;
    }
    const id = crypto.randomUUID();
    const record = useProject.getState().project?.records[target];
    if (record?.kind !== "scene") return;
    createSceneEntity(target, {
      id,
      name: `${newShape === "image" ? "Sprite" : newShape} ${record.scene.entities.length + 1}`,
      shape: newShape,
      layer: "playfield",
      x: 480,
      y: 375,
      scale: 1,
      rotation: 0,
      depth: 0,
      color: colors[newShape],
      interaction: { type: "none" },
      ...extras,
    });
    if (useProject.getState().project?.active_scene_key === target)
      selectEntity(target, id);
  }
  function useAsset(asset: AssetRecord, position?: { x: number; y: number }) {
    if (!sceneRecord) {
      setStatus("Open a scene before adding this asset.");
      return;
    }
    addEntity("image", {
      name: asset.name,
      assetId: asset.id,
      assetKey: asset.key,
      assetUrl: asset.url,
      ...(asset.storage_path ? { assetPath: asset.storage_path } : {}),
      ...position,
    });
  }
  async function saveCloud() {
    finishGesture();
    await withBusy(async () => {
      const services = await requireStudioAdmin();
      await flushDraft();
      const result = await new FirestoreProjectRepository(services.db).save(
        structuredClone(useProject.getState().project!),
      );
      const current = structuredClone(useProject.getState().project!);
      acknowledgeSaves(current, result.saved);
      persistProjectState(current);
      await flushDraft();
      setStatus(
        result.failures.length
          ? `Saved ${result.saved.length} records. Unsaved scopes: ${result.failures.map((f) => `${f.scope}: ${f.message}`).join(" | ")}`
          : result.saved.length
            ? `Firebase confirmed ${result.saved.length} records. Acknowledged drafts are retained locally.`
            : "No pending changes to save.",
      );
    });
  }
  async function loadCloud() {
    finishGesture();
    setConfirmLoad(false);
    await withBusy(async () => {
      const requestMutation = useProject.getState().mutation;
      const services = await requireStudioAdmin();
      setStatus(
        "Loading cloud project. Local drafts stay available until validation completes…",
      );
      const loaded = await new FirestoreProjectRepository(services.db).load();
      await replaceFromCloud(loaded, requestMutation);
      setStatus(
        "Cloud project loaded. Previous drafts are retained in browser recovery storage. Missing cloud content remains a local starter draft.",
      );
    });
  }
  async function uploadImage(file?: File, backgroundTarget?: BackgroundPicker) {
    finishGesture();
    const destination = backgroundTarget
      ? useProject.getState().project?.records[backgroundTarget.sceneKey]
      : null;
    if (
      backgroundTarget &&
      (!destination ||
        destination.kind !== "scene" ||
        isTrashed(useProject.getState().project!, destination.key))
    ) {
      setStatus("The background destination is unavailable.");
      return;
    }
    if (!file || !context?.volume_id) return;
    const targetWorld = destination?.world_id ?? context.world_id,
      targetVolume = destination?.volume_id ?? context.volume_id;
    const targetScene =
      backgroundTarget?.sceneKey ??
      (sceneRecord?.world_id === targetWorld &&
      sceneRecord?.volume_id === targetVolume
        ? sceneRecord.key
        : null);
    const parent =
      !backgroundTarget &&
      selectedRecord &&
      ["volume", "mission", "folder"].includes(selectedRecord.kind) &&
      selectedRecord.volume_id === targetVolume &&
      selectedRecord.world_id === targetWorld
        ? selectedRecord.key
        : volumeKey(targetWorld, targetVolume);
    await withBusy(async () => {
      await requireStudioAdmin();
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size >= 10 * 1024 * 1024
      )
        throw new Error("Choose a PNG, JPEG, or WebP smaller than 10MB.");
      const dimensions = await imageDimensions(file);
      setProgress(0);
      const uploaded = await uploadSprite(
        file,
        targetWorld,
        targetVolume,
        setProgress,
      );
      let imported: AssetRecord | undefined;
      change((p) => {
        imported = addAsset(p, parent, {
          name: file.name,
          url: uploaded.url,
          storage_path: uploaded.path,
          ...dimensions,
          size: file.size,
          mime: file.type,
        });
      }, false);
      if (!imported) {
        downloadJson(
          {
            ...uploaded,
            ...dimensions,
            name: file.name,
            world_id: targetWorld,
            volume_id: targetVolume,
          },
          "awalem-upload-recovery.json",
        );
        throw new Error(
          "File uploaded, but its destination is unavailable. A recovery receipt was exported; metadata was not saved.",
        );
      }
      const current = useProject.getState().project!;
      if (backgroundTarget && targetScene) {
        if (
          !assignBackgroundAsset(
            targetScene,
            imported,
            backgroundTarget.action,
            backgroundTarget.id,
          )
        )
          throw new Error(
            useEditor.getState().message ||
              "The file is uploaded and cataloged, but could not be assigned.",
          );
        setBackgroundPicker(null);
      } else if (
        targetScene &&
        current.records[targetScene] &&
        !isTrashed(current, targetScene)
      )
        addEntity(
          "image",
          {
            name: file.name,
            assetId: imported.id,
            assetKey: imported.key,
            assetUrl: imported.url,
            assetPath: uploaded.path,
          },
          targetScene,
        );
      await flushDraft();
      setStatus(
        "Image file uploaded to Storage. Asset metadata and scene changes are local drafts; use Save to Firebase to save them.",
      );
    });
  }
  if (!ready || !project)
    return (
      <div className="loading-screen" role="status">
        Opening Awalem Quest Studio drafts…
      </div>
    );
  const missing = missingReferences(project);
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>Awalem Quest Studio</strong>
            <small>2.5D world editor</small>
          </div>
        </div>
        <div className="header-actions">
          <span className={`save-state ${localStatus}`} role="status">
            {editor.gesture
              ? "Edit in progress"
              : localStatus === "saved"
                ? "Draft saved locally"
                : localStatus === "saving"
                  ? "Saving draft…"
                  : "Draft save failed"}{" "}
            · {project.dirty.length} pending cloud
          </span>
          <button
            className="soft-btn"
            type="button"
            disabled={!scene}
            onClick={() => {
              finishGesture();
              const latest = sceneRecord
                ? useProject.getState().project?.records[sceneRecord.key]
                : null;
              if (latest?.kind === "scene")
                downloadJson(
                  latest.scene,
                  `${scene?.world_id}-${scene?.volume_id}-${scene?.scene_id}.scene.json`,
                );
            }}
          >
            Export scene
          </button>
          <button
            className="soft-btn"
            type="button"
            onClick={() => {
              finishGesture();
              downloadJson(
                {
                  format: "awalem-project-backup",
                  schema_version: 2,
                  project: useProject.getState().project,
                },
                "awalem-project-backup.json",
              );
            }}
          >
            Backup project
          </button>
          <Recovery />
          <button
            className="gold-btn"
            type="button"
            disabled={!auth.admin || busy}
            onClick={() => void saveCloud()}
          >
            Save to Firebase
          </button>
        </div>
      </header>
      {localError && (
        <div className="error-banner" role="alert">
          {localError}
          <button
            type="button"
            onClick={() => void flushDraft().catch(() => {})}
          >
            Retry local save
          </button>
          <button
            type="button"
            onClick={() =>
              void localDrafts
                .read(false)
                .then((raw) =>
                  downloadJson(raw ?? {}, "awalem-stored-recovery.json"),
                )
                .catch((error) => setStatus(String(error)))
            }
          >
            Export stored data
          </button>
        </div>
      )}
      {!!missing.length && (
        <div className="reference-banner" role="status">
          {missing.length} missing references:{" "}
          {missing
            .slice(0, 3)
            .map((r) => r.message)
            .join(" ")}
          {missing.length > 3
            ? " Inspect other scenes to resolve the remaining references."
            : ""}
        </div>
      )}
      <div
        className="workspace"
        style={{
          gridTemplateColumns: `${leftWidth}px 5px minmax(260px,1fr) 5px ${rightWidth}px`,
        }}
      >
        <aside className="left-panel">
          <ProjectExplorer />
          <MissionSetup />
          {scene && sceneRecord && (
            <SceneHierarchy sceneKey={sceneRecord.key} scene={scene} />
          )}
          {sceneRecord && (
            <BackgroundPanel
              sceneKey={sceneRecord.key}
              onChoose={(action, id) => {
                finishGesture();
                setBackgroundPicker({ sceneKey: sceneRecord.key, action, id });
              }}
            />
          )}
        </aside>
        <PanelDivider side="left" width={leftWidth} onResize={setLeftWidth} />
        <main
          className="center-panel"
          data-scene-editor
          onKeyDown={(event) =>
            editorShortcuts(event, sceneRecord?.key ?? null)
          }
        >
          <div className="scene-toolbar">
            <div className="breadcrumbs">
              {sceneWorld?.name ?? "Project"} <span>/</span>{" "}
              {sceneVolume?.name ?? "Choose a volume"} <span>/</span>{" "}
              {sceneRecord?.name ?? "No scene open"}
            </div>
            <div className="mode-label">● LAYERED 2.5D</div>
          </div>
          {sceneRecord && <Toolbar sceneKey={sceneRecord.key} />}
          <div className="viewport-wrap">
            {scene && sceneRecord ? (
              <SceneViewport
                sceneKey={sceneRecord.key}
                scene={scene}
                selectedId={selectedId}
                onSelect={(id) => selectEntity(sceneRecord.key, id)}
                onDropAsset={(key, position) => {
                  const asset = project.records[key];
                  if (asset?.kind === "asset") useAsset(asset, position);
                }}
              />
            ) : (
              <div className="viewport-empty">
                <h2>No scene open</h2>
                <p>Create or open a scene from the explorer.</p>
              </div>
            )}
            <span className="viewport-label">SCENE VIEW · 960 × 540</span>
            <span className="viewport-help">
              Drag objects to reposition · Drop catalog assets here
            </span>
          </div>
          <section className="assets">
            <div className="asset-title">
              <strong>Asset browser {volume ? `· ${volume.name}` : ""}</strong>
              <small>Original images are retained</small>
            </div>
            <div className="asset-controls">
              <select
                aria-label="Choose placeholder type"
                value={shape}
                onChange={(e) => setShape(e.target.value as Shape)}
              >
                {availableShapes.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <button
                className="soft-btn"
                type="button"
                disabled={!scene || preview}
                onClick={() => addEntity(shape)}
              >
                + Add sample
              </button>
              <button
                className="soft-btn"
                type="button"
                disabled={!auth.admin || busy || !context?.volume_id || preview}
                onClick={() => fileInput.current?.click()}
              >
                Upload sprite
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  void uploadImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {progress !== null && (
                <progress
                  aria-label="Image upload progress"
                  max={100}
                  value={progress}
                />
              )}
            </div>
            {context?.volume_id ? (
              <AssetBrowser
                worldId={context.world_id}
                volumeId={context.volume_id}
                onAdd={useAsset}
                disabled={preview || busy}
                onBackground={
                  sceneRecord
                    ? (asset) =>
                        assignBackgroundAsset(sceneRecord.key, asset, "base")
                    : undefined
                }
              />
            ) : (
              <p className="hint">Choose a volume to browse reusable images.</p>
            )}
          </section>
          <div className="status-line" role="status">
            {busy && <span className="working-indicator">Working… </span>}
            {editor.message || notice || status}
          </div>
        </main>
        <PanelDivider
          side="right"
          width={rightWidth}
          onResize={setRightWidth}
        />
        <aside className="right-panel">
          <div className="panel-heading">
            <span>INSPECTOR</span>
            <span>2.5D</span>
          </div>
          {selectedRecord && selectedRecord.kind !== "scene" ? (
            <ItemInspector record={selectedRecord} />
          ) : selectedLayer && sceneRecord ? (
            <BackgroundInspector
              sceneKey={sceneRecord.key}
              layer={selectedLayer}
            />
          ) : selected && sceneRecord ? (
            <fieldset className="editor-fieldset" disabled={preview}>
              <EntityInspector sceneKey={sceneRecord.key} selected={selected} />
            </fieldset>
          ) : (
            <p className="hint">
              Select a scene object, mission, folder, or asset to inspect it.
            </p>
          )}
          <div className="panel-heading section-heading">
            <span>FIREBASE</span>
          </div>
          <FirebasePanel
            auth={auth}
            busy={busy}
            run={withBusy}
            load={() =>
              project.dirty.length ? setConfirmLoad(true) : void loadCloud()
            }
          />
        </aside>
      </div>
      {backgroundPicker &&
        (() => {
          const target = project.records[backgroundPicker.sceneKey];
          if (target?.kind !== "scene" || isTrashed(project, target.key))
            return null;
          return (
            <Dialog
              title="Choose background image"
              onClose={() => setBackgroundPicker(null)}
            >
              <p>
                Choose a reusable image from any world, or upload a new image.
                Existing scene objects are preserved.
              </p>
              <label className="upload-background-label">
                Upload background
                <input
                  aria-label="Upload background"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={!auth.admin || busy}
                  onChange={(e) => {
                    void uploadImage(e.target.files?.[0], backgroundPicker);
                    e.target.value = "";
                  }}
                />
              </label>
              {!auth.admin && (
                <p className="hint">
                  Sign in as a studio administrator to upload. Existing catalog
                  images remain available locally.
                </p>
              )}
              <AssetBrowser
                picker
                disabled={busy}
                worldId={target.world_id}
                volumeId={target.volume_id!}
                onAdd={(asset) => {
                  if (
                    assignBackgroundAsset(
                      target.key,
                      asset,
                      backgroundPicker.action,
                      backgroundPicker.id,
                    )
                  )
                    setBackgroundPicker(null);
                }}
              />
              {busy && <p role="status">Uploading image… {progress ?? 0}%</p>}
              {editor.message && (
                <p role="alert" className="error-text">
                  {editor.message}
                </p>
              )}
              {!busy && (
                <p role="status" className="hint">
                  {status}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  className="soft-btn"
                  onClick={() => setBackgroundPicker(null)}
                >
                  Close
                </button>
              </div>
            </Dialog>
          );
        })()}
      {confirmLoad && (
        <Dialog
          title="Load cloud project?"
          onClose={() => setConfirmLoad(false)}
        >
          <p>
            This replaces the local project with cloud content.{" "}
            {project.dirty.length} records have pending local changes. A browser
            recovery copy will be retained before replacement.
          </p>
          <p>Use Backup project first for a portable copy.</p>
          <div className="dialog-actions">
            <button className="soft-btn" onClick={() => setConfirmLoad(false)}>
              Cancel
            </button>
            <button className="gold-btn" onClick={() => void loadCloud()}>
              Load and keep recovery copy
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
