import { Router } from 'express';
import path from 'path';
import { slugifyTheme } from 'shared';
import { PROPS_DIR } from '../storage.ts';
import { getMediaStore } from '../storage/index.ts';
import { parsePageParams } from '../utils/pagination.ts';

export const propsRouter = Router();

// slug/file params are only ever used to build a storage key — reject anything that isn't
// already in the exact slugified/known form before it reaches path.join, so a crafted "../../"
// (or similar) 404s instead of traversing. Same pattern as routes/creatures.ts and routes/tilesets.ts.
function isSafeSlug(s: string): boolean {
  return s.length > 0 && slugifyTheme(s) === s;
}

// Gallery listing for the admin Props tab — every generated prop's sprite (paginated, sorted by
// slug for a stable page order) plus the raw, unmodified source atlases saved under _source (small
// and shown in full, same review purpose as tilesets/manifest's source_extended — never paginated).
propsRouter.get('/manifest', async (req, res) => {
  const { page, pageSize } = parsePageParams(req, 20);
  const store = getMediaStore();
  const entries = await store.list(PROPS_DIR);
  const sources: string[] = [];
  const slugs: string[] = [];
  await Promise.all(entries.map(async name => {
    if (name === '_source') {
      const files = await store.list(path.join(PROPS_DIR, '_source'));
      sources.push(...files.map(f => `/api/props/_source/${f}`));
      return;
    }
    slugs.push(name);
  }));
  slugs.sort();

  const start = (page - 1) * pageSize;
  const props = slugs.slice(start, start + pageSize).map(slug => ({ slug, url: `/api/props/${slug}/sprite_01.png` }));
  res.json({ props, total: slugs.length, sources });
});

propsRouter.get('/:slug/:file', async (req, res) => {
  const { slug, file } = req.params as { slug: string; file: string };
  const isKnownFolder = slug === '_source' || isSafeSlug(slug);
  if (!isKnownFolder || path.basename(file) !== file) {
    res.status(404).json({ error: 'Sprite not found' });
    return;
  }
  const data = await getMediaStore().get(path.join(PROPS_DIR, slug, file));
  if (!data) { res.status(404).json({ error: 'Sprite not found' }); return; }
  res.type(path.extname(file)).send(data);
});
