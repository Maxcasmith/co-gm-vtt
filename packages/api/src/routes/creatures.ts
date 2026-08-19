import { Router } from 'express';
import { existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { slugifyTheme } from 'shared';
import { CREATURES_DIR } from '../storage.ts';

export const creaturesRouter = Router();

// slug/file params are only ever used to build a filesystem path — reject anything that isn't
// already in the exact slugified/known form before it reaches path.join, so a crafted "../../"
// (or similar) 404s instead of traversing. Same pattern as routes/tilesets.ts.
function isSafeSlug(s: string): boolean {
  return s.length > 0 && slugifyTheme(s) === s;
}

function titleCase(s: string): string {
  return s.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface CreatureManifestEntry {
  slug: string;
  name: string;
  cr?: number;
  creatureType?: string;
  portraitSrc?: string;
}

// Mirrors tilesets.ts's manifest — one directory per creature under storage/creatures/, name/cr/
// creatureType read from the stats.json sidecar creaturePortraits.ts writes next to the portrait.
creaturesRouter.get('/manifest', async (_req, res) => {
  const creatures: CreatureManifestEntry[] = [];
  if (existsSync(CREATURES_DIR)) {
    const slugDirs = (await readdir(CREATURES_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
    await Promise.all(slugDirs.map(async dir => {
      const slug = dir.name;
      const entry: CreatureManifestEntry = { slug, name: titleCase(slug) };
      try {
        const stats = JSON.parse(await readFile(path.join(CREATURES_DIR, slug, 'stats.json'), 'utf-8')) as { name?: string; cr?: number; creatureType?: string };
        if (stats.name) entry.name = stats.name;
        if (stats.cr !== undefined) entry.cr = stats.cr;
        if (stats.creatureType !== undefined) entry.creatureType = stats.creatureType;
      } catch { /* no stats.json yet — fall back to slug-derived name */ }
      if (existsSync(path.join(CREATURES_DIR, slug, 'portrait_01.jpg'))) {
        entry.portraitSrc = `/api/creatures/${slug}/portrait_01.jpg`;
      }
      creatures.push(entry);
    }));
  }
  creatures.sort((a, b) => a.name.localeCompare(b.name));
  res.json(creatures);
});

creaturesRouter.get('/:slug/:file', (req, res) => {
  const { slug, file } = req.params as { slug: string; file: string };
  if (!isSafeSlug(slug) || path.basename(file) !== file) {
    res.status(404).json({ error: 'Portrait not found' });
    return;
  }
  res.sendFile(path.join(CREATURES_DIR, slug, file), err => {
    if (err) res.status(404).json({ error: 'Portrait not found' });
  });
});
