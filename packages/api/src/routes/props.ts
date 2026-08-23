import { Router } from 'express';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { slugifyTheme } from 'shared';
import { PROPS_DIR } from '../storage.ts';

export const propsRouter = Router();

// slug/file params are only ever used to build a filesystem path — reject anything that isn't
// already in the exact slugified/known form before it reaches path.join, so a crafted "../../"
// (or similar) 404s instead of traversing. Same pattern as routes/creatures.ts and routes/tilesets.ts.
function isSafeSlug(s: string): boolean {
  return s.length > 0 && slugifyTheme(s) === s;
}

// Gallery listing for the admin Props tab — every generated prop's sprite plus the raw, unmodified
// source atlases saved under _source (same review purpose as tilesets/manifest's source_extended).
propsRouter.get('/manifest', async (_req, res) => {
  if (!existsSync(PROPS_DIR)) { res.json({ props: {}, sources: [] }); return; }

  const entries = (await readdir(PROPS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
  const props: Record<string, string> = {};
  const sources: string[] = [];
  await Promise.all(entries.map(async entry => {
    if (entry.name === '_source') {
      const files = await readdir(path.join(PROPS_DIR, '_source'));
      sources.push(...files.map(f => `/api/props/_source/${f}`));
      return;
    }
    props[entry.name] = `/api/props/${entry.name}/sprite_01.png`;
  }));
  res.json({ props, sources });
});

propsRouter.get('/:slug/:file', (req, res) => {
  const { slug, file } = req.params as { slug: string; file: string };
  const isKnownFolder = slug === '_source' || isSafeSlug(slug);
  if (!isKnownFolder || path.basename(file) !== file) {
    res.status(404).json({ error: 'Sprite not found' });
    return;
  }
  res.sendFile(path.join(PROPS_DIR, slug, file), err => {
    if (err) res.status(404).json({ error: 'Sprite not found' });
  });
});
