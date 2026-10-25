import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDocFromServer, setDoc, type Firestore } from 'firebase/firestore';
import { getDownloadURL, getBytes, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { FirestoreProjectRepository, acknowledgeSaves } from '../src/lib/repositories/firestore';
import { seedProject } from '../src/features/project/migrations';
import { createItem, markChanged, renameItem, trashItem, restoreItem } from '../src/features/project/commands';
import { isTrashed, itemKey, volumeKey } from '../src/features/project/model';

let environment: RulesTestEnvironment;
const vk = volumeKey('sea_wonders','volume_01'), main = itemKey('sea_wonders','volume_01','scene','main');
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Use npm run test:emulator. Tests never connect to production.');
  environment = await initializeTestEnvironment({projectId:'demo-awalem-studio',firestore:{rules:readFileSync('firestore.rules','utf8')},storage:{rules:readFileSync('storage.rules','utf8')}});
});
beforeEach(async () => { await environment.clearFirestore(); await environment.clearStorage(); });
afterAll(async () => { await environment?.cleanup(); });
const adminDB = () => environment.authenticatedContext(`admin-${crypto.randomUUID()}`,{studioAdmin:true}).firestore() as unknown as Firestore;
describe('Firestore project persistence against unchanged rules', () => {
  it('saves and loads nested folders, mission configuration, and independent scenes', async () => {
    const repo = new FirestoreProjectRepository(adminDB()), {project} = seedProject();
    const mission = createItem(project,'mission','Mission 1',vk), folder = createItem(project,'folder','Animals',mission.key);
    const scene = createItem(project,'scene','Reef',folder.key);
    if (mission.kind !== 'mission') throw new Error('fixture');
    mission.description = 'Rescue a dolphin'; mission.starting_scene_id = scene.id;
    const saved = await repo.save(project); expect(saved.failures).toEqual([]); acknowledgeSaves(project,saved.saved);
    expect(project.dirty).toEqual([]);
    const loaded = await repo.load();
    expect(loaded.records[folder.key].parent_key).toBe(mission.key);
    expect(loaded.records[scene.key].parent_key).toBe(folder.key);
    expect(loaded.records[mission.key]).toMatchObject({description:'Rescue a dolphin',starting_scene_id:scene.id});
    expect(loaded.records[main].kind).toBe('scene'); expect(loaded.dirty).toEqual([]);
  });
  it('denies ordinary users, signed-out clients, and writes outside studio paths', async () => {
    const staff = environment.authenticatedContext('staff').firestore() as unknown as Firestore;
    const guest = environment.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDocFromServer(doc(staff,main))); await assertFails(setDoc(doc(staff,main),{}));
    await assertFails(getDocFromServer(doc(guest,main))); await assertFails(setDoc(doc(adminDB(),'player_accounts/test'),{}));
    const denied = await new FirestoreProjectRepository(staff).save(seedProject().project);
    expect(denied.saved).toEqual([]); expect(denied.failures.some(f => f.message.includes('studioAdmin'))).toBe(true);
  });
  it('discovers legacy scenes with missing ancestor documents and detects unversioned conflicts', async () => {
    const db = adminDB(), {project} = seedProject(), record = project.records[main];
    if (record.kind !== 'scene') throw new Error('fixture');
    await setDoc(doc(db,main),{...record.scene,schema_version:1,entities:[{...record.scene.entities[0],x:123}]});
    const repo = new FirestoreProjectRepository(db), loaded = await repo.load();
    expect(loaded.records[main]).toMatchObject({scene:{entities:[{x:123}]}});
    renameItem(loaded,main,'Local name');
    await setDoc(doc(db,main),{...record.scene,schema_version:1,entities:[{...record.scene.entities[0],x:456}]});
    const result = await repo.save(loaded);
    expect(result.failures.some(f => f.message.includes('Conflict'))).toBe(true);
    expect((await getDocFromServer(doc(db,main))).data()?.entities[0].x).toBe(456);
    expect(loaded.dirty).toContain(main);
  });
  it('rejects stale volume saves while acknowledging independent successful scopes', async () => {
    const db = adminDB(), repo = new FirestoreProjectRepository(db), initial = seedProject().project;
    const saved = await repo.save(initial); expect(saved.failures).toEqual([]);
    const a = await repo.load(), b = await repo.load();
    renameItem(a,main,'Remote rename'); expect((await repo.save(a)).failures).toEqual([]);
    renameItem(b,main,'Stale rename');
    const other = itemKey('sea_wonders','volume_02','scene','main'); renameItem(b,other,'Independent rename');
    const result = await repo.save(b); acknowledgeSaves(b,result.saved);
    expect(result.failures).toHaveLength(1); expect(result.failures[0].scope).toBe(vk);
    expect(b.dirty).toContain(main); expect(b.dirty).not.toContain(other);
    expect((await getDocFromServer(doc(db,main))).data()?.name).toBe('Remote rename');
    expect((await getDocFromServer(doc(db,other))).data()?.name).toBe('Independent rename');
  });
  it('retains unrelated existing cloud fields on managed metadata updates', async () => {
    const db = adminDB(), repo = new FirestoreProjectRepository(db);
    const result = await repo.save(seedProject().project); expect(result.failures).toEqual([]);
    await setDoc(doc(db,vk),{future_extension:{keep:true}},{merge:true});
    const loaded = await repo.load(); const volume = loaded.records[vk]; volume.name = 'Renamed'; markChanged(loaded,volume);
    expect((await repo.save(loaded)).failures).toEqual([]);
    expect((await getDocFromServer(doc(db,vk))).data()?.future_extension).toEqual({keep:true});
  });
  it('persists and restores deleted branches without deleting their underlying documents', async () => {
    const db = adminDB(), repo = new FirestoreProjectRepository(db), project = seedProject().project;
    const folder = createItem(project,'folder','Recovery reef',vk), scene = createItem(project,'scene','Retained scene',folder.key);
    const first = await repo.save(project); expect(first.failures).toEqual([]); acknowledgeSaves(project,first.saved);
    trashItem(project,folder.key);
    expect((await repo.save(project)).failures).toEqual([]);
    const trashed = await repo.load(); expect(isTrashed(trashed,scene.key)).toBe(true);
    expect((await getDocFromServer(doc(db,scene.key))).exists()).toBe(true);
    restoreItem(trashed,folder.key); expect((await repo.save(trashed)).failures).toEqual([]);
    expect(isTrashed(await repo.load(),scene.key)).toBe(false);
  });
});
describe('Storage compatibility against unchanged rules', () => {
  it('allows administrator image uploads and downloads but rejects other users and formats', async () => {
    const storage = environment.authenticatedContext('asset-admin',{studioAdmin:true}).storage() as unknown as FirebaseStorage;
    const reference = ref(storage,'studio-worlds/sea_wonders/volumes/volume_01/sprites/stable-test.png');
    const bytes = new Uint8Array([137,80,78,71]);
    await assertSucceeds(uploadBytes(reference,bytes,{contentType:'image/png'}));
    expect(await getDownloadURL(reference)).toContain('stable-test.png');
    expect(new Uint8Array(await getBytes(reference))).toEqual(bytes);
    const staff = environment.authenticatedContext('asset-staff').storage() as unknown as FirebaseStorage;
    await assertFails(uploadBytes(ref(staff,'studio-worlds/sea_wonders/volumes/volume_01/sprites/denied.png'),bytes,{contentType:'image/png'}));
    await assertFails(uploadBytes(ref(storage,'studio-worlds/sea_wonders/volumes/volume_01/sprites/unsafe.svg'),bytes,{contentType:'image/svg+xml'}));
  });
});
