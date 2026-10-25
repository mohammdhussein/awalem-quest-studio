import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LocalDraftRepository } from './local';
import { seedProject } from '../../features/project/migrations';
import { createItem, trashItem } from '../../features/project/commands';
import { isTrashed, volumeKey } from '../../features/project/model';
import { validateProject } from '../../features/project/validation';

describe('durable local drafts', () => {
  it('atomically recovers hierarchy, multiple scene edits, selection and Trash after reopening', async () => {
    const name = crypto.randomUUID(), repository = new LocalDraftRepository(name);
    expect(await repository.read()).toBeUndefined();
    const {project} = seedProject();
    const folder = createItem(project,'folder','Nested',volumeKey('sea_wonders','volume_01'));
    const first = createItem(project,'scene','One',folder.key), second = createItem(project,'scene','Two',folder.key);
    if (first.kind !== 'scene' || second.kind !== 'scene') throw new Error('fixture');
    first.scene.entities = structuredClone((Object.values(project.records).find(r => r.kind === 'scene' && r.id === 'main') as typeof first).scene.entities);
    first.scene.entities[0].x = 876; trashItem(project,folder.key);
    project.selected_key = second.key; project.expanded.push(folder.key);
    await repository.write(project);
    const reopened = validateProject(await new LocalDraftRepository(name).read());
    expect(reopened).toEqual(project); expect(isTrashed(reopened,first.key)).toBe(true);
    expect(Object.values(reopened.records).filter(r => r.kind === 'scene')).toHaveLength(17);
  });
  it('prevents a second tab from silently overwriting a newer local draft', async () => {
    const name = crypto.randomUUID(), a = new LocalDraftRepository(name), b = new LocalDraftRepository(name);
    await a.read(); await b.read(); const {project} = seedProject();
    await a.write(project);
    await expect(b.write(project)).rejects.toThrow('Another Studio tab');
    expect(validateProject(await a.read())).toEqual(project);
  });
  it('retains malformed source data and creates a separate recovery copy', async () => {
    const repo = new LocalDraftRepository(crypto.randomUUID());
    const malformed = {schema_version:999,original:'must survive'};
    await repo.write(malformed as never);
    const read = await repo.read();
    expect(() => validateProject(read)).toThrow('schema');
    await repo.backup(read,'corrupt source'); expect(await repo.read()).toEqual(malformed);
    expect((await repo.recoveries())[0]).toMatchObject({reason:'corrupt source',project:malformed});
  });
  it('reports inaccessible IndexedDB instead of reporting a successful save', async () => {
    const real = globalThis.indexedDB;
    Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open:() => {throw new Error('Storage denied');}}});
    try { await expect(new LocalDraftRepository('denied').write(seedProject().project)).rejects.toThrow('Storage denied'); }
    finally { Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:real}); }
  });
});
