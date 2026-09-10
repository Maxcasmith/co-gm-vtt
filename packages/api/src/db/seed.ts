import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { getConnection, dbDir } from './connection.ts';

async function seed(): Promise<void> {
  const conn = await getConnection();

  const files = fs
    .readdirSync(path.join(dbDir, 'seed'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dbDir, 'seed', file), 'utf8');
    console.log(`Seeding ${file}`);
    await conn.query(sql);
  }

  await conn.end();
}

seed();
