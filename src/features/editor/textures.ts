import { Assets, type Texture } from "pixi.js";

type Entry = {
  refs: number;
  promise: Promise<Texture>;
  failed: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
const entries = new Map<string, Entry>(),
  unloading = new Map<string, Promise<unknown>>();
/** Shared acquisitions survive StrictMode remounts; release never destroys another view's texture. */
export function acquireTexture(url: string): Promise<Texture> {
  let entry = entries.get(url);
  if (!entry) {
    entry = {
      refs: 0,
      failed: false,
      promise: (unloading.get(url) ?? Promise.resolve()).then(() =>
        Assets.load<Texture>(url),
      ),
    };
    const owned = entry;
    entry.promise.catch(() => {
      owned.failed = true;
    });
    entries.set(url, entry);
  }
  clearTimeout(entry.timer);
  entry.refs++;
  return entry.promise;
}
export function releaseTexture(url: string) {
  const entry = entries.get(url);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs) return;
  if (entry.failed) {
    entries.delete(url);
    return;
  }
  entry.timer = setTimeout(() => {
    if (entry.refs || entries.get(url) !== entry) return;
    entries.delete(url);
    const work = entry.promise
      .then(() => Assets.unload(url))
      .catch(() => {})
      .finally(() => {
        if (unloading.get(url) === work) unloading.delete(url);
      });
    unloading.set(url, work);
  }, 500);
}
