import { assetUsers, missingReferences } from "../assets/catalog";
import { assertParent, validName } from "./validation";
import {
  branchKeys,
  isTrashed,
  itemKey,
  volumeKey,
  worldKey,
  type AssetRecord,
  type ItemKind,
  type ProjectRecord,
  type ProjectSnapshot,
} from "./model";

export function markChanged(project: ProjectSnapshot, item: ProjectRecord) {
  item.generation++;
  if (!project.dirty.includes(item.key)) project.dirty.push(item.key);
}
export function createItem(
  project: ProjectSnapshot,
  kind: ItemKind,
  name: string,
  parentKey: string | null,
): ProjectRecord {
  const parent = parentKey ? project.records[parentKey] : null;
  const id = crypto.randomUUID();
  const world = kind === "world" ? id : (parent?.world_id ?? "");
  const volume =
    kind === "world"
      ? null
      : kind === "volume"
        ? id
        : (parent?.volume_id ?? null);
  const key =
    kind === "world"
      ? worldKey(id)
      : kind === "volume"
        ? volumeKey(world, id)
        : itemKey(world, volume ?? "", kind, id);
  const base = {
    schema_version: 2 as const,
    id,
    key,
    name: validName(name),
    parent_key: parentKey,
    world_id: world,
    volume_id: volume,
    sort_order: Object.values(project.records).filter(
      (r) => r.parent_key === parentKey,
    ).length,
    revision: 0,
    generation: 0,
    deleted_at: null,
    status: "draft" as const,
  };
  let item: ProjectRecord;
  switch (kind) {
    case "world":
      item = { ...base, kind, unlock_level: 1 };
      break;
    case "volume":
      item = { ...base, kind, is_active: false, card_limit: 20 };
      break;
    case "mission":
      item = { ...base, kind, description: "", starting_scene_id: null };
      break;
    case "folder":
      item = { ...base, kind };
      break;
    case "scene":
      item = {
        ...base,
        kind,
        scene: {
          schema_version: 2,
          scene_id: id,
          render_mode: "2.5d",
          world_id: world,
          volume_id: volume!,
          dimensions: { width: 960, height: 540 },
          entities: [],
        },
      };
      break;
    default:
      throw new Error("Import a supported image to create an asset.");
  }
  assertParent(item, parent ?? null);
  if (parent && isTrashed(project, parent.key))
    throw new Error("Restore the destination before adding content.");
  project.records[key] = item;
  project.cloud_bases[key] = null;
  markChanged(project, item);
  if (parentKey && !project.expanded.includes(parentKey))
    project.expanded.push(parentKey);
  project.selected_key = key;
  if (kind === "scene") project.active_scene_key = key;
  return item;
}
export function renameItem(
  project: ProjectSnapshot,
  key: string,
  name: string,
) {
  const item = project.records[key];
  if (!item || isTrashed(project, key))
    throw new Error("Choose an available item.");
  item.name = validName(name);
  markChanged(project, item);
}
export function moveItem(
  project: ProjectSnapshot,
  key: string,
  parentKey: string,
) {
  const item = project.records[key],
    parent = project.records[parentKey];
  if (
    !item ||
    !parent ||
    isTrashed(project, key) ||
    isTrashed(project, parentKey)
  )
    throw new Error("Choose available source and destination items.");
  if (item.kind === "world" || item.kind === "volume")
    throw new Error("Phase 1 moves are limited to content within a volume.");
  assertParent(item, parent);
  if (branchKeys(project, key).has(parentKey))
    throw new Error(
      "An item cannot move inside itself or one of its descendants.",
    );
  item.parent_key = parentKey;
  item.sort_order = Object.values(project.records).filter(
    (r) => r.parent_key === parentKey,
  ).length;
  markChanged(project, item);
  if (!project.expanded.includes(parentKey)) project.expanded.push(parentKey);
}
export function duplicateScene(project: ProjectSnapshot, key: string) {
  const source = project.records[key];
  if (!source || source.kind !== "scene" || isTrashed(project, key))
    throw new Error("Choose an available scene to duplicate.");
  const item = createItem(
    project,
    "scene",
    `${source.name.slice(0, 150)} copy`,
    source.parent_key,
  );
  if (item.kind === "scene")
    item.scene = {
      ...structuredClone(source.scene),
      scene_id: item.id,
      ...(source.scene.background
        ? {
            background: {
              ...structuredClone(source.scene.background),
              layers: source.scene.background.layers.map((l) => ({
                ...structuredClone(l),
                id: crypto.randomUUID(),
              })),
            },
          }
        : {}),
      entities: source.scene.entities.map((entity) => ({
        ...structuredClone(entity),
        id: crypto.randomUUID(),
      })),
    };
  return item;
}
export function deletionBlockers(
  project: ProjectSnapshot,
  key: string,
): string[] {
  const branch = branchKeys(project, key);
  const blockers = new Set<string>();
  for (const target of branch) {
    const item = project.records[target];
    if (item?.kind === "asset")
      for (const scene of assetUsers(project, item))
        if (!branch.has(scene.key))
          blockers.add(`${scene.name} uses ${item.name}`);
    if (item?.kind === "scene")
      for (const mission of Object.values(project.records)) {
        if (
          mission.kind === "mission" &&
          !isTrashed(project, mission.key) &&
          !branch.has(mission.key) &&
          mission.world_id === item.world_id &&
          mission.volume_id === item.volume_id &&
          mission.starting_scene_id === item.id
        )
          blockers.add(`${mission.name} starts in ${item.name}`);
      }
  }
  return [...blockers];
}
export function trashItem(project: ProjectSnapshot, key: string) {
  const item = project.records[key];
  if (!item || isTrashed(project, key))
    throw new Error("Choose an available item.");
  const blockers = deletionBlockers(project, key);
  if (blockers.length)
    throw new Error(
      `Content is still referenced: ${blockers.join("; ")}. Update those references first.`,
    );
  item.deleted_at = new Date().toISOString();
  markChanged(project, item);
  if (project.active_scene_key && isTrashed(project, project.active_scene_key))
    project.active_scene_key = null;
  project.selected_key = item.parent_key;
}
export function restoreItem(project: ProjectSnapshot, key: string) {
  const item = project.records[key];
  if (!item?.deleted_at) throw new Error("Choose a directly deleted item.");
  if (item.parent_key && isTrashed(project, item.parent_key))
    throw new Error("Restore the parent container first.");
  const deletedAt = item.deleted_at;
  item.deleted_at = null;
  const missing = missingReferences(project, branchKeys(project, key));
  if (missing.length) {
    item.deleted_at = deletedAt;
    throw new Error(
      `Restore the referenced content first: ${missing.map((r) => r.message).join("; ")}`,
    );
  }
  markChanged(project, item);
}
export function addAsset(
  project: ProjectSnapshot,
  parentKey: string,
  details: Pick<
    AssetRecord,
    "name" | "url" | "storage_path" | "width" | "height" | "size" | "mime"
  >,
) {
  const parent = project.records[parentKey];
  if (
    !parent?.volume_id ||
    !["volume", "mission", "folder"].includes(parent.kind) ||
    isTrashed(project, parentKey)
  )
    throw new Error("Choose an available asset folder in a volume.");
  const id = crypto.randomUUID(),
    key = itemKey(parent.world_id, parent.volume_id, "asset", id);
  const asset: AssetRecord = {
    schema_version: 2,
    id,
    key,
    kind: "asset",
    ...details,
    name: validName(details.name),
    world_id: parent.world_id,
    volume_id: parent.volume_id,
    parent_key: parentKey,
    sort_order: Object.keys(project.records).length,
    revision: 0,
    generation: 0,
    deleted_at: null,
    status: "draft",
  };
  project.records[key] = asset;
  project.cloud_bases[key] = null;
  markChanged(project, asset);
  return asset;
}
