import { useState } from "react";
import Dialog from "../project/Dialog";
import {
  EMPTY_SESSION,
  redo,
  requestView,
  setSettings,
  setTool,
  undo,
  useEditor,
  type EditorSettings,
} from "./store";

export default function Toolbar({ sceneKey }: { sceneKey: string }) {
  const { tool, settings, sessions, gesture } = useEditor(),
    s = sessions[sceneKey] ?? EMPTY_SESSION;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(settings),
    [error, setError] = useState("");
  function toggle(field: "grid" | "snap" | "angleSnap" | "aspect") {
    setSettings({ [field]: !settings[field] });
  }
  return (
    <div
      className="editor-toolbar"
      role="toolbar"
      aria-label="Scene editing tools"
    >
      {(["move", "rotate", "scale"] as const).map((value, index) => (
        <button
          type="button"
          key={value}
          aria-pressed={tool === value}
          title={`${value} (${["W", "E", "R"][index]})`}
          onClick={() => setTool(value)}
        >
          {value[0].toUpperCase() + value.slice(1)}{" "}
          <kbd>{["W", "E", "R"][index]}</kbd>
        </button>
      ))}
      <span className="toolbar-separator" />
      <button
        type="button"
        disabled={!s.undo.length && !gesture}
        title={s.undo.at(-1)?.label ?? "Undo"}
        onClick={() => undo(sceneKey)}
      >
        Undo
      </button>
      <button
        type="button"
        disabled={!s.redo.length}
        title={s.redo.at(-1)?.label ?? "Redo"}
        onClick={() => redo(sceneKey)}
      >
        Redo
      </button>
      <span className="toolbar-separator" />
      <button type="button" onClick={() => requestView(sceneKey, "fit")}>
        Fit
      </button>
      <button type="button" onClick={() => requestView(sceneKey, "reset")}>
        100%
      </button>
      <output aria-label="Viewport zoom">
        {Math.round((s.camera?.zoom ?? 1) * 100)}%
      </output>
      <button
        type="button"
        aria-pressed={settings.grid}
        onClick={() => toggle("grid")}
      >
        Grid
      </button>
      <button
        type="button"
        aria-pressed={settings.snap}
        onClick={() => toggle("snap")}
      >
        Snap
      </button>
      <button
        type="button"
        aria-pressed={settings.angleSnap}
        onClick={() => toggle("angleSnap")}
      >
        Angle snap
      </button>
      <button
        type="button"
        aria-pressed={settings.aspect}
        onClick={() => toggle("aspect")}
      >
        Aspect lock
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(settings);
          setError("");
          setOpen(true);
        }}
      >
        Settings
      </button>
      {open && (
        <Dialog title="Scene editor settings" onClose={() => setOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                setSettings(draft);
                setOpen(false);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {(
              [
                ["gridSize", "Grid size (scene units)", 1, 10000],
                ["angleStep", "Angle snap (degrees)", 1, 180],
                ["maxCommands", "Undo commands per scene", 1, 10000],
                ["memoryMiB", "Total history budget (MiB)", 1, 256],
              ] as const
            ).map(([field, label, min, max]) => (
              <label key={field}>
                {label}
                <input
                  type="number"
                  required
                  min={min}
                  max={max}
                  value={draft[field]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [field]: Number(e.target.value),
                    } as EditorSettings)
                  }
                />
              </label>
            ))}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="soft-btn"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="gold-btn">Apply settings</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
