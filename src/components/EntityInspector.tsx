import type { Layer, SceneEntity } from "../data/scene";
import EditorField from "../features/editor/EditorField";
import {
  anchor,
  compensateOrigin,
  pivot,
  scales,
} from "../features/editor/geometry";
import {
  EMPTY_SESSION,
  patchEntity,
  previewGesture,
  removeEntity,
  scalePatch,
  useEditor,
} from "../features/editor/store";

export default function EntityInspector({
  sceneKey,
  selected,
}: {
  sceneKey: string;
  selected: SceneEntity;
}) {
  const editor = useEditor(),
    measured = (editor.sessions[sceneKey] ?? EMPTY_SESSION).bounds[selected.id];
  const bounds = measured?.ready === false ? undefined : measured;
  const s = scales(selected),
    a = anchor(selected),
    p = pivot(selected),
    disabled = !!selected.locked;
  const immediate = (patch: Partial<SceneEntity>, label: string) =>
    patchEntity(sceneKey, selected.id, patch, label);
  const field = (
    label: string,
    value: number | string,
    makePatch: (v: number | string) => Partial<SceneEntity>,
    options: Partial<React.ComponentProps<typeof EditorField>> = {},
  ) => (
    <EditorField
      key={`${selected.id}-${label}`}
      sceneKey={sceneKey}
      id={selected.id}
      label={label}
      value={value}
      disabled={disabled}
      onPreview={(value) => previewGesture(makePatch(value))}
      {...options}
    />
  );
  const numeric = (
    fieldName: "x" | "y" | "rotation" | "depth",
    label: string,
  ) => field(label, selected[fieldName], (v) => ({ [fieldName]: Number(v) }));
  return (
    <div className="inspector-form" data-scene-editor>
      {selected.locked && (
        <p className="hint">
          Locked. Visibility and unlocking remain available.
        </p>
      )}
      {field("Name", selected.name, (v) => ({ name: String(v) }), {
        type: "text",
      })}
      <div className="grid-inputs">
        {numeric("x", "X")}
        {numeric("y", "Y")}
      </div>
      {numeric("rotation", "Rotation°")}
      <div className="grid-inputs">
        {field(
          "Scale X",
          s.x,
          (v) => scalePatch(selected, "x", Number(v), editor.settings.aspect),
          { min: 0.001, max: 10000, step: 0.1 },
        )}
        {field(
          "Scale Y",
          s.y,
          (v) => scalePatch(selected, "y", Number(v), editor.settings.aspect),
          { min: 0.001, max: 10000, step: 0.1 },
        )}
      </div>
      {bounds && (
        <div className="grid-inputs">
          {field(
            "Width",
            bounds.width * s.x,
            (v) =>
              scalePatch(
                selected,
                "x",
                Number(v) / bounds.width,
                editor.settings.aspect,
              ),
            { min: 0.01 },
          )}
          {field(
            "Height",
            bounds.height * s.y,
            (v) =>
              scalePatch(
                selected,
                "y",
                Number(v) / bounds.height,
                editor.settings.aspect,
              ),
            { min: 0.01 },
          )}
        </div>
      )}
      {field(
        "Opacity %",
        (selected.opacity ?? 1) * 100,
        (v) => ({ opacity: Number(v) / 100 }),
        { min: 0, max: 100 },
      )}
      <div className="inspector-toggles">
        <label>
          <input
            type="checkbox"
            checked={selected.visible !== false}
            onChange={(e) =>
              immediate({ visible: e.target.checked }, "Visibility")
            }
          />
          Visible
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!selected.locked}
            onChange={(e) => immediate({ locked: e.target.checked }, "Lock")}
          />
          Locked
        </label>
        <label>
          <input
            type="checkbox"
            disabled={disabled}
            checked={selected.selectable !== false}
            onChange={(e) =>
              immediate({ selectable: e.target.checked }, "Viewport selection")
            }
          />
          Selectable in viewport
        </label>
      </div>
      <label>
        Layer
        <select
          disabled={disabled}
          value={selected.layer}
          onChange={(e) =>
            immediate({ layer: e.target.value as Layer }, "Change layer")
          }
        >
          <option value="background">Background</option>
          <option value="playfield">Playfield</option>
          <option value="foreground">Foreground</option>
        </select>
      </label>
      {numeric("depth", "Depth offset")}
      <small className="hint">
        Overlap order: Y + depth ={" "}
        {Math.round((selected.y + selected.depth) * 100) / 100}
      </small>
      {selected.shape === "image" && (
        <div className="grid-inputs">
          {field(
            "Anchor X",
            a.x,
            (v) =>
              bounds
                ? compensateOrigin(
                    selected,
                    { anchor: { ...a, x: Number(v) } },
                    bounds,
                  )
                : {},
            { min: 0, max: 1, step: 0.1, disabled: disabled || !bounds },
          )}
          {field(
            "Anchor Y",
            a.y,
            (v) =>
              bounds
                ? compensateOrigin(
                    selected,
                    { anchor: { ...a, y: Number(v) } },
                    bounds,
                  )
                : {},
            { min: 0, max: 1, step: 0.1, disabled: disabled || !bounds },
          )}
        </div>
      )}
      <div className="grid-inputs">
        {field(
          "Pivot X",
          p.x,
          (v) =>
            bounds
              ? compensateOrigin(
                  selected,
                  { pivot: { ...p, x: Number(v) } },
                  bounds,
                )
              : {},
          { disabled: disabled || !bounds },
        )}
        {field(
          "Pivot Y",
          p.y,
          (v) =>
            bounds
              ? compensateOrigin(
                  selected,
                  { pivot: { ...p, y: Number(v) } },
                  bounds,
                )
              : {},
          { disabled: disabled || !bounds },
        )}
      </div>
      {field("Color", selected.color, (v) => ({ color: String(v) }), {
        type: "color",
        disabled: disabled || selected.shape === "image",
      })}
      {selected.shape === "image" && (
        <small className="hint">
          Image source colors are preserved. Color edits apply to sample
          graphics.
        </small>
      )}
      <div className="section-heading panel-heading">INTERACTION</div>
      <label>
        On click
        <select
          disabled={disabled}
          value={selected.interaction?.type ?? "none"}
          onChange={(e) =>
            immediate(
              {
                interaction: {
                  ...selected.interaction,
                  type: e.target.value as "none" | "show_fact" | "play_audio",
                },
              },
              "Change interaction",
            )
          }
        >
          <option value="none">None</option>
          <option value="show_fact">Show fact (definition)</option>
          <option value="play_audio">Play sound (definition)</option>
        </select>
      </label>
      <p className="hint">
        Interactions remain authoring data. Anchor uses normalized coordinates;
        pivot uses local scene units.
      </p>
      <button
        className="danger-btn"
        type="button"
        disabled={disabled}
        onClick={() => removeEntity(sceneKey, selected.id)}
      >
        Delete object
      </button>
    </div>
  );
}
