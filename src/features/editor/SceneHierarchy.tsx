import type { SceneDocument } from "../../data/scene";
import { useState } from "react";
import Dialog from "../project/Dialog";
import { validName } from "../project/validation";
import { useProject } from "../project/store";
import {
  duplicateEntity,
  EMPTY_SESSION,
  patchEntity,
  removeEntity,
  reorderEntity,
  selectEntity,
  useEditor,
  requestRename,
} from "./store";
import { editorShortcuts } from "./shortcuts";

export default function SceneHierarchy({
  sceneKey,
  scene,
}: {
  sceneKey: string;
  scene: SceneDocument;
}) {
  const editor = useEditor(),
    selected = (editor.sessions[sceneKey] ?? EMPTY_SESSION).selectedIds[0];
  const locked = !!scene.entities.find((e) => e.id === selected)?.locked;
  const renameTarget =
    editor.rename?.sceneKey === sceneKey
      ? scene.entities.find((e) => e.id === editor.rename?.id)
      : null;
  const p = useProject((s) => s.project);
  return (
    <section
      className="scene-hierarchy"
      data-scene-editor
      onKeyDown={(e) => editorShortcuts(e, sceneKey)}
    >
      <div className="panel-heading">
        <span>SCENE HIERARCHY</span>
        <span>{scene.entities.length}</span>
      </div>
      <div className="hierarchy-scroll" role="list" aria-label="Scene objects">
        {(["foreground", "playfield", "background"] as const).map((layer) => (
          <div key={layer}>
            <h3>{layer}</h3>
            {scene.entities
              .filter((e) => e.layer === layer)
              .sort((a, b) => b.y + b.depth - a.y - a.depth)
              .map((entity) => (
                <div
                  key={entity.id}
                  className={`hierarchy-row ${entity.id === selected && p?.selected_key === sceneKey ? "active" : ""}`}
                  role="listitem"
                >
                  <button
                    type="button"
                    className="hierarchy-select"
                    onClick={() => selectEntity(sceneKey, entity.id)}
                    title={entity.name}
                  >
                    {entity.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`${entity.visible === false ? "Show" : "Hide"} ${entity.name}`}
                    aria-pressed={entity.visible !== false}
                    title={`${entity.visible === false ? "Show" : "Hide"} ${entity.name}`}
                    onClick={() =>
                      patchEntity(
                        sceneKey,
                        entity.id,
                        { visible: entity.visible === false },
                        "Visibility",
                      )
                    }
                  >
                    {entity.visible === false ? "○" : "●"}
                  </button>
                  <button
                    type="button"
                    aria-label={`${entity.locked ? "Unlock" : "Lock"} ${entity.name}`}
                    aria-pressed={!!entity.locked}
                    title={`${entity.locked ? "Unlock" : "Lock"} ${entity.name}`}
                    onClick={() =>
                      patchEntity(
                        sceneKey,
                        entity.id,
                        { locked: !entity.locked },
                        "Lock",
                      )
                    }
                  >
                    {entity.locked ? "▣" : "□"}
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
      {selected && (
        <div className="hierarchy-actions">
          <button
            type="button"
            disabled={locked}
            onClick={() => requestRename(sceneKey)}
          >
            Rename object
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => duplicateEntity(sceneKey, selected)}
          >
            Duplicate object
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => reorderEntity(sceneKey, selected, true)}
          >
            Front
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => reorderEntity(sceneKey, selected, false)}
          >
            Back
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => removeEntity(sceneKey, selected)}
          >
            Delete object
          </button>
        </div>
      )}
      {renameTarget && (
        <RenameObject
          key={renameTarget.id}
          sceneKey={sceneKey}
          id={renameTarget.id}
          originalName={renameTarget.name}
        />
      )}
    </section>
  );
}
function RenameObject({
  sceneKey,
  id,
  originalName,
}: {
  sceneKey: string;
  id: string;
  originalName: string;
}) {
  const [name, setName] = useState(originalName),
    [error, setError] = useState("");
  const close = () => useEditor.setState({ rename: null });
  return (
    <Dialog title="Rename object" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (
              patchEntity(
                sceneKey,
                id,
                { name: validName(name) },
                "Rename object",
              )
            )
              close();
            else setError(useEditor.getState().message);
          } catch (error) {
            setError(String(error));
          }
        }}
      >
        <label>
          Name
          <input
            autoFocus
            required
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="soft-btn" onClick={close}>
            Cancel
          </button>
          <button className="gold-btn">Rename</button>
        </div>
      </form>
    </Dialog>
  );
}
