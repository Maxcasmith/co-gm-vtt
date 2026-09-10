import { Router } from 'express';
import path from 'path';
import { CAMPAIGNS_DIR, PREMADE_DIR, listMaps } from '../storage.ts';
import { getMediaStore } from '../storage/index.ts';

export const mapsRouter = Router({ mergeParams: true });

mapsRouter.get('/:id/maps', async (req, res) => {
  const maps = await listMaps(req.params.id ?? '');
  res.json(maps);
});

mapsRouter.get('/:id/maps/:mapId', async (req, res) => {
  const { id, mapId } = req.params as { id: string; mapId: string };
  const store = getMediaStore();
  const data = (await store.get(path.join(CAMPAIGNS_DIR, id, 'maps', `${mapId}.jpg`)))
    ?? (await store.get(path.join(PREMADE_DIR, `${mapId}.jpg`)));
  if (!data) { res.status(404).json({ error: 'Map not found' }); return; }
  res.type('.jpg').send(data);
});
