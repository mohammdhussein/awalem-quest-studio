import { makeScene } from '../../data/scene';
import { worlds } from '../../data/worlds';
import { catalogLegacyAssets } from '../assets/catalog';
import { itemKey, volumeKey, worldKey, type ProjectRecord, type ProjectSnapshot } from './model';
import { validateScene } from './validation';

export function seedProject(storage?: Pick<Storage, 'getItem'>): { project: ProjectSnapshot; warnings: string[]; legacyRecovery: Record<string,string> } {
  const project: ProjectSnapshot = { schema_version: 2, records: {}, cloud_bases: {}, dirty: [], selected_key: null, active_scene_key: null, expanded: [] };
  const warnings: string[] = [];
  const legacyRecovery: Record<string,string> = {};
  const add = (record: ProjectRecord) => { project.records[record.key] = record; project.cloud_bases[record.key] = null; project.dirty.push(record.key); };
  for (const [index, world] of worlds.entries()) {
    const wk = worldKey(world.id);
    const base = { schema_version: 2 as const, revision: 0, generation: 0, deleted_at: null, status: 'draft' as const };
    add({ ...base, kind: 'world', id: world.id, key: wk, name: world.name, world_id: world.id, volume_id: null, parent_key: null, sort_order: index, unlock_level: world.unlock_level });
    for (const volume of world.volumes) {
      const vk = volumeKey(world.id, volume.id);
      add({ ...base, kind: 'volume', id: volume.id, key: vk, name: volume.title, world_id: world.id, volume_id: volume.id, parent_key: wk,
        sort_order: volume.sort_order, is_active: volume.is_active, card_limit: volume.card_limit });
      let scene = makeScene(world.id, volume.id);
      const legacyKey = `awalem-studio-25d:${world.id}:${volume.id}`;
      let old: string | null | undefined;
      try {
        old = storage?.getItem(legacyKey);
        if (old !== null && old !== undefined) scene = validateScene(JSON.parse(old), world.id, volume.id);
      } catch (error) {
        if (old !== null && old !== undefined) legacyRecovery[legacyKey] = old;
        warnings.push(`${world.name} / ${volume.title}: legacy data retained; ${error instanceof Error ? error.message : 'migration failed'}`);
      }
      const key = itemKey(world.id, volume.id, 'scene', 'main');
      add({ ...base, kind: 'scene', id: 'main', key, name: 'Main Scene', world_id: world.id, volume_id: volume.id, parent_key: vk,
        sort_order: 0, scene: { ...scene, schema_version: 2, scene_id: 'main' } });
    }
  }
  const first = itemKey(worlds[0].id, worlds[0].volumes[0].id, 'scene', 'main');
  project.active_scene_key = first; project.selected_key = first;
  project.expanded = [worldKey(worlds[0].id), volumeKey(worlds[0].id, worlds[0].volumes[0].id)];
  catalogLegacyAssets(project);
  return { project, warnings, legacyRecovery };
}
