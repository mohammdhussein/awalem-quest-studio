import {
  togglePanel,
  toggleSceneFocus,
  useWorkspace,
  visiblePanel,
} from "./workspace";
export default function WorkspaceControls({
  sceneKey,
  assetsExpanded,
  assetsAvailable = true,
}: {
  sceneKey: string | null;
  assetsExpanded?: boolean;
  assetsAvailable?: boolean;
}) {
  const { focus } = useWorkspace();
  return (
    <div
      className="workspace-controls"
      role="toolbar"
      aria-label="Workspace panels"
    >
      {(["left", "right", "assets"] as const).map((panel, i) => (
        <button
          type="button"
          key={panel}
          data-panel-toggle={panel}
          aria-controls={`workspace-${panel}`}
          aria-expanded={
            panel === "assets"
              ? (assetsExpanded ?? visiblePanel(panel))
              : visiblePanel(panel)
          }
          disabled={panel === "assets" && !assetsAvailable}
          title={`${visiblePanel(panel) ? "Collapse" : "Open"} ${["left panel", "Inspector", "Asset Browser"][i]}`}
          onClick={() => togglePanel(panel)}
        >
          {["Left panel", "Inspector", "Assets"][i]}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={focus}
        title={
          focus
            ? "Restore previous layout and camera"
            : "Maximize scene workspace"
        }
        onClick={() => toggleSceneFocus(sceneKey)}
      >
        Scene focus
      </button>
    </div>
  );
}
