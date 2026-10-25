import { useState } from "react";
import { assetUsers } from "./catalog";
import { isTrashed, type AssetRecord } from "../project/model";
import { useProject } from "../project/store";

export default function AssetBrowser({
  worldId,
  volumeId,
  onAdd,
  onBackground,
  picker = false,
  disabled = false,
}: {
  worldId: string;
  volumeId: string;
  onAdd: (asset: AssetRecord) => void;
  onBackground?: (asset: AssetRecord) => void;
  picker?: boolean;
  disabled?: boolean;
}) {
  const project = useProject((state) => state.project)!;
  const select = useProject((state) => state.select);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [allWorlds, setAllWorlds] = useState(picker);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const assets = Object.values(project.records)
    .filter(
      (r): r is AssetRecord =>
        r.kind === "asset" &&
        (allWorlds || (r.world_id === worldId && r.volume_id === volumeId)) &&
        !isTrashed(project, r.key) &&
        r.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "size"
        ? (b.size ?? 0) - (a.size ?? 0)
        : a.name.localeCompare(b.name),
    );
  return (
    <div className="asset-browser">
      <div className="asset-filter">
        <input
          type="search"
          aria-label="Search assets"
          placeholder="Search image assets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Asset scope"
          value={allWorlds ? "all" : "volume"}
          onChange={(e) => setAllWorlds(e.target.value === "all")}
        >
          <option value="volume">This volume</option>
          <option value="all">All worlds</option>
        </select>
        <select
          aria-label="Sort assets"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="name">Name</option>
          <option value="size">File size</option>
        </select>
      </div>
      <div className="asset-grid">
        {assets.map((asset) => (
          <div
            className="asset-card"
            key={asset.key}
            draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.setData(
                "application/x-awalem-asset",
                asset.key,
              );
              event.dataTransfer.setData(
                "application/x-awalem-item",
                asset.key,
              );
            }}
          >
            <button
              type="button"
              className="asset-preview"
              disabled={disabled}
              title={picker ? "Use image" : "Select asset metadata"}
              onClick={() => (picker ? onAdd(asset) : void select(asset.key))}
            >
              <img
                src={asset.url}
                alt={asset.name}
                onError={() => setFailed((old) => new Set(old).add(asset.key))}
              />
              <span>{asset.name}</span>
            </button>
            {allWorlds && (
              <small>
                {asset.world_id} / {asset.volume_id}
              </small>
            )}
            <small>
              {asset.width && asset.height
                ? `${asset.width} × ${asset.height}`
                : "Legacy dimensions unknown"}{" "}
              ·{" "}
              {asset.size !== null
                ? `${Math.ceil(asset.size / 1024)} KB`
                : "Size unknown"}
            </small>
            <small>
              {failed.has(asset.key)
                ? "Image unavailable · check permissions or source"
                : `${assetUsers(project, asset).length} scene references`}{" "}
              ·{" "}
              {project.dirty.includes(asset.key)
                ? "Metadata local"
                : "Metadata synced"}
            </small>
            <button
              type="button"
              className="soft-btn"
              disabled={disabled}
              onClick={() => onAdd(asset)}
            >
              {picker ? "Use image" : "Add to scene"}
            </button>
            {onBackground && (
              <button
                type="button"
                className="soft-btn"
                onClick={() => onBackground(asset)}
              >
                Set as background
              </button>
            )}
          </div>
        ))}
        {!assets.length && (
          <p className="hint">
            No image assets here yet. Existing scene images are cataloged
            automatically. Upload a PNG, JPEG, or WebP, then reuse it across
            scenes.
          </p>
        )}
      </div>
    </div>
  );
}
