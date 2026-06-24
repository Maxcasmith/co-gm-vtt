import { Router } from 'express';
import path from 'path';
import { CAMPAIGNS_DIR, listMaps } from '../storage.ts';

export const mapsRouter = Router({ mergeParams: true });

mapsRouter.get('/:id/maps', async (req, res) => {
  const maps = await listMaps(req.params.id ?? '');
  res.json(maps);
});

mapsRouter.get('/:id/maps/:mapId', (req, res) => {
  const { id, mapId } = req.params as { id: string; mapId: string };
  res.sendFile(path.join(CAMPAIGNS_DIR, id, 'maps', `${mapId}.jpg`), err => {
    if (err) res.status(404).json({ error: 'Map not found' });
  });
});
