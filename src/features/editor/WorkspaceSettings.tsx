import { useEffect, useState } from "react";
import {
  resetWorkspace,
  workspaceDefaults,
  type WorkspacePreferences,
} from "./workspace";
export default function WorkspaceSettings({
  sceneKey,
  preferences,
  onChange,
}: {
  sceneKey: string;
  preferences: WorkspacePreferences;
  onChange: (p: WorkspacePreferences) => void;
}) {
  const [height, setHeight] = useState(String(preferences.assetsHeight)),
    [error, setError] = useState("");
  useEffect(
    () => setHeight(String(preferences.assetsHeight)),
    [preferences.assetsHeight],
  );
  return (
    <fieldset className="workspace-settings">
      <legend>Workspace</legend>
      <p className="hint">
        These preferences affect the editor only. Scene size stays 960 × 540.
      </p>
      {(["leftOpen", "rightOpen", "assetsOpen"] as const).map((key, i) => (
        <label className="inline-check" key={key}>
          <input
            type="checkbox"
            checked={preferences[key]}
            onChange={(e) =>
              onChange({ ...preferences, [key]: e.target.checked })
            }
          />
          {["Left panel open", "Inspector open", "Asset Browser open"][i]}
        </label>
      ))}
      <label>
        Asset Browser height (px)
        <input
          type="number"
          required
          min={140}
          max={1000}
          value={height}
          onChange={(e) => {
            setHeight(e.target.value);
            const n = Number(e.target.value);
            if (
              e.target.value.trim() &&
              Number.isFinite(n) &&
              n >= 140 &&
              n <= 1000
            )
              onChange({ ...preferences, assetsHeight: n });
          }}
          onBlur={() => {
            const n = Number(height);
            if (!height.trim() || !Number.isFinite(n) || n < 140 || n > 1000) {
              setHeight(String(preferences.assetsHeight));
              setError(
                "Use a height from 140 to 1000 pixels. The drawer also respects the available scene space.",
              );
            } else {
              onChange({ ...preferences, assetsHeight: n });
              setError("");
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <button
        type="button"
        className="soft-btn"
        onClick={() => {
          resetWorkspace(sceneKey);
          onChange({ ...workspaceDefaults });
          setHeight("240");
          setError("");
        }}
      >
        Reset workspace
      </button>
    </fieldset>
  );
}
