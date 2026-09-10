import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { getConnection, dbDir } from './connection.ts';

async function ensureMigrationsTable(conn: mysql.Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name VARCHAR(255) PRIMARY KEY,
      run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function listMigrationNames(): string[] {
  return fs
    .readdirSync(path.join(dbDir, 'up'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.slice(0, -4))
    .sort();
}

async function up(conn?: mysql.Connection): Promise<void> {
  const ownConn = !conn;
  conn ??= await getConnection();
  await ensureMigrationsTable(conn);

  const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT name FROM migrations');
  const applied = new Set(rows.map((r) => r.name));

  // shared timestamp so migrations applied in this run form one rollback-able batch
  const runAt = new Date();

  for (const name of listMigrationNames()) {
    if (applied.has(name)) continue;

    const sql = fs.readFileSync(path.join(dbDir, 'up', `${name}.sql`), 'utf8');
    console.log(`Applying ${name}`);
    await conn.query(sql);
    await conn.query('INSERT INTO migrations (name, run_at) VALUES (?, ?)', [name, runAt]);
  }

  if (ownConn) await conn.end();
}

async function down(): Promise<void> {
  const conn = await getConnection();
  await ensureMigrationsTable(conn);

  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT name FROM migrations ORDER BY run_at DESC, name DESC LIMIT 1'
  );
  const last = rows[0];
  if (!last) {
    console.log('No migrations to revert');
    await conn.end();
    return;
  }

  const sql = fs.readFileSync(path.join(dbDir, 'down', `${last.name}.sql`), 'utf8');
  console.log(`Reverting ${last.name}`);
  await conn.query(sql);
  await conn.query('DELETE FROM migrations WHERE name = ?', [last.name]);

  await conn.end();
}

async function rollback(): Promise<void> {
  const conn = await getConnection();
  await ensureMigrationsTable(conn);

  const [[latest]] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT MAX(run_at) AS run_at FROM migrations'
  );
  if (!latest.run_at) {
    console.log('No migrations to rollback');
    await conn.end();
    return;
  }

  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT name FROM migrations WHERE run_at = ? ORDER BY name DESC',
    [latest.run_at]
  );

  for (const { name } of rows) {
    const sql = fs.readFileSync(path.join(dbDir, 'down', `${name}.sql`), 'utf8');
    console.log(`Reverting ${name}`);
    await conn.query(sql);
    await conn.query('DELETE FROM migrations WHERE name = ?', [name]);
  }

  await conn.end();
}

async function fresh(): Promise<void> {
  const conn = await getConnection();

  const [tables] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()'
  );

  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { name } of tables) {
    console.log(`Dropping ${name}`);
    await conn.query(`DROP TABLE IF EXISTS \`${name}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  await up(conn);
  await conn.end();
}

const direction = process.argv[2];
if (direction === 'down') {
  down();
} else if (direction === 'rollback') {
  rollback();
} else if (direction === 'fresh') {
  fresh();
} else {
  up();
}
