import { Router } from 'express';
import type { AppConfig, ModelTier } from 'shared';
import { getConfig, saveConfig } from '../storage.ts';
import { getStoryProvider, getImageProvider, getCombatProvider, buildAdapter, getTierApiKey } from '../providers/index.ts';
import { logError } from '../logger.ts';

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
  const { type } = req.body as { type: 'thinking' | 'light' | 'image' };
  const config = await getConfig();
  try {
    const ok = type === 'image'    ? await getImageProvider(config).validateKey()
             : type === 'light'    ? await getCombatProvider(config).validateKey()
             :                       await getStoryProvider(config).validateKey();
    res.json({ ok, message: ok ? 'Connection successful' : 'Invalid API key' });
  } catch (err) {
    logError('routes/config:test', err);
    const message = err instanceof Error ? err.message : 'Connection failed';
    res.json({ ok: false, message });
  }
});

configRouter.post('/test-chain', async (req, res) => {
  const { chain } = req.body as { chain: ModelTier[] };
  const config = await getConfig();
  const results = await Promise.all(chain.map(async node => {
    try {
      const apiKey = getTierApiKey(config.apiKeys, node.provider);
      if (!apiKey) return 'fail' as const;
      const ok = await buildAdapter(node, apiKey).validateKey();
      return ok ? 'ok' as const : 'fail' as const;
    } catch (err) {
      logError('routes/config:test-chain', err);
      return 'fail' as const;
    }
  }));
  res.json({ results });
});
