import { Router } from 'express';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { slugifyTheme } from 'shared';
import { TILESETS_DIR } from '../storage.ts';

export const tilesetsRouter = Router();

// theme/material/file params are only ever used to build a filesystem path — reject anything
// that isn't already in the exact slugified/known form before it reaches path.join, so a crafted
// "../../" (or similar) 404s instead of traversing.
function isSafeSlug(s: string): boolean {
  return s.length > 0 && slugifyTheme(s) === s;
}

tilesetsRouter.get('/manifest', async (_req, res) => {
  const manifest: Record<string, Record<string, string[]>> = {};
  if (!existsSync(TILESETS_DIR)) { res.json(manifest); return; }

  const themeDirs = (await readdir(TILESETS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
  await Promise.all(themeDirs.map(async themeDir => {
    const theme = themeDir.name;
    const materialsPath = path.join(TILESETS_DIR, theme);
    const materialDirs = (await readdir(materialsPath, { withFileTypes: true })).filter(e => e.isDirectory());
    const materials: Record<string, string[]> = {};
    await Promise.all(materialDirs.map(async materialDir => {
      const material = materialDir.name;
      const files = await readdir(path.join(materialsPath, material));
      materials[material] = files.map(f => `/api/tilesets/${theme}/${material}/${f}`);
    }));
    manifest[theme] = materials;
  }));

  res.json(manifest);
});

tilesetsRouter.get('/:theme/:material/:file', (req, res) => {
  const { theme, material, file } = req.params as { theme: string; material: string; file: string };
  const isKnownFolder = material === 'source' || material === 'source_extended' || isSafeSlug(material);
  if (!isSafeSlug(theme) || !isKnownFolder || path.basename(file) !== file) {
    res.status(404).json({ error: 'Tile not found' });
    return;
  }
  res.sendFile(path.join(TILESETS_DIR, theme, material, file), err => {
    if (err) res.status(404).json({ error: 'Tile not found' });
  });
});
