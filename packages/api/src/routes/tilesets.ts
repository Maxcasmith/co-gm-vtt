import { Router } from 'express';
import path from 'path';
import { slugifyTheme } from 'shared';
import { TILESETS_DIR } from '../storage.ts';
import { getMediaStore } from '../storage/index.ts';

export const tilesetsRouter = Router();

// theme/material/file params are only ever used to build a storage key — reject anything
// that isn't already in the exact slugified/known form before it reaches path.join, so a crafted
// "../../" (or similar) 404s instead of traversing.
function isSafeSlug(s: string): boolean {
  return s.length > 0 && slugifyTheme(s) === s;
}

tilesetsRouter.get('/manifest', async (_req, res) => {
  const store = getMediaStore();
  const manifest: Record<string, Record<string, string[]>> = {};

  const themes = await store.list(TILESETS_DIR);
  await Promise.all(themes.map(async theme => {
    const materialsPath = path.join(TILESETS_DIR, theme);
    const materialNames = await store.list(materialsPath);
    const materials: Record<string, string[]> = {};
    await Promise.all(materialNames.map(async material => {
      const files = await store.list(path.join(materialsPath, material));
      materials[material] = files.map(f => `/api/tilesets/${theme}/${material}/${f}`);
    }));
    manifest[theme] = materials;
  }));

  res.json(manifest);
});

tilesetsRouter.get('/:theme/:material/:file', async (req, res) => {
  const { theme, material, file } = req.params as { theme: string; material: string; file: string };
  const isKnownFolder = material === 'source' || material === 'source_extended' || isSafeSlug(material);
  if (!isSafeSlug(theme) || !isKnownFolder || path.basename(file) !== file) {
    res.status(404).json({ error: 'Tile not found' });
    return;
  }
  const data = await getMediaStore().get(path.join(TILESETS_DIR, theme, material, file));
  if (!data) { res.status(404).json({ error: 'Tile not found' }); return; }
  res.type(path.extname(file)).send(data);
});
