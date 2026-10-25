import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { requireStudioAdmin } from './studioAuth';

/** Existing sprite paths and MIME restrictions remain compatible with the deployed rule design. */
export async function uploadSprite(file: File, worldId: string, volumeId: string, onProgress?: (percent: number) => void) {
  const { storage } = await requireStudioAdmin();
  if (!storage) throw new Error('Firebase Storage is not configured. Your project drafts still save locally; image importing needs Storage in Phase 1.');
  if (!new Set(['image/png','image/jpeg','image/webp']).has(file.type)) throw new Error('Only PNG, JPEG and WebP sprites are supported.');
  if (file.size >= 10 * 1024 * 1024) throw new Error('Image must be smaller than 10MB.');
  const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90);
  const path = `studio-worlds/${worldId}/volumes/${volumeId}/sprites/${crypto.randomUUID()}-${filename}`;
  const reference = ref(storage,path);
  await new Promise<void>((resolve,reject) => {
    uploadBytesResumable(reference,file,{contentType:file.type}).on('state_changed',
      snapshot => onProgress?.(Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100)), reject, () => resolve());
  });
  return {url:await getDownloadURL(reference),path};
}
