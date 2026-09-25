import { Router } from 'express';
import type { AppConfig, ModelTier } from 'shared';
import { getConfig, saveConfig } from '../storage.ts';
import { getImageProvider, buildAdapter, getTierApiKey } from '../providers/index.ts';
import { requireAdmin } from './admin.ts';
import { logError } from '../logger.ts';

export const configRouter = Router();

// GamePage reads this unauthenticated to pick up narration settings, so the endpoint itself must
// stay open — but the password is write-only from here on, never echoed back to any caller.
// `platform` isn't part of the persisted AppConfig — it's derived from DEPLOY_TARGET (set only by
// the web SaaS deployment; unset/anything else means the Electron app) so the client's
// AppMetaProvider can tell which build it's running in without hardcoding it.
configRouter.get('/', async (_req, res) => {
  const config = await getConfig();
  const platform = process.env.DEPLOY_TARGET === 'saas' ? 'web' : 'desktop';
  // Non-SRD content (Artificer, Aasimar, most backgrounds/feats) is pickable only in development.
  const srdOnly = process.env.NODE_ENV !== 'development';
  res.json({ ...config, adminPassword: '', platform, srdOnly });
});

// Only the admin Settings UI issues PUTs, so gate the write side on the current admin password —
// otherwise an unauthenticated PUT could hand over admin access by setting a new one.
configRouter.put('/', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const incoming = req.body as AppConfig;
  // Blank adminPassword field means "leave it as-is" (the current one is never sent back to the client to prefill).
  if (!incoming.adminPassword?.trim()) {
    const current = await getConfig();
    incoming.adminPassword = current.adminPassword;
  }
  await saveConfig(incoming);
  res.json({ ok: true });
});

configRouter.post('/test', async (req, res) => {
  const config = await getConfig();
  try {
    const ok = await getImageProvider(config).validateKey();
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
