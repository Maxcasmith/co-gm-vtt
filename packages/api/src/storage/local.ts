import { readFile, writeFile, mkdir, readdir, rm, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { TextStore, MediaStore } from './types.ts';

const __dir = path.dirname(fileURLToPath(import.meta.url));
// Same physical directory the old flat storage.ts always used — keeps existing on-disk data
// valid with zero migration when STORAGE_TEXT_BACKEND/STORAGE_MEDIA_BACKEND are left at `local`.
export const STORAGE_ROOT = path.resolve(__dir, '../../storage');

function sharedOps() {
  return {
    async delete(key: string): Promise<void> {
      await rm(path.join(STORAGE_ROOT, key), { force: true });
    },
    async exists(key: string): Promise<boolean> {
      return existsSync(path.join(STORAGE_ROOT, key));
    },
    async list(prefix: string): Promise<string[]> {
      const dir = path.join(STORAGE_ROOT, prefix);
      if (!existsSync(dir)) return [];
      return readdir(dir);
    },
    async copyPrefix(srcPrefix: string, dstPrefix: string): Promise<void> {
      const srcPath = path.join(STORAGE_ROOT, srcPrefix);
      if (!existsSync(srcPath)) return;
      const dstPath = path.join(STORAGE_ROOT, dstPrefix);
      await mkdir(path.dirname(dstPath), { recursive: true });
      await cp(srcPath, dstPath, { recursive: true });
    },
    async deletePrefix(prefix: string): Promise<void> {
      await rm(path.join(STORAGE_ROOT, prefix), { recursive: true, force: true });
    },
  };
}

export const localTextStore: TextStore = {
  ...sharedOps(),
  async get(key: string): Promise<string | null> {
    try { return await readFile(path.join(STORAGE_ROOT, key), 'utf-8'); }
    catch { return null; }
  },
  async put(key: string, content: string): Promise<void> {
    const full = path.join(STORAGE_ROOT, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf-8');
  },
};

export const localMediaStore: MediaStore = {
  ...sharedOps(),
  async get(key: string): Promise<Buffer | null> {
    try { return await readFile(path.join(STORAGE_ROOT, key)); }
    catch { return null; }
  },
  async put(key: string, data: Buffer): Promise<void> {
    const full = path.join(STORAGE_ROOT, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  },
};
