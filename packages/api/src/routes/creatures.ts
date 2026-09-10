import { Router } from 'express';
import path from 'path';
import { slugifyTheme } from 'shared';
import type { EnemyStatBlock } from 'shared';
import { CREATURES_DIR } from '../storage.ts';
import { getTextStore, getMediaStore } from '../storage/index.ts';

export const creaturesRouter = Router();

// slug/file params are only ever used to build a storage key — reject anything that isn't
// already in the exact slugified/known form before it reaches path.join, so a crafted "../../"
// (or similar) 404s instead of traversing. Same pattern as routes/tilesets.ts.
function isSafeSlug(s: string): boolean {
  return s.length > 0 && slugifyTheme(s) === s;
}

function titleCase(s: string): string {
  return s.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Everything creaturePortraits.ts's writeStatsIfMissing persists — see that function for which
// EnemyStatBlock fields survive (runtime-only ones like id/ownerId/conditions don't).
type PersistedStats = Partial<Pick<EnemyStatBlock, 'name' | 'cr' | 'creatureType' | 'hp' | 'ac' | 'speed' | 'stats' | 'attacks' | 'actions' | 'appearance' | 'role' | 'damageResistances' | 'damageVulnerabilities' | 'damageImmunities'>>;

interface CreatureManifestEntry extends PersistedStats {
  slug: string;
  name: string;
  portraitSrc?: string;
}

// Mirrors tilesets.ts's manifest — one directory per creature under storage/creatures/, full
// stat block read from the stats.json sidecar creaturePortraits.ts writes next to the portrait
// (name/cr/creatureType always present once dungeon-generated; older sidecars from before the
// stat block expansion just come back with those three fields and nothing else).
creaturesRouter.get('/manifest', async (_req, res) => {
  const textStore = getTextStore();
  const mediaStore = getMediaStore();
  const creatures: CreatureManifestEntry[] = [];
  const slugs = (await mediaStore.list(CREATURES_DIR)).filter(s => s !== '_source');
  await Promise.all(slugs.map(async slug => {
    let stats: PersistedStats = {};
    try {
      const raw = await textStore.get(path.join(CREATURES_DIR, slug, 'stats.json'));
      if (raw !== null) stats = JSON.parse(raw) as PersistedStats;
    } catch { /* no stats.json yet — fall back to slug-derived name */ }
    const entry: CreatureManifestEntry = { ...stats, slug, name: stats.name ?? titleCase(slug) };
    if (await mediaStore.exists(path.join(CREATURES_DIR, slug, 'portrait_01.jpg'))) {
      entry.portraitSrc = `/api/creatures/${slug}/portrait_01.jpg`;
    }
    creatures.push(entry);
  }));
  creatures.sort((a, b) => a.name.localeCompare(b.name));
  res.json(creatures);
});

creaturesRouter.get('/:slug/:file', async (req, res) => {
  const { slug, file } = req.params as { slug: string; file: string };
  if (!isSafeSlug(slug) || path.basename(file) !== file) {
    res.status(404).json({ error: 'Portrait not found' });
    return;
  }
  const data = await getMediaStore().get(path.join(CREATURES_DIR, slug, file));
  if (!data) { res.status(404).json({ error: 'Portrait not found' }); return; }
  res.type(path.extname(file)).send(data);
});
