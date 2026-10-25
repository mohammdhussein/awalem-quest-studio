import {
  effectiveBackground,
  selectLayer,
  session,
  setParallaxPreview,
  useEditor,
} from "../editor/store";
import {
  deleteLayer,
  duplicateLayer,
  editBackground,
  patchLayer,
  reorderLayer,
  type AssetAction,
} from "./commands";
import { useProject } from "../project/store";
import { resolveAsset } from "../assets/catalog";
export default function BackgroundPanel({
  sceneKey,
  onChoose,
}: {
  sceneKey: string;
  onChoose: (action: AssetAction, id?: string) => void;
}) {
  useEditor();
  const project = useProject((s) => s.project)!,
    b = effectiveBackground(sceneKey),
    s = session(sceneKey),
    selected = s.target?.kind === "background" ? s.target.id : null;
  const layer = b.layers.find((l) => l.id === selected),
    preview = !!s.preview;
  return (
    <section
      className="background-panel"
      data-scene-editor
      aria-label="Background layers"
    >
      <div className="panel-heading">
        <span>BACKGROUNDS</span>
        <span>{b.layers.length}</span>
      </div>
      <div className="background-actions">
        <button disabled={preview} onClick={() => onChoose("base")}>
          Set background
        </button>
        <button disabled={preview} onClick={() => onChoose("background")}>
          + Background
        </button>
        <button disabled={preview} onClick={() => onChoose("foreground")}>
          + Foreground
        </button>
      </div>
      <label className="inline-check">
        <input
          type="checkbox"
          disabled={preview}
          checked={b.showWorldArtwork}
          onChange={(e) =>
            editBackground(sceneKey, "World artwork", (b) => {
              b.showWorldArtwork = e.target.checked;
            })
          }
        />
        Show built-in world artwork
      </label>
      <div className="background-scroll" role="list" aria-label="Image layers">
        {(["foreground", "background"] as const).map((group) => (
          <div key={group}>
            <h3>{group}</h3>
            {b.layers
              .filter((l) => l.placement === group)
              .sort((a, b) => b.depth - a.depth)
              .map((l) => (
                <div
                  key={l.id}
                  className={`hierarchy-row ${selected === l.id ? "active" : ""}`}
                  role="listitem"
                >
                  <button
                    className="hierarchy-select"
                    onClick={() => selectLayer(sceneKey, l.id)}
                  >
                    {resolveAsset(project, l.assetKey) && (
                      <img
                        className="layer-thumbnail"
                        src={resolveAsset(project, l.assetKey)!.url}
                        alt=""
                      />
                    )}
                    {l.name}
                  </button>
                  <button
                    disabled={preview}
                    aria-label={`${l.visible ? "Hide" : "Show"} layer ${l.name}`}
                    onClick={() =>
                      patchLayer(
                        sceneKey,
                        l.id,
                        { visible: !l.visible },
                        "Layer visibility",
                      )
                    }
                  >
                    {l.visible ? "●" : "○"}
                  </button>
                  <button
                    disabled={preview}
                    aria-label={`${l.locked ? "Unlock" : "Lock"} layer ${l.name}`}
                    onClick={() =>
                      patchLayer(
                        sceneKey,
                        l.id,
                        { locked: !l.locked },
                        "Layer lock",
                      )
                    }
                  >
                    {l.locked ? "▣" : "□"}
                  </button>
                </div>
              ))}
          </div>
        ))}
        {!b.layers.length && (
          <p className="hint">
            Choose an image to replace the world background. Scene objects stay
            intact.
          </p>
        )}
      </div>
      {layer && (
        <div className="background-actions">
          <button
            disabled={preview || layer.locked}
            onClick={() => onChoose("replace", layer.id)}
          >
            Replace image
          </button>
          <button
            disabled={preview || layer.locked}
            onClick={() => duplicateLayer(sceneKey, layer.id)}
          >
            Duplicate layer
          </button>
          <button
            disabled={preview || layer.locked}
            onClick={() => reorderLayer(sceneKey, layer.id, 1)}
          >
            Layer up
          </button>
          <button
            disabled={preview || layer.locked}
            onClick={() => reorderLayer(sceneKey, layer.id, -1)}
          >
            Layer down
          </button>
          <button
            disabled={preview || layer.locked}
            onClick={() => deleteLayer(sceneKey, layer.id)}
          >
            Delete layer
          </button>
        </div>
      )}
      <div className="background-actions">
        <button
          onClick={() =>
            setParallaxPreview(sceneKey, s.preview?.playing ? "pause" : "play")
          }
        >
          {s.preview?.playing ? "Pause preview" : "Play parallax"}
        </button>
        <button
          disabled={!preview}
          onClick={() => setParallaxPreview(sceneKey, "stop")}
        >
          Stop / Reset
        </button>
      </div>
      {preview && (
        <p className="hint">
          Preview only. Space + drag to test camera parallax. Stop to edit.
        </p>
      )}
    </section>
  );
}
