import { describe, expect, it } from 'vitest';
import { createItem, deletionBlockers, duplicateScene, moveItem, renameItem, restoreItem, trashItem, addAsset } from './commands';
import { seedProject } from './migrations';
import { isTrashed, itemKey, volumeKey, worldKey } from './model';
import { validateProject, validateScene } from './validation';
import { catalogLegacyAssets } from '../assets/catalog';

const vk = volumeKey('sea_wonders', 'volume_01');
const main = itemKey('sea_wonders', 'volume_01', 'scene', 'main');
describe('project management', () => {
  it('retains the canonical catalog and supports new worlds and volumes without a maximum', () => {
    const { project } = seedProject();
    expect(Object.values(project.records).filter(r => r.kind === 'world').map(r => r.id)).toEqual(['sea_wonders','jungle_kingdom','birds_of_the_sky','desert_kingdom','polar_explorers']);
    expect(Object.values(project.records).filter(r => r.kind === 'volume')).toHaveLength(15);
    const world = createItem(project,'world','New World',null);
    for (let index = 0; index < 4; index++) createItem(project,'volume',`Volume ${index + 1}`,world.key);
    expect(validateProject(project)).toBe(project);
  });
  it('creates nested folders and missions; rename and move preserve identifiers', () => {
    const { project } = seedProject();
    const folder = createItem(project,'folder','Reef',vk);
    const nested = createItem(project,'folder','Animals',folder.key);
    const mission = createItem(project,'mission','Rescue',vk);
    const scene = createItem(project,'scene','Reef Scene',nested.key);
    renameItem(project,scene.key,'Dolphin Rescue'); moveItem(project,folder.key,mission.key);
    expect(project.records[scene.key].id).toBe(scene.id);
    expect(project.records[nested.key].parent_key).toBe(folder.key);
    expect(project.records[folder.key].parent_key).toBe(mission.key);
    expect(validateProject(project)).toBe(project);
    expect(() => renameItem(project,scene.key,'  ')).toThrow();
  });
  it('rejects cycles, invalid parent types and transfers across volumes', () => {
    const { project } = seedProject();
    const a = createItem(project,'folder','A',vk), b = createItem(project,'folder','B',a.key);
    expect(() => moveItem(project,a.key,b.key)).toThrow('descendants');
    expect(() => moveItem(project,a.key,main)).toThrow('compatible');
    expect(() => moveItem(project,a.key,volumeKey('sea_wonders','volume_02'))).toThrow('same volume');
    expect(() => moveItem(project,vk,worldKey('jungle_kingdom'))).toThrow('within a volume');
  });
  it('duplicates scenes with independent object IDs and shared asset references', () => {
    const { project } = seedProject();
    const original = project.records[main];
    if (original.kind !== 'scene') throw new Error('fixture');
    original.scene.entities[0].assetId = 'shared';
    const copy = duplicateScene(project,main);
    if (copy.kind !== 'scene') throw new Error('fixture');
    expect(copy.id).not.toBe(original.id);
    expect(copy.scene.scene_id).toBe(copy.id);
    expect(copy.scene.entities[0].id).not.toBe(original.scene.entities[0].id);
    expect(copy.scene.entities[0].assetId).toBe('shared');
    copy.scene.entities[0].x = 999;
    expect(original.scene.entities[0].x).not.toBe(999);
  });
  it('protects mission starting scenes and assets referenced outside a deleted branch', () => {
    const { project } = seedProject();
    const mission = createItem(project,'mission','Mission 1',vk);
    if (mission.kind !== 'mission') throw new Error('fixture');
    mission.starting_scene_id = 'main';
    expect(deletionBlockers(project,main)).toEqual(['Mission 1 starts in Main Scene']);
    expect(() => trashItem(project,main)).toThrow('referenced');
    const asset = addAsset(project,vk,{name:'Dolphin',url:'https://example.test/dolphin.png',storage_path:'original/path.png',width:64,height:32,size:100,mime:'image/png'});
    const scene = project.records[main];
    if (scene.kind !== 'scene') throw new Error('fixture');
    scene.scene.entities[0] = {...scene.scene.entities[0],assetId:asset.id,assetUrl:asset.url};
    expect(() => trashItem(project,asset.key)).toThrow('uses Dolphin');
    expect(() => trashItem(project,vk)).not.toThrow();
    expect(isTrashed(project,asset.key)).toBe(true);
    restoreItem(project,vk);
    expect(isTrashed(project,asset.key)).toBe(false);
    expect(project.records[asset.key]).toBe(asset);
  });
  it('retains deleted branches across validation and rejects restoration under a deleted parent', () => {
    const { project } = seedProject();
    const folder = createItem(project,'folder','Reef',vk), child = createItem(project,'folder','Child',folder.key);
    trashItem(project,child.key); trashItem(project,folder.key);
    expect(() => restoreItem(project,child.key)).toThrow('parent');
    const reloaded = validateProject(JSON.parse(JSON.stringify(project)));
    expect(isTrashed(reloaded,folder.key)).toBe(true);
    restoreItem(reloaded,folder.key); restoreItem(reloaded,child.key);
    expect(isTrashed(reloaded,child.key)).toBe(false);
  });
  it('requires restoring a scene’s deleted asset before restoring the scene', () => {
    const {project} = seedProject();
    const scene = project.records[main]; if (scene.kind !== 'scene') throw new Error('fixture');
    const asset = addAsset(project,vk,{name:'Fish',url:'https://example.test/fish.png',storage_path:null,width:10,height:10,size:20,mime:'image/png'});
    scene.scene.entities[0] = {...scene.scene.entities[0],assetId:asset.id,assetUrl:asset.url};
    trashItem(project,main); trashItem(project,asset.key);
    expect(() => restoreItem(project,main)).toThrow('referenced content');
    expect(scene.deleted_at).not.toBeNull(); restoreItem(project,asset.key); restoreItem(project,main);
    expect(isTrashed(project,main)).toBe(false);
  });
});
describe('migration and validation', () => {
  it('migrates legacy drafts without deleting source keys and catalogs images once', () => {
    const source = seedProject().project.records[main];
    if (source.kind !== 'scene') throw new Error('fixture');
    const legacy = {...source.scene,schema_version:1,entities:source.scene.entities.map((e,index) => index ? e : {...e,shape:'image',assetUrl:'https://example.test/fish.png',assetPath:'keep/original.png'})};
    const values = new Map([['awalem-studio-25d:sea_wonders:volume_01',JSON.stringify(legacy)]]);
    const {project,warnings} = seedProject({getItem:key => values.get(key) ?? null});
    expect(warnings).toEqual([]);
    expect(values.size).toBe(1);
    const migrated = project.records[main];
    if (migrated.kind !== 'scene') throw new Error('fixture');
    expect(migrated.scene.schema_version).toBe(2);
    expect(migrated.scene.entities[0].assetPath).toBe('keep/original.png');
    expect(migrated.scene.entities[0].assetId).toBeTruthy();
    expect(Object.values(project.records).filter(r => r.kind === 'asset')).toHaveLength(1);
    expect(validateProject(structuredClone(project))).toEqual(project);
  });
  it('reports malformed legacy data while retaining the source', () => {
    const raw = '{broken';
    const {project,warnings,legacyRecovery} = seedProject({getItem:key => key.endsWith('sea_wonders:volume_01') ? raw : null});
    expect(warnings).toHaveLength(1); expect(project.records[main]).toBeDefined();
    expect(legacyRecovery['awalem-studio-25d:sea_wonders:volume_01']).toBe(raw);
  });
  it('never overwrites an existing stable asset record when legacy URLs differ', () => {
    const {project} = seedProject();
    const asset = addAsset(project,vk,{name:'Original',url:'https://example.test/original.png',storage_path:null,width:null,height:null,size:null,mime:null});
    const scene = project.records[main]; if (scene.kind !== 'scene') throw new Error('fixture');
    scene.scene.entities[0] = {...scene.scene.entities[0],assetId:asset.id,assetUrl:'https://example.test/legacy.png'};
    catalogLegacyAssets(project);
    expect(project.records[asset.key]).toEqual(asset); expect(asset.url).toBe('https://example.test/original.png');
  });
  it('rejects future schemas, duplicate object IDs, unsafe URLs and malformed remote metadata', () => {
    const scene = seedProject().project.records[main]; if (scene.kind !== 'scene') throw new Error('fixture');
    expect(() => validateScene({...scene.scene,schema_version:99},'sea_wonders','volume_01')).toThrow();
    expect(() => validateScene({...scene.scene,entities:[scene.scene.entities[0],scene.scene.entities[0]]},'sea_wonders','volume_01')).toThrow('duplicate');
    expect(() => validateScene({...scene.scene,entities:[{...scene.scene.entities[0],assetUrl:'javascript:alert(1)'}]},'sea_wonders','volume_01')).toThrow('HTTP');
    const {project} = seedProject(); project.records[main].parent_key = main;
    expect(() => validateProject(project)).toThrow();
  });
});
