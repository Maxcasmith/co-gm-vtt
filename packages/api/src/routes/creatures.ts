import { Router } from 'express';
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
