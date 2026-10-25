import type { SceneDocument, SceneEntity } from '../../data/scene';
import { itemKey, volumeKey, worldKey, type ProjectRecord, type ProjectSnapshot } from './model';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a data object.');
  return value as Record<string, unknown>;
}
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
export function validName(value: string) {
  const name = value.trim();
  if (!name || name.length > 160 || /[\u0000-\u001f]/.test(name)) throw new Error('Use a name of 1–160 characters without control characters.');
  return name;
}
export function validateScene(value: unknown, world: string, volume: string, id = 'main'): SceneDocument {
  const data = object(value);
  if ((data.schema_version !== 1 && data.schema_version !== 2) || data.render_mode !== '2.5d' || data.world_id !== world || data.volume_id !== volume ||
      (data.schema_version === 2 && data.scene_id !== id) || !Array.isArray(data.entities)) throw new Error('Unsupported scene schema or scene identity.');
  const dimensions = object(data.dimensions);
  // The existing renderer uses a fixed authored coordinate system.
  if (dimensions.width !== 960 || dimensions.height !== 540) throw new Error('This editor currently supports 960 × 540 scenes. Source data was not changed.');
  const ids = new Set<string>();
  const entities = data.entities.map(raw => {
    const entity = object(raw);
    if (typeof entity.id !== 'string' || !entity.id || ids.has(entity.id) || typeof entity.name !== 'string' ||
        !['fish','coral','rock','plant','bird','crystal','hotspot','image'].includes(String(entity.shape)) ||
        !['background','playfield','foreground'].includes(String(entity.layer)) ||
        !['x','y','scale','rotation','depth'].every(field => finite(entity[field])) || Number(entity.scale) <= 0 ||
        typeof entity.color !== 'string' || !/^#[\da-f]{6}$/i.test(entity.color)) throw new Error('Invalid or duplicate scene object.');
    for (const field of ['assetUrl','assetPath','assetId']) if (entity[field] !== undefined && typeof entity[field] !== 'string') throw new Error(`Invalid ${field}.`);
    if (entity.assetUrl && !/^https?:\/\//i.test(String(entity.assetUrl))) throw new Error('Asset URLs must use HTTP or HTTPS.');
    if (entity.interaction !== undefined) {
      const interaction = object(entity.interaction);
      if (!['none','show_fact','play_audio'].includes(String(interaction.type)) ||
          (interaction.target !== undefined && typeof interaction.target !== 'string')) throw new Error('Invalid interaction definition.');
    }
    ids.add(entity.id);
    return entity as SceneEntity;
  });
  return { ...data, schema_version: 2, scene_id: id, entities } as SceneDocument;
}
export function validateRecord(value: unknown): ProjectRecord {
  const r = object(value);
  if (r.schema_version !== 2 || typeof r.id !== 'string' || !r.id || r.id.includes('/') || typeof r.world_id !== 'string' || !r.world_id || r.world_id.includes('/') ||
      (r.volume_id !== null && (typeof r.volume_id !== 'string' || !r.volume_id || r.volume_id.includes('/'))) ||
      typeof r.key !== 'string' || typeof r.name !== 'string' || !['draft','published'].includes(String(r.status)) ||
      !finite(r.sort_order) || !Number.isInteger(r.revision) || Number(r.revision) < 0 || !Number.isInteger(r.generation) || Number(r.generation) < 0 ||
      (r.deleted_at !== null && (typeof r.deleted_at !== 'string' || !Number.isFinite(Date.parse(r.deleted_at)))) ||
      (r.parent_key !== null && typeof r.parent_key !== 'string')) throw new Error('Invalid project metadata.');
  validName(r.name);
  const kind = r.kind;
  const expected = kind === 'world' ? worldKey(r.id) : kind === 'volume' ? volumeKey(r.world_id, r.id) :
    ['mission','folder','scene','asset'].includes(String(kind)) && r.volume_id ? itemKey(r.world_id, r.volume_id, kind as 'scene', r.id) : null;
  if (expected !== r.key || (kind === 'world' && (r.world_id !== r.id || r.volume_id !== null)) ||
      (kind === 'volume' && r.volume_id !== r.id)) throw new Error('Invalid project identity.');
  if (kind === 'world' && (!finite(r.unlock_level) || Number(r.unlock_level) < 1)) throw new Error('Invalid world unlock level.');
  if (kind === 'volume' && (typeof r.is_active !== 'boolean' || !finite(r.card_limit))) throw new Error('Invalid volume configuration.');
  if (kind === 'mission' && (typeof r.description !== 'string' || (r.starting_scene_id !== null && typeof r.starting_scene_id !== 'string'))) throw new Error('Invalid mission configuration.');
  if (kind === 'scene') {
    const scene = object(r.scene);
    if (scene.schema_version !== 2) throw new Error('Project scenes must be migrated to schema version 2.');
    validateScene(scene, r.world_id, String(r.volume_id), r.id);
  }
  if (kind === 'asset') {
    if (typeof r.url !== 'string' || !/^https?:\/\//i.test(r.url) || (r.storage_path !== null && typeof r.storage_path !== 'string') ||
        (r.mime !== null && typeof r.mime !== 'string') || !['width','height','size'].every(field => r[field] === null || (finite(r[field]) && Number(r[field]) >= 0))) throw new Error('Invalid asset metadata.');
  }
  return value as ProjectRecord;
}
export function assertParent(item: ProjectRecord, parent: ProjectRecord | null) {
  if (item.kind === 'world') { if (parent) throw new Error('Worlds belong at project root.'); return; }
  if (!parent) throw new Error('Choose a parent container.');
  if (item.kind === 'volume') {
    if (parent.kind !== 'world' || parent.id !== item.world_id) throw new Error('Volumes remain in their original world in Phase 1.');
  } else if (!['volume','mission','folder'].includes(parent.kind) || parent.world_id !== item.world_id || parent.volume_id !== item.volume_id ||
      (item.kind === 'mission' && parent.kind === 'mission')) throw new Error('Choose a compatible container in the same volume.');
}
export function validateProject(value: unknown): ProjectSnapshot {
  const p = object(value);
  if (p.schema_version !== 2 || !Array.isArray(p.dirty) || !Array.isArray(p.expanded) ||
      ![p.selected_key, p.active_scene_key].every(key => key === null || typeof key === 'string')) throw new Error('Unsupported project draft schema.');
  const records = object(p.records);
  const bases = object(p.cloud_bases);
  if (!p.dirty.every(key => typeof key === 'string' && key in records) || !p.expanded.every(key => typeof key === 'string') ||
      !Object.values(bases).every(base => base === null || typeof base === 'string')) throw new Error('Invalid draft tracking data.');
  for (const [key, value] of Object.entries(records)) {
    const item = validateRecord(value);
    if (item.key !== key) throw new Error('Project key mismatch.');
    const parent = item.parent_key ? records[item.parent_key] as ProjectRecord | undefined : null;
    if (item.parent_key && !parent) throw new Error(`Missing parent for ${item.name}.`);
    assertParent(item, parent ?? null);
    const seen = new Set<string>([key]);
    let ancestor = parent;
    while (ancestor) {
      if (seen.has(ancestor.key)) throw new Error('Project contains a folder cycle.');
      seen.add(ancestor.key); ancestor = ancestor.parent_key ? records[ancestor.parent_key] as ProjectRecord : null;
    }
    if (item.kind === 'mission' && item.starting_scene_id) {
      const scene = records[itemKey(item.world_id, item.volume_id!, 'scene', item.starting_scene_id)] as ProjectRecord | undefined;
      if (!scene || scene.kind !== 'scene') throw new Error(`Missing starting scene for ${item.name}.`);
    }
  }
  return value as ProjectSnapshot;
}
