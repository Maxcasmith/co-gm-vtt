import type { TextStore, MediaStore, StorageBackend } from './types.ts';
import { localTextStore, localMediaStore } from './local.ts';
import { s3TextStore, s3MediaStore } from './s3.ts';

export type { TextStore, MediaStore, StorageBackend } from './types.ts';
export { STORAGE_ROOT } from './local.ts';

function readBackend(envVar: string): StorageBackend {
  const value = process.env[envVar];
  return value === 's3' ? value : 'local';
}

const textStores: Record<StorageBackend, TextStore> = { local: localTextStore, s3: s3TextStore };
const mediaStores: Record<StorageBackend, MediaStore> = { local: localMediaStore, s3: s3MediaStore };

export function getTextStore(): TextStore {
  return textStores[readBackend('STORAGE_TEXT_BACKEND')];
}

export function getMediaStore(): MediaStore {
  return mediaStores[readBackend('STORAGE_MEDIA_BACKEND')];
}
