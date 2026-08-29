import { Router } from 'express';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { iconSlug } from 'shared';
import { ICONS_DIR } from '../storage.ts';

export const iconsRouter = Router();

// Same traversal guard as routes/props.ts / routes/tilesets.ts, keyed to the icon storage
// convention (storage/icons/<iconSlug(name)>/icon.jpg) rather than slugifyTheme's kebab-case.
function isSafeSlug(s: string): boolean {
  return s.length > 0 && iconSlug(s) === s;
}

// Gallery listing for the admin Items tab's generated-icons view — every generated icon plus the
// raw, unmodified source atlases saved under _source (same review purpose as props/manifest).
iconsRouter.get('/manifest', async (_req, res) => {
  if (!existsSync(ICONS_DIR)) { res.json({ icons: {}, sources: [] }); return; }

  const entries = (await readdir(ICONS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
  const icons: Record<string, string> = {};
  const sources: string[] = [];
  await Promise.all(entries.map(async entry => {
    if (entry.name === '_source') {
      const files = await readdir(path.join(ICONS_DIR, '_source'));
      sources.push(...files.map(f => `/api/icons/_source/${f}`));
      return;
    }
    icons[entry.name] = `/api/icons/${entry.name}/icon.jpg`;
  }));
  res.json({ icons, sources });
});

iconsRouter.get('/:slug/:file', (req, res) => {
  const { slug, file } = req.params as { slug: string; file: string };
  const isKnownFolder = slug === '_source' || isSafeSlug(slug);
  if (!isKnownFolder || path.basename(file) !== file) {
    res.status(404).json({ error: 'Icon not found' });
    return;
  }
  res.sendFile(path.join(ICONS_DIR, slug, file), err => {
    if (err) res.status(404).json({ error: 'Icon not found' });
  });
});
