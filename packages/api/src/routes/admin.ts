import { Router } from 'express';
import type { Request, Response } from 'express';
import { rm, readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { slugifyTheme } from 'shared';
import type { Dungeon, DungeonMaterialSpec } from 'shared';
import { CAMPAIGNS_DIR, PROPS_DIR, TILESETS_DIR, getConfig, getWorldMeta, listCampaigns } from '../storage.ts';
import { saveCampaignAsAdventure, SAVED_ADVENTURES_DIR } from '../adventures/storage.ts';
import { generateExtendedTileset } from '../dungeon/tilesets.ts';
import { generatePropSpriteBatch, previewGridCells } from '../dungeon/props.ts';
import type { PendingProp } from '../dungeon/props.ts';
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

export function requireAdmin(req: Request, res: Response): boolean {
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

// SSE, mirrors campaigns.ts's generate stream — `data: {type: 'progress'|'complete'|'error', ...}`
// lines, one per generateExtendedTileset step. Title becomes the folder/matching slug, theme is
// the prompt text — see dungeon/tilesets.ts for why those are separate fields here. Always the
// 16-tile 4x4 pipeline — the old 8-tile/2:1 mode-selection is retired, see tilesets.ts.
adminRouter.post('/tilesets/generate', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { title, theme, materials: rawMaterials } = req.body as { title?: string; theme?: string; materials?: DungeonMaterialSpec[] };
  const materials = (Array.isArray(rawMaterials) ? rawMaterials : [])
    .filter((m): m is DungeonMaterialSpec => !!m?.key?.trim() && !!m?.description?.trim())
    .slice(0, 16);
  if (!title?.trim() || !theme?.trim() || !materials.length) {
    res.status(400).json({ error: 'title, theme, and at least one material (key + description) are required' });
    return;
  }

  const config = await getConfig();
  const apiKey = config.apiKeys.openai;
  if (!apiKey) {
    res.status(400).json({ error: 'No OpenAI API key configured' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  function send(data: object) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  try {
    await generateExtendedTileset(title, theme, materials, apiKey, config.image.model, message => send({ type: 'progress', message }));
    send({ type: 'complete' });
  } catch (err) {
    logError('routes/admin:generateExtendedTileset', err);
    send({ type: 'error', message: err instanceof Error ? err.message : 'Generation failed' });
  } finally {
    res.end();
  }
});

adminRouter.delete('/tilesets/:theme', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const theme = req.params['theme']!;
  if (slugifyTheme(theme) !== theme) {
    res.status(400).json({ error: 'Invalid theme' });
    return;
  }
  const dir = path.join(TILESETS_DIR, theme);
  try {
    if (existsSync(dir)) await rm(dir, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    logError('routes/admin:deleteTileset', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Prefill source for the Props tab's "test the prompt" flow — real, already-shipped prop names
// pulled from a saved adventure's dungeon, so testing the sprite prompt doesn't require spending
// money generating a whole new dungeon just to get a batch of names. The saved dungeon.json never
// kept the manifest LLM's vivid descriptions (only assignPropSpriteSrcs' bare names survive on the
// entity), so description gets a generic templated placeholder — admin can hand-edit it in the
// sidebar before firing.
const PROP_TEST_ADVENTURE_SLUG = 'the-drowned-choir-of-vessalune';

// Distinct wording from `name` (not just a copy of it) so the two fields don't read as duplicates,
// while still being non-empty so Generate doesn't require editing every row before it's usable.
function placeholderDescription(name: string): string {
  return `A weathered, dungeon-appropriate ${name.toLowerCase()}, rendered in a cohesive dark-fantasy art style.`;
}

adminRouter.get('/props/test-manifest', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const raw = await readFile(path.join(SAVED_ADVENTURES_DIR, PROP_TEST_ADVENTURE_SLUG, 'dungeon.json'), 'utf-8');
    const dungeon = JSON.parse(raw) as Dungeon;
    const seen = new Set<string>();
    const props: PendingProp[] = [];
    for (const entity of dungeon.entities) {
      if (entity.type !== 'object' || entity.followsId) continue;
      const slug = slugifyTheme(entity.name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      props.push({ slug, name: entity.name, description: placeholderDescription(entity.name) });
    }
    res.json({ props });
  } catch (err) {
    logError('routes/admin:propTestManifest', err);
    res.status(500).json({ error: 'Could not load test manifest' });
  }
});

// SSE, mirrors /tilesets/generate — fires generatePropSpriteBatch directly against a hand-picked
// list (bypassing generatePropSprites' skip-if-exists/chunking, which exist for the real dungeon
// flow, not for repeatedly re-testing the same prompt tweak). Always overwrites existing sprites.
adminRouter.post('/props/generate', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { props: rawProps } = req.body as { props?: PendingProp[] };
  const props = (Array.isArray(rawProps) ? rawProps : [])
    .filter((p): p is PendingProp => !!p?.slug?.trim() && !!p?.name?.trim() && !!p?.description?.trim())
    .slice(0, 32);
  if (!props.length) {
    res.status(400).json({ error: 'At least one prop (slug + name + description) is required' });
    return;
  }

  const config = await getConfig();
  const apiKey = config.apiKeys.openai;
  if (!apiKey) {
    res.status(400).json({ error: 'No OpenAI API key configured' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  function send(data: object) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  try {
    await generatePropSpriteBatch(props, apiKey, config.image.model, message => send({ type: 'progress', message }));
    send({ type: 'complete' });
  } catch (err) {
    logError('routes/admin:generatePropSpriteBatch', err);
    send({ type: 'error', message: err instanceof Error ? err.message : 'Generation failed' });
  } finally {
    res.end();
  }
});

// Runs the real crop/grid-detection pipeline against an already-saved source atlas — no AI call, so
// prompt/crop tweaks can be checked for free against every atlas already paid for. `file` is a
// _source filename only (never a path), same traversal guard as routes/props.ts.
adminRouter.get('/props/preview-cells/:file', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const file = req.params['file']!;
  if (path.basename(file) !== file) {
    res.status(400).json({ error: 'Invalid file' });
    return;
  }
  try {
    const sourceBuffer = await readFile(path.join(PROPS_DIR, '_source', file));
    const cells = await previewGridCells(sourceBuffer);
    res.json({ cells: cells.map(c => `data:image/png;base64,${c.toString('base64')}`) });
  } catch (err) {
    logError('routes/admin:previewGridCells', err);
    res.status(500).json({ error: 'Could not preview this atlas' });
  }
});
