import { Router } from 'express';
import type { AppConfig } from 'shared';
import { getConfig, saveConfig } from '../storage.ts';
import { getStoryProvider, getImageProvider } from '../providers/index.ts';

export const configRouter = Router();

configRouter.get('/', async (_req, res) => {
  const config = await getConfig();
  res.json(config);
});

configRouter.put('/', async (req, res) => {
  const incoming = req.body as AppConfig;
  await saveConfig(incoming);
  res.json({ ok: true });
});

configRouter.post('/test', async (req, res) => {
  const { type } = req.body as { type: 'story' | 'image' };
  const config = await getConfig();
  try {
    const ok = type === 'image'
      ? await getImageProvider(config).validateKey()
      : await getStoryProvider(config).validateKey();
    res.json({ ok, message: ok ? 'Connection successful' : 'Invalid API key' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    res.json({ ok: false, message });
  }
});
