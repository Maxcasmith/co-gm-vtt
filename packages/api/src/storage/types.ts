// Storage abstraction: everything above this layer works with string keys that mirror the
// existing local-disk relative paths (e.g. `campaigns/{slug}/world.json`,
// `campaigns/{slug}/party/{charId}/portrait.jpg`) — a backend just decides where those keys
// physically live. TextStore holds JSON/markdown/text content, MediaStore holds binary blobs
// (images). Split in two because they're configured independently (STORAGE_TEXT_BACKEND /
// STORAGE_MEDIA_BACKEND) — an Electron build keeps both local, a SaaS deploy can point media at
// S3 and text at RDS without the two choices being coupled.
export interface TextStore {
  get(key: string): Promise<string | null>;
  put(key: string, content: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Immediate child names directly under `prefix`, one level deep (like `readdir`) — not full
   * keys, and not recursive. Every real call site (listCampaigns, listCharacters, listEntitySlugs,
   * ...) only ever needs one level; join the returned name back onto `prefix` to build a key. */
  list(prefix: string): Promise<string[]>;
  copyPrefix(srcPrefix: string, dstPrefix: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

export interface MediaStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  copyPrefix(srcPrefix: string, dstPrefix: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

export type StorageBackend = 'local' | 's3' | 'rds';
