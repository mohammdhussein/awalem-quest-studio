import { assetUsers } from "../assets/catalog";
import { markChanged } from "./commands";
import { isTrashed, itemKey, type ProjectRecord } from "./model";
import { useProject } from "./store";

export default function ItemInspector({ record }: { record: ProjectRecord }) {
  const { project, change } = useProject();
  if (!project) return null;
  function missionPatch(patch: {
    description?: string;
    starting_scene_id?: string | null;
  }) {
    change((p) => {
      const mission = p.records[record.key];
      if (mission?.kind === "mission") {
        Object.assign(mission, patch);
        markChanged(p, mission);
      }
    });
  }
  return (
    <div className="item-details">
      <h3>{record.name}</h3>
      <span className="type-badge">
        {record.kind} · {record.status}
      </span>
      <label>
        Stable ID
        <input readOnly value={record.id} />
      </label>
      {record.kind === "mission" && (
        <>
          <label>
            Description
            <textarea
              value={record.description}
              onChange={(e) => missionPatch({ description: e.target.value })}
            />
          </label>
          <label>
            Starting scene
            <select
              value={record.starting_scene_id ?? ""}
              onChange={(e) =>
                missionPatch({ starting_scene_id: e.target.value || null })
              }
            >
              <option value="">Not configured</option>
              {Object.values(project.records)
                .filter(
                  (r) =>
                    r.kind === "scene" &&
                    r.world_id === record.world_id &&
                    r.volume_id === record.volume_id &&
                    !isTrashed(project, r.key),
                )
                .map((r) => (
                  <option key={r.key} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="soft-btn"
            disabled={!record.starting_scene_id}
            onClick={() => {
              if (record.starting_scene_id)
                void useProject
                  .getState()
                  .select(
                    itemKey(
                      record.world_id,
                      record.volume_id!,
                      "scene",
                      record.starting_scene_id,
                    ),
                  );
            }}
          >
            Edit scene background
          </button>
          <p className="hint">
            Each scene has its own background. Starting scenes stay linked when
            renamed or moved. Gameplay settings arrive in a later phase.
          </p>
        </>
      )}
      {record.kind === "asset" && (
        <>
          <img className="inspector-image" src={record.url} alt={record.name} />
          <p className="hint">
            {record.width ?? "?"} × {record.height ?? "?"} ·{" "}
            {record.size !== null
              ? `${Math.ceil(record.size / 1024)} KB`
              : "Size unknown"}
            <br />
            Used by {assetUsers(project, record).length} scenes.
            <br />
            {record.storage_path
              ? "Storage file reference"
              : "External image reference"}{" "}
            ·{" "}
            {project.dirty.includes(record.key)
              ? "Metadata pending cloud save"
              : "Metadata synced"}
          </p>
        </>
      )}
      {record.kind === "world" && (
        <p className="hint">
          Unlock level {record.unlock_level}. Add volumes through the explorer.
        </p>
      )}
      {record.kind === "volume" && (
        <p className="hint">
          {record.is_active ? "Active" : "Unreleased"} · {record.card_limit}{" "}
          card slots. Add missions, scenes, and folders through the explorer.
        </p>
      )}
    </div>
  );
}
