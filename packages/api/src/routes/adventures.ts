import { Router } from 'express';
import { listSavedAdventures, deleteSavedAdventure } from '../adventures/storage.ts';
import { logError } from '../logger.ts';

export const adventuresRouter = Router();

adventuresRouter.get('/', async (_req, res) => {
  try {
    res.json(await listSavedAdventures());
  } catch (err) {
    logError('routes/adventures:list', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

adventuresRouter.delete('/:slug', async (req, res) => {
  try {
    await deleteSavedAdventure(req.params.slug);
    res.json({ ok: true });
  } catch (err) {
    logError('routes/adventures:delete', err);
    res.status(500).json({ error: (err as Error).message });
  }
});
