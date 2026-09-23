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

// Gallery listing for the admin Props tab — every generated prop's sprite (paginated, sorted by key
// for a stable page order) plus the raw, unmodified source atlases saved under _source (small and
// shown in full, same review purpose as tilesets/manifest's source_extended — never paginated).
//
// Two layouts coexist on purpose: bucketed <setting>/<tone>/<noun> for everything the catalogue
// pipeline draws, and bare <noun> for sprites generated before bucketing (and by the admin
// prompt-test flow, which belongs to no campaign). A folder is a bucket if it contains folders
// rather than files, which is what the sprite_01.png probe below distinguishes.
propsRouter.get('/manifest', async (req, res) => {
  const { page, pageSize } = parsePageParams(req, 20);
  const store = getMediaStore();
  const sources: string[] = [];
  const keys: string[] = [];

  async function walk(prefix: string, depth: number): Promise<void> {
    // 3 levels is the deepest a bucketed prop sits (<setting>/<tone>/<noun>) — bounds the walk
    // regardless of what else ends up under PROPS_DIR.
    if (depth > 3) return;
    const entries = await store.list(prefix ? path.join(PROPS_DIR, prefix) : PROPS_DIR);
    await Promise.all(entries.map(async name => {
      if (!prefix && name === '_source') {
        const files = await store.list(path.join(PROPS_DIR, '_source'));
        sources.push(...files.map(f => `/api/props/_source/${f}`));
        return;
      }
      const key = prefix ? `${prefix}/${name}` : name;
      if (await store.exists(path.join(PROPS_DIR, key, 'sprite_01.png'))) keys.push(key);
      else await walk(key, depth + 1);
    }));
  }
  await walk('', 1);
  keys.sort();

  const start = (page - 1) * pageSize;
  const props = keys.slice(start, start + pageSize).map(slug => ({ slug, url: `/api/props/${slug}/sprite_01.png` }));
  res.json({ props, total: keys.length, sources });
});

// Variable depth: /_source/<file>, /<noun>/<file> (legacy + admin test), or
// /<setting>/<tone>/<noun>/<file> (bucketed). Every segment is still validated against its own
// slugified form before it reaches path.join, so a crafted "../../" 404s instead of traversing —
// same guarantee the old fixed two-segment route gave.
propsRouter.get('/*splat', async (req, res) => {
  // Express 5 hands a wildcard back as an ARRAY of path segments, already split and decoded —
  // not the single string Express 4 gave. Verified against the installed version; treating it as
  // a string silently 404s every sprite.
  const raw = (req.params as { splat?: string[] | string }).splat;
  const segments = (Array.isArray(raw) ? raw : String(raw ?? '').split('/')).filter(Boolean);
  const file = segments.pop() ?? '';
  const folders = segments;
  const valid = folders.length > 0 && folders.length <= 3
    && folders.every((s, i) => (i === 0 && s === '_source') || isSafeSlug(s))
    && path.basename(file) === file;
  if (!valid) {
    res.status(404).json({ error: 'Sprite not found' });
    return;
  }
  const data = await getMediaStore().get(path.join(PROPS_DIR, ...folders, file));
  if (!data) { res.status(404).json({ error: 'Sprite not found' }); return; }
  res.type(path.extname(file)).send(data);
});
