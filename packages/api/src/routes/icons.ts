import { Router } from 'express';
import path from 'path';
import { iconSlug } from 'shared';
import { ICONS_DIR } from '../storage.ts';
import { getMediaStore } from '../storage/index.ts';

export const iconsRouter = Router();

// Same traversal guard as routes/props.ts / routes/tilesets.ts, keyed to the icon storage
// convention (storage/icons/<iconSlug(name)>/icon.jpg) rather than slugifyTheme's kebab-case.
function isSafeSlug(s: string): boolean {
  return s.length > 0 && iconSlug(s) === s;
}

// Gallery listing for the admin Items tab's generated-icons view — every generated icon plus the
// raw, unmodified source atlases saved under _source (same review purpose as props/manifest).
iconsRouter.get('/manifest', async (_req, res) => {
  const store = getMediaStore();
  const entries = await store.list(ICONS_DIR);
  const icons: Record<string, string> = {};
  const sources: string[] = [];
  await Promise.all(entries.map(async name => {
    if (name === '_source') {
      const files = await store.list(path.join(ICONS_DIR, '_source'));
      sources.push(...files.map(f => `/api/icons/_source/${f}`));
      return;
    }
    icons[name] = `/api/icons/${name}/icon.jpg`;
  }));
  res.json({ icons, sources });
});

iconsRouter.get('/:slug/:file', async (req, res) => {
  const { slug, file } = req.params as { slug: string; file: string };
  const isKnownFolder = slug === '_source' || isSafeSlug(slug);
  if (!isKnownFolder || path.basename(file) !== file) {
    res.status(404).json({ error: 'Icon not found' });
    return;
  }
  const data = await getMediaStore().get(path.join(ICONS_DIR, slug, file));
  if (!data) { res.status(404).json({ error: 'Icon not found' }); return; }
  res.type(path.extname(file)).send(data);
});
