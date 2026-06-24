import { Router } from 'express';
import type { Request, Response } from 'express';
import { rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { CAMPAIGNS_DIR, listCampaigns } from '../storage.ts';

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

adminRouter.delete('/campaigns/:id/chat', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const chatPath = path.join(CAMPAIGNS_DIR, req.params['id']!, 'chat.json');
  try {
    if (existsSync(chatPath)) await rm(chatPath);
    res.json({ ok: true });
  } catch (err) {
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
    res.status(500).json({ ok: false, error: String(err) });
  }
});
