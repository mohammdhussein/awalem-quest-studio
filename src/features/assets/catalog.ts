import {
  itemKey,
  isTrashed,
  type AssetRecord,
  type ProjectSnapshot,
  type SceneRecord,
} from "../project/model";
import type { SceneDocument, SceneEntity } from "../../data/scene";

export function sceneAssetKeys(scene: SceneDocument): string[] {
  return [
    ...new Set([
      ...(scene.background?.layers.map((l) => l.assetKey) ?? []),
      ...scene.entities.flatMap((e) =>
        e.assetKey
          ? [e.assetKey]
          : e.assetId
            ? [itemKey(scene.world_id, scene.volume_id, "asset", e.assetId)]
            : [],
      ),
    ]),
  ];
}
export function resolveAsset(
  project: ProjectSnapshot,
  key: string,
): AssetRecord | null {
  const r = project.records[key];
  return r?.kind === "asset" && !isTrashed(project, key) ? r : null;
}
export function entityImageUrl(
  project: ProjectSnapshot,
  scene: SceneDocument,
  entity: SceneEntity,
): string | undefined {
  if (entity.assetKey) return resolveAsset(project, entity.assetKey)?.url;
  return (
    entity.assetUrl ??
    (entity.assetId
      ? resolveAsset(
          project,
          itemKey(scene.world_id, scene.volume_id, "asset", entity.assetId),
        )?.url
      : undefined)
  );
}

/** Catalog legacy URL references without rewriting their Storage paths or source URLs. */
export function catalogLegacyAssets(project: ProjectSnapshot) {
  for (const record of Object.values(project.records)) {
    if (record.kind !== "scene") continue;
    for (const entity of record.scene.entities) {
      if (entity.assetKey) continue;
      if (!entity.assetUrl) continue;
      const byId = entity.assetId
        ? project.records[
            itemKey(record.world_id, record.volume_id!, "asset", entity.assetId)
          ]
        : null;
      const known =
        byId?.kind === "asset"
          ? byId
          : Object.values(project.records).find(
              (r): r is AssetRecord =>
                r.kind === "asset" &&
                r.world_id === record.world_id &&
                r.volume_id === record.volume_id &&
                (r.url === entity.assetUrl ||
                  (!!entity.assetPath && r.storage_path === entity.assetPath)),
            );
      const id = known?.id ?? entity.assetId ?? crypto.randomUUID();
      if (!known) {
        const key = itemKey(record.world_id, record.volume_id!, "asset", id);
        project.records[key] = {
          schema_version: 2,
          id,
          key,
          kind: "asset",
          name: entity.name || "Legacy sprite",
          parent_key: record.parent_key,
          world_id: record.world_id,
          volume_id: record.volume_id,
          sort_order: Object.keys(project.records).length,
          revision: 0,
          generation: 0,
          deleted_at: null,
          status: "draft",
          url: entity.assetUrl,
          storage_path: entity.assetPath ?? null,
          width: null,
          height: null,
          size: null,
          mime: null,
        };
        project.cloud_bases[key] = null;
        project.dirty.push(key);
      }
      if (entity.assetId !== id) {
        entity.assetId = id;
        if (!project.dirty.includes(record.key)) project.dirty.push(record.key);
      }
    }
  }
}
export function assetUsers(
  project: ProjectSnapshot,
  asset: AssetRecord,
): SceneRecord[] {
  return Object.values(project.records).filter(
    (r): r is SceneRecord =>
      r.kind === "scene" &&
      !isTrashed(project, r.key) &&
      (sceneAssetKeys(r.scene).includes(asset.key) ||
        r.scene.entities.some(
          (e) =>
            !e.assetKey &&
            (e.assetUrl === asset.url ||
              (!!asset.storage_path && e.assetPath === asset.storage_path)),
        )),
  );
}
export function missingReferences(
  project: ProjectSnapshot,
  include?: Set<string>,
): { key: string; message: string }[] {
  const problems: { key: string; message: string }[] = [];
  for (const record of Object.values(project.records)) {
    if ((include && !include.has(record.key)) || isTrashed(project, record.key))
      continue;
    if (record.kind === "scene")
      for (const entity of record.scene.entities) {
        if (entity.assetId || entity.assetKey) {
          const key =
              entity.assetKey ??
              itemKey(
                record.world_id,
                record.volume_id!,
                "asset",
                entity.assetId!,
              ),
            asset = project.records[key];
          if (asset?.kind !== "asset" || isTrashed(project, key))
            problems.push({
              key: record.key,
              message: `${record.name} / ${entity.name}: asset metadata is missing or in Trash.`,
            });
        }
        if (entity.shape === "image" && !entity.assetUrl && !entity.assetKey)
          problems.push({
            key: record.key,
            message: `${record.name} / ${entity.name}: image URL is missing.`,
          });
      }
    if (record.kind === "scene")
      for (const layer of record.scene.background?.layers ?? []) {
        if (!resolveAsset(project, layer.assetKey))
          problems.push({
            key: record.key,
            message: `${record.name} / ${layer.name}: background asset is missing or in Trash. Relink the layer.`,
          });
      }
    if (record.kind === "mission" && record.starting_scene_id) {
      const key = itemKey(
        record.world_id,
        record.volume_id!,
        "scene",
        record.starting_scene_id,
      );
      if (project.records[key]?.kind !== "scene" || isTrashed(project, key))
        problems.push({
          key: record.key,
          message: `${record.name}: starting scene is missing or in Trash.`,
        });
    }
  }
  return problems;
}
export async function imageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const image = await createImageBitmap(file);
  try {
    return { width: image.width, height: image.height };
  } finally {
    image.close();
  }
}
