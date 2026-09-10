import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { getDatabase } from '../services/Database/Database.ts';

export const modelsRouter = Router();

interface ModelRow extends RowDataPacket {
  id: string;
  provider_id: string;
  provider_label: string;
  label: string;
  supports_effort: number;
}

interface ModelCatalogEntry {
  id: string;
  label: string;
  models: { id: string; label: string; supportsEffort?: boolean }[];
}

// Client seeds its select from a local hardcoded copy first, then overwrites it with this
// response in the background — so this only needs to run once the DB is reachable.
modelsRouter.get('/', async (_req, res) => {
  const db = getDatabase();
  const [rows] = await db.query<ModelRow[]>(
    `SELECT m.code AS id, p.code AS provider_id, p.label AS provider_label, m.label, m.supports_effort
     FROM models m JOIN providers p ON p.id = m.provider_id
     ORDER BY p.sort_order, m.sort_order`
  );

  const grouped: ModelCatalogEntry[] = [];
  for (const row of rows) {
    let group = grouped.find(g => g.id === row.provider_id);
    if (!group) {
      group = { id: row.provider_id, label: row.provider_label, models: [] };
      grouped.push(group);
    }
    group.models.push({ id: row.id, label: row.label, ...(row.supports_effort ? { supportsEffort: true } : {}) });
  }

  res.json(grouped);
});
