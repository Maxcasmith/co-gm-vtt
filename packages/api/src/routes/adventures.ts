import { Router } from 'express';
import path from 'path';
import type { Dungeon } from 'shared';
import { listSavedAdventures, deleteSavedAdventure, SAVED_ADVENTURES_DIR } from '../adventures/storage.ts';
import { getTextStore } from '../storage/index.ts';
import { deleteUnusedResources, type ResourceCleanupRequest } from '../resourceUsage.ts';
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
  const slug = req.params.slug;
  try {
    const { resources } = req.body as { resources?: ResourceCleanupRequest };
    let messages: string[] = [];
    if (resources && (resources.tiles || resources.creatures || resources.props)) {
      try {
        const raw = await getTextStore().get(path.join(SAVED_ADVENTURES_DIR, slug, 'dungeon.json'));
        if (raw !== null) {
          const dungeon = JSON.parse(raw) as Dungeon;
          messages = await deleteUnusedResources(dungeon, resources, { excludeId: slug, excludeKind: 'saved-adventure' });
        }
      } catch (err) {
        logError('routes/adventures:delete:resources', err);
      }
    }
    await deleteSavedAdventure(slug);
    res.json({ ok: true, messages });
  } catch (err) {
    logError('routes/adventures:delete', err);
    res.status(500).json({ error: (err as Error).message });
  }
});
