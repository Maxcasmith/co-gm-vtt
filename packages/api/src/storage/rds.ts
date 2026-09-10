import mysql from 'mysql2/promise';
import type { TextStore, MediaStore } from './types.ts';

// Same pool pattern/env vars as licenses/db.ts — one MySQL instance backs both the relational
// auth/license tables and this generic key-value table for the storage abstraction.
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'co_gm_vtt',
});

function normalizePrefix(prefix: string): string {
  return prefix.endsWith('/') || prefix === '' ? prefix : `${prefix}/`;
}

function sharedOps() {
  return {
    async delete(key: string): Promise<void> {
      await pool.query('DELETE FROM storage_objects WHERE store_key = ?', [key]);
    },
    async exists(key: string): Promise<boolean> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT 1 FROM storage_objects WHERE store_key = ? LIMIT 1', [key],
      );
      return rows.length > 0;
    },
    // One level deep, mirroring local's readdir semantics: the distinct next path segment
    // after `prefix` among all keys that start with it.
    async list(prefix: string): Promise<string[]> {
      const normalized = normalizePrefix(prefix);
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT DISTINCT SUBSTRING_INDEX(SUBSTRING(store_key, LENGTH(?) + 1), '/', 1) AS name
         FROM storage_objects WHERE store_key LIKE CONCAT(?, '%')`,
        [normalized, normalized],
      );
      return rows.map(r => r.name as string);
    },
    async copyPrefix(srcPrefix: string, dstPrefix: string): Promise<void> {
      await pool.query(
        `INSERT INTO storage_objects (store_key, content_text, content_blob)
         SELECT CONCAT(?, SUBSTRING(store_key, LENGTH(?) + 1)), content_text, content_blob
         FROM storage_objects WHERE store_key LIKE CONCAT(?, '%')
         ON DUPLICATE KEY UPDATE content_text = VALUES(content_text), content_blob = VALUES(content_blob)`,
        [dstPrefix, srcPrefix, srcPrefix],
      );
    },
    async deletePrefix(prefix: string): Promise<void> {
      await pool.query('DELETE FROM storage_objects WHERE store_key LIKE CONCAT(?, \'%\')', [prefix]);
    },
  };
}

export const rdsTextStore: TextStore = {
  ...sharedOps(),
  async get(key: string): Promise<string | null> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT content_text FROM storage_objects WHERE store_key = ?', [key],
    );
    return rows[0]?.content_text ?? null;
  },
  async put(key: string, content: string): Promise<void> {
    await pool.query(
      `INSERT INTO storage_objects (store_key, content_text) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE content_text = VALUES(content_text)`,
      [key, content],
    );
  },
};

export const rdsMediaStore: MediaStore = {
  ...sharedOps(),
  async get(key: string): Promise<Buffer | null> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT content_blob FROM storage_objects WHERE store_key = ?', [key],
    );
    return rows[0]?.content_blob ?? null;
  },
  async put(key: string, data: Buffer): Promise<void> {
    await pool.query(
      `INSERT INTO storage_objects (store_key, content_blob) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE content_blob = VALUES(content_blob)`,
      [key, data],
    );
  },
};
