import type { SceneDocument } from '../../data/scene';

export type ItemKind = 'world' | 'volume' | 'mission' | 'folder' | 'scene' | 'asset';
export type RecordBase = {
  schema_version: 2;
  id: string;
  key: string;
  kind: ItemKind;
  name: string;
  parent_key: string | null;
  world_id: string;
  volume_id: string | null;
  sort_order: number;
  revision: number;
  /** Local-only edit counter: a cloud acknowledgement must not clear newer edits. */
  generation: number;
  deleted_at: string | null;
  status: 'draft' | 'published';
};
export type WorldRecord = RecordBase & { kind: 'world'; unlock_level: number };
export type VolumeRecord = RecordBase & { kind: 'volume'; is_active: boolean; card_limit: number };
export type FolderRecord = RecordBase & { kind: 'folder' };
export type MissionRecord = RecordBase & { kind: 'mission'; description: string; starting_scene_id: string | null };
export type SceneRecord = RecordBase & { kind: 'scene'; scene: SceneDocument };
export type AssetRecord = RecordBase & {
  kind: 'asset'; url: string; storage_path: string | null;
  width: number | null; height: number | null; size: number | null; mime: string | null;
};
export type ProjectRecord = WorldRecord | VolumeRecord | FolderRecord | MissionRecord | SceneRecord | AssetRecord;
export type ProjectSnapshot = {
  schema_version: 2;
  records: Record<string, ProjectRecord>;
  /** Fingerprints of server data last read or acknowledged; null means known/new local content. */
  cloud_bases: Record<string, string | null>;
  dirty: string[];
  selected_key: string | null;
  active_scene_key: string | null;
  expanded: string[];
};
export const worldKey = (id: string) => `studio_worlds/${id}`;
export const volumeKey = (world: string, volume: string) => `${worldKey(world)}/volumes/${volume}`;
const collections = { mission: 'missions', folder: 'folders', scene: 'scenes', asset: 'assets' } as const;
export const itemKey = (world: string, volume: string, kind: keyof typeof collections, id: string) =>
  `${volumeKey(world, volume)}/${collections[kind]}/${id}`;
export const ordered = (items: ProjectRecord[]) => items.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
export function children(project: ProjectSnapshot, key: string | null) {
  return ordered(Object.values(project.records).filter(item => item.parent_key === key));
}
export function isTrashed(project: ProjectSnapshot, key: string): boolean {
  const visited = new Set<string>();
  let item: ProjectRecord | undefined = project.records[key];
  while (item) {
    if (item.deleted_at || visited.has(item.key)) return true;
    visited.add(item.key);
    item = item.parent_key ? project.records[item.parent_key] : undefined;
  }
  return false;
}
export function branchKeys(project: ProjectSnapshot, key: string): Set<string> {
  const result = new Set([key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of Object.values(project.records)) {
      if (item.parent_key && result.has(item.parent_key) && !result.has(item.key)) { result.add(item.key); changed = true; }
    }
  }
  return result;
}
export function scopeKey(item: ProjectRecord) {
  return item.volume_id ? volumeKey(item.world_id, item.volume_id) : worldKey(item.world_id);
}
export function breadcrumb(project: ProjectSnapshot, key: string) {
  const names: string[] = [], visited = new Set<string>();
  let item: ProjectRecord | undefined = project.records[key];
  while (item && !visited.has(item.key)) { names.unshift(item.name); visited.add(item.key); item = item.parent_key ? project.records[item.parent_key] : undefined; }
  return names.join(' / ');
}
