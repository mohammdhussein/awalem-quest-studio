import EditorField from "../editor/EditorField";
import { previewLayerGesture, session, useEditor } from "../editor/store";
import { resolveAsset } from "../assets/catalog";
import { useProject } from "../project/store";
import { patchLayer } from "./commands";
import type { BackgroundLayer, BackgroundMode } from "./model";
export default function BackgroundInspector({
  sceneKey,
  layer,
}: {
  sceneKey: string;
  layer: BackgroundLayer;
}) {
  useEditor();
  const project = useProject((s) => s.project)!,
    asset = resolveAsset(project, layer.assetKey),
    preview = !!session(sceneKey).preview;
  const disabled = layer.locked || preview;
  function field(
    label: string,
    key: keyof BackgroundLayer,
    type: "number" | "text" | "color" = "number",
    min?: number,
    max?: number,
  ) {
    return (
      <EditorField
        key={key}
        kind="background"
        sceneKey={sceneKey}
        id={layer.id}
        label={label}
        value={layer[key] as string | number}
        type={type}
        disabled={disabled}
        min={min}
        max={max}
        onPreview={(value) => previewLayerGesture({ [key]: value })}
      />
    );
  }
  return (
    <div className="inspector-form background-inspector">
      <h3>Background image layer</h3>
      {asset ? (
        <>
          <img className="inspector-image" src={asset.url} alt={asset.name} />
          <small>{asset.name}</small>
        </>
      ) : (
        <p role="alert" className="error-text">
          Asset missing or in Trash. Use Replace image to relink this layer.
        </p>
      )}
      {field("Layer name", "name", "text")}
      <label>
        Image mode
        <select
          disabled={disabled}
          value={layer.mode}
          onChange={(e) =>
            patchLayer(
              sceneKey,
              layer.id,
              { mode: e.target.value as BackgroundMode },
              "Layer mode",
            )
          }
        >
          {["fit", "fill", "stretch", "tile", "custom"].map((m) => (
            <option key={m} value={m}>
              {m[0].toUpperCase() + m.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Placement
        <select
          disabled={disabled}
          value={layer.placement}
          onChange={(e) =>
            patchLayer(
              sceneKey,
              layer.id,
              { placement: e.target.value as BackgroundLayer["placement"] },
              "Layer placement",
            )
          }
        >
          <option value="background">Background</option>
          <option value="foreground">Foreground</option>
        </select>
      </label>
      <div className="grid-inputs">
        {field("Offset X", "x")}
        {field("Offset Y", "y")}
        {field("Layer scale X", "scaleX", "number", 0.0001, 10000)}
        {field("Layer scale Y", "scaleY", "number", 0.0001, 10000)}
        {field("Layer opacity", "opacity", "number", 0, 1)}
        {field("Layer depth", "depth")}
      </div>
      {field("Layer tint", "tint", "color")}
      <div className="inspector-toggles">
        <label>
          <input
            type="checkbox"
            disabled={preview}
            checked={layer.visible}
            onChange={(e) =>
              patchLayer(
                sceneKey,
                layer.id,
                { visible: e.target.checked },
                "Layer visibility",
              )
            }
          />
          Visible
        </label>
        <label>
          <input
            type="checkbox"
            disabled={preview}
            checked={layer.locked}
            onChange={(e) =>
              patchLayer(
                sceneKey,
                layer.id,
                { locked: e.target.checked },
                "Layer lock",
              )
            }
          />
          Locked
        </label>
      </div>
      <h3>Parallax preview</h3>
      <div className="grid-inputs">
        {field("Camera factor X", "parallaxX")}
        {field("Camera factor Y", "parallaxY")}
        {field("Scroll X (px/s)", "scrollX")}
        {field("Scroll Y (px/s)", "scrollY")}
      </div>
      <p className="hint">
        Camera factor 1 follows the scene; 0 stays fixed in the preview
        viewport. Negative scrolling reverses direction. Tile mode repeats
        seamlessly; other modes can scroll beyond the frame. Custom mode
        supports Move and Scale handles.
      </p>
    </div>
  );
}
