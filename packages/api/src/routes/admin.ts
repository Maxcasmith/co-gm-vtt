import { Router } from 'express';
import type { Request, Response } from 'express';
import { rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { CAMPAIGNS_DIR, getWorldMeta, listCampaigns } from '../storage.ts';
import { saveCampaignAsAdventure, SAVED_ADVENTURES_DIR } from '../adventures/storage.ts';
import { logError } from '../logger.ts';

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Same collision-avoidance pattern as routes/campaigns.ts's uniqueSlug, scoped to the saved-adventures dir.
function uniqueAdventureSlug(base: string): string {
  let slug = base;
  let n = 2;
  while (existsSync(path.join(SAVED_ADVENTURES_DIR, slug))) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

export const adminRouter = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin';

function requireAdmin(req: Request, res: Response): boolean {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

adminRouter.post('/auth', (req, res) => {
  const { password } = req.body as { password?: string };
  res.json({ ok: password === ADMIN_PASSWORD });
});

adminRouter.get('/campaigns', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(await listCampaigns());
});

adminRouter.delete('/campaigns/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const campaignDir = path.join(CAMPAIGNS_DIR, req.params['id']!);
  try {
    if (existsSync(campaignDir)) await rm(campaignDir, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    logError('routes/admin:deleteCampaign', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

adminRouter.delete('/campaigns/:id/chat', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const chatPath = path.join(CAMPAIGNS_DIR, req.params['id']!, 'chat.json');
  try {
    if (existsSync(chatPath)) await rm(chatPath);
    res.json({ ok: true });
  } catch (err) {
    logError('routes/admin:deleteChat', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

adminRouter.post('/campaigns/:id/save-adventure', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const campaignSlug = req.params['id']!;
  const { name } = req.body as { name?: string };
  try {
    const meta = await getWorldMeta(campaignSlug);
    const adventureName = name || meta?.name || campaignSlug;
    const adventureSlug = uniqueAdventureSlug(slugify(adventureName));
    await saveCampaignAsAdventure(campaignSlug, adventureSlug, adventureName);
    res.json({ ok: true, slug: adventureSlug });
  } catch (err) {
    logError('routes/admin:saveAdventure', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

adminRouter.delete('/campaigns/:id/sessions', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const sessionsDir = path.join(CAMPAIGNS_DIR, req.params['id']!, 'sessions');
  try {
    if (existsSync(sessionsDir)) {
      const files = await readdir(sessionsDir);
      await Promise.all(files.map(f => rm(path.join(sessionsDir, f))));
    }
    res.json({ ok: true });
  } catch (err) {
    logError('routes/admin:deleteSessions', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});
