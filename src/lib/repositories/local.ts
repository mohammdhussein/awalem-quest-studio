import type { ProjectSnapshot } from '../../features/project/model';

const DB_NAME = 'awalem-studio-projects';
type Envelope = { disk_revision: number; project: unknown };
export type RecoveryEntry = { id: number; created_at: string; reason: string; project: unknown };
export class LocalDraftRepository {
  private db?: Promise<IDBDatabase>;
  private revision = 0;
  constructor(private readonly name = DB_NAME) {}
  private open() {
    return this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('drafts'); request.result.createObjectStore('recovery', { autoIncrement: true }); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
      request.onerror = () => reject(request.error ?? new Error('Browser draft storage could not open.'));
      request.onblocked = () => reject(new Error('Close other Studio tabs to finish opening draft storage.'));
    });
  }
  async read(updateRevision = true): Promise<unknown | undefined> {
    const db = await this.open();
    const value = await new Promise<Envelope | undefined>((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get('project');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (updateRevision) this.revision = value?.disk_revision ?? 0;
    return value?.project;
  }
  async write(project: ProjectSnapshot): Promise<void> {
    const db = await this.open();
    const nextRevision = this.revision + 1;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
      let failure: Error | undefined;
      const request = store.get('project');
      request.onsuccess = () => {
        const actual = (request.result as Envelope | undefined)?.disk_revision ?? 0;
        if (actual !== this.revision) { failure = new Error('Another Studio tab changed the local draft. Export this tab’s backup, then reload.'); tx.abort(); return; }
        store.put({ disk_revision: nextRevision, project }, 'project');
      };
      tx.oncomplete = () => { this.revision = nextRevision; resolve(); };
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('Local save failed. Export a backup before closing.'));
    });
  }
  async backup(project: unknown, reason: string) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('recovery', 'readwrite');
      tx.objectStore('recovery').add({ created_at: new Date().toISOString(), reason, project });
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    });
  }
  async recoveries(): Promise<RecoveryEntry[]> {
    const db = await this.open();
    return new Promise((resolve,reject) => {
      const entries: RecoveryEntry[] = [];
      const request = db.transaction('recovery').objectStore('recovery').openCursor(null,'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || entries.length >= 50) { resolve(entries); return; }
        entries.push({...cursor.value,id:Number(cursor.key)}); cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
}
export const localDrafts = new LocalDraftRepository();
