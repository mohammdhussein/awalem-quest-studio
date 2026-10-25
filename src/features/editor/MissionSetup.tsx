import { useState } from "react";
import { createItem, markChanged, moveItem } from "../project/commands";
import { isTrashed, itemKey, volumeKey } from "../project/model";
import { useProject } from "../project/store";
import Dialog from "../project/Dialog";

export default function MissionSetup() {
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const { project, change, select } = useProject();
  const vk = volumeKey("sea_wonders", "volume_01"),
    mainKey = itemKey("sea_wonders", "volume_01", "scene", "main");
  if (!project) return null;
  function setup() {
    const p = structuredClone(project!);
    try {
      const main = p.records[mainKey];
      if (main?.kind !== "scene" || isTrashed(p, mainKey))
        throw new Error(
          "Restore or create the existing Main Scene before using setup. No content was changed.",
        );
      const existing = Object.values(p.records).filter(
        (r) =>
          r.kind === "mission" &&
          r.world_id === "sea_wonders" &&
          r.volume_id === "volume_01" &&
          (r.name === "Mission 1" || r.starting_scene_id === "main"),
      );
      if (existing.length > 1)
        throw new Error(
          "Several missions match this scene. Choose the intended mission manually in the Project Explorer.",
        );
      let mission = existing[0];
      if (
        mission &&
        (isTrashed(p, mission.key) ||
          (mission.kind === "mission" &&
            mission.starting_scene_id &&
            mission.starting_scene_id !== "main"))
      )
        throw new Error(
          "An existing Mission 1 has different content or is in Trash. Review it in the Project Explorer first.",
        );
      mission ??= createItem(p, "mission", "Mission 1", vk);
      if (mission.kind !== "mission") return;
      if (mission.starting_scene_id !== "main") {
        mission.starting_scene_id = "main";
        markChanged(p, mission);
      }
      if (main.parent_key !== mission.key) moveItem(p, mainKey, mission.key);
      p.expanded = [
        ...new Set([
          ...p.expanded,
          `studio_worlds/sea_wonders`,
          vk,
          mission.key,
        ]),
      ];
      change((next) => Object.assign(next, p));
      void select(mainKey);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed.");
    }
  }
  return (
    <>
      <button
        type="button"
        className="soft-btn mission-setup"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        Set up / open Mission 1
      </button>
      {open && (
        <Dialog title="Sea Wonders · Mission 1" onClose={() => setOpen(false)}>
          <p>
            Create or reuse Mission 1 under Sea Wonders / Volume 1, use Main
            Scene as its starting scene, and organize Main Scene beneath it.
            Scene contents and IDs are preserved. These are local changes until
            you save to Firebase.
          </p>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="soft-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="gold-btn" onClick={setup}>
              Set up and open
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
