import { Router } from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { slugifyTheme, iconSlug } from 'shared';
import type { Dungeon, DungeonMaterialSpec, StoryboardTestRecord, PlotHook } from 'shared';
import { CAMPAIGNS_DIR, PROPS_DIR, TILESETS_DIR, CREATURES_DIR, ICONS_DIR, STORYBOARD_TEST_DIR, getConfig, getWorldMeta, listCampaigns, loadDungeon, writeStoryboardTestFile, getStoryboardTestRecord, readPlotHooks, writePlotHooks, deleteCampaign } from '../storage.ts';
import { getTextStore, getMediaStore } from '../storage/index.ts';
import { saveCampaignAsAdventure, slugifyAdventureName, uniqueAdventureSlug, SAVED_ADVENTURES_DIR } from '../adventures/storage.ts';
import { findCreatureUsage, deleteUnusedResources, type ResourceCleanupRequest } from '../resourceUsage.ts';
import { generateExtendedTileset } from '../dungeon/tilesets.ts';
import { generatePropSpriteBatch, previewGridCells } from '../dungeon/props.ts';
import type { PendingProp } from '../dungeon/props.ts';
import { generateIconsForItems } from '../dungeon/icons.ts';
import type { PendingIcon } from '../dungeon/icons.ts';
import { runStoryboardPipeline, SLIDE_COUNT } from '../dungeon/storyboard.ts';
import { getFeatureProvider } from '../providers/index.ts';
import { buildPlotHookNormalizePrompt } from '../prompts.ts';
import { parseLlmJson } from '../utils/llmJson.ts';
import { parsePageParams } from '../utils/pagination.ts';
import { logError } from '../logger.ts';

export const adminRouter = Router();

// Settings-configured password wins once set; env var / 'admin' is the pre-settings-UI fallback.
export async function getAdminPassword(): Promise<string> {
  const config = await getConfig();
  return config.adminPassword || process.env.ADMIN_PASSWORD || 'admin';
}

export async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  if (req.headers['x-admin-password'] !== await getAdminPassword()) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

adminRouter.post('/auth', async (req, res) => {
  const { password } = req.body as { password?: string };
  res.json({ ok: password === await getAdminPassword() });
});

adminRouter.get('/campaigns', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(await listCampaigns());
});

adminRouter.delete('/campaigns/:id', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const campaignId = req.params['id']!;
  try {
    const { resources } = req.body as { resources?: ResourceCleanupRequest };
    let messages: string[] = [];
    if (resources && (resources.tiles || resources.creatures || resources.props)) {
      const dungeon = await loadDungeon(campaignId);
      if (dungeon) messages = await deleteUnusedResources(dungeon, resources, { excludeId: campaignId, excludeKind: 'campaign' });
    }
    await deleteCampaign(campaignId);
    res.json({ ok: true, messages });
  } catch (err) {
    logError('routes/admin:deleteCampaign', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Global reuse across every dungeon (see dungeon/creaturePortraits.ts) — refuse to delete a
// creature's portrait/stats while any campaign or saved adventure still references it, same
// guard shape deleteUnusedResources uses for the bulk campaign-delete cleanup path.
adminRouter.delete('/creatures/:slug', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const slug = req.params['slug']!;
  try {
    const usage = await findCreatureUsage(slug);
    if (usage.length) {
      res.status(409).json({ ok: false, error: 'Still in use', usage });
      return;
    }
    const dir = path.join(CREATURES_DIR, slug);
    await Promise.all([getTextStore().deletePrefix(dir), getMediaStore().deletePrefix(dir)]);
    res.json({ ok: true });
  } catch (err) {
    logError('routes/admin:deleteCreature', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

adminRouter.delete('/campaigns/:id/chat', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const chatKey = path.join(CAMPAIGNS_DIR, req.params['id']!, 'chat.json');
  try {
    await getTextStore().delete(chatKey);
    res.json({ ok: true });
  } catch (err) {
    logError('routes/admin:deleteChat', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

adminRouter.post('/campaigns/:id/save-adventure', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const campaignSlug = req.params['id']!;
  const { name } = req.body as { name?: string };
  try {
    const meta = await getWorldMeta(campaignSlug);
    const adventureName = name || meta?.name || campaignSlug;
    const adventureSlug = await uniqueAdventureSlug(slugifyAdventureName(adventureName));
    await saveCampaignAsAdventure(campaignSlug, adventureSlug, adventureName);
    res.json({ ok: true, slug: adventureSlug });
  } catch (err) {
    logError('routes/admin:saveAdventure', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

adminRouter.delete('/campaigns/:id/sessions', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const sessionsDir = path.join(CAMPAIGNS_DIR, req.params['id']!, 'sessions');
  try {
    await getTextStore().deletePrefix(sessionsDir);
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
  if (!(await requireAdmin(req, res))) return;
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
  if (!(await requireAdmin(req, res))) return;
  const theme = req.params['theme']!;
  if (slugifyTheme(theme) !== theme) {
    res.status(400).json({ error: 'Invalid theme' });
    return;
  }
  const dir = path.join(TILESETS_DIR, theme);
  try {
    await getMediaStore().deletePrefix(dir);
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
  if (!(await requireAdmin(req, res))) return;
  try {
    const raw = await getTextStore().get(path.join(SAVED_ADVENTURES_DIR, PROP_TEST_ADVENTURE_SLUG, 'dungeon.json'));
    if (raw === null) throw new Error('Prop test adventure dungeon.json not found');
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
  if (!(await requireAdmin(req, res))) return;
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

// SSE, mirrors /props/generate. No slug in the request — the icon's storage folder/URL is always
// iconSlug(name) (see dungeon/icons.ts), so the client can predict where a finished icon will land
// straight from the name, without the server handing back a URL map.
adminRouter.post('/icons/generate', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { items: rawItems } = req.body as { items?: PendingIcon[] };
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .filter((i): i is PendingIcon => !!i?.name?.trim() && !!i?.description?.trim())
    .slice(0, 64);
  if (!items.length) {
    res.status(400).json({ error: 'At least one item (name + description) is required' });
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
    await generateIconsForItems(items, apiKey, config.image.model, message => send({ type: 'progress', message }));
    send({ type: 'complete' });
  } catch (err) {
    logError('routes/admin:generateIconsForItems', err);
    send({ type: 'error', message: err instanceof Error ? err.message : 'Generation failed' });
  } finally {
    res.end();
  }
});

// Discards one generated icon (the "uncheck to discard" step of the Create Icons confirmation
// screen, or the detail sidebar's "Remove Icon"). Mirrors /tilesets/:theme's delete route.
adminRouter.delete('/icons/:slug', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const slug = req.params['slug']!;
  if (iconSlug(slug) !== slug) {
    res.status(400).json({ error: 'Invalid slug' });
    return;
  }
  const dir = path.join(ICONS_DIR, slug);
  try {
    await getMediaStore().deletePrefix(dir);
    res.json({ ok: true });
  } catch (err) {
    logError('routes/admin:deleteIcon', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Runs the real crop/grid-detection pipeline against an already-saved source atlas — no AI call, so
// prompt/crop tweaks can be checked for free against every atlas already paid for. `file` is a
// _source filename only (never a path), same traversal guard as routes/props.ts.
adminRouter.get('/props/preview-cells/:file', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const file = req.params['file']!;
  if (path.basename(file) !== file) {
    res.status(400).json({ error: 'Invalid file' });
    return;
  }
  try {
    const sourceBuffer = await getMediaStore().get(path.join(PROPS_DIR, '_source', file));
    if (!sourceBuffer) throw new Error('Source atlas not found');
    const cells = await previewGridCells(sourceBuffer);
    res.json({ cells: cells.map(c => `data:image/png;base64,${c.toString('base64')}`) });
  } catch (err) {
    logError('routes/admin:previewGridCells', err);
    res.status(500).json({ error: 'Could not preview this atlas' });
  }
});

// ── Storyboard test sandbox ─────────────────────────────────────────────────
// A single scratch record (not a real character) so the storyboard pipeline can be tested/tuned
// without spending a real character slot and without needing the settings toggle enabled.

adminRouter.get('/storyboard-test', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json({ record: await getStoryboardTestRecord() });
});

// SSE, mirrors /tilesets/generate. Bypasses config.image.generateStoryboard — same as every other
// admin generate route ignoring its equivalent settings toggle, this is an explicit on-demand test.
adminRouter.post('/storyboard-test/generate', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { name, backstory, portraitBase64 } = req.body as { name?: string; backstory?: string; portraitBase64?: string };
  if (!name?.trim() || !backstory?.trim()) {
    res.status(400).json({ error: 'name and backstory are required' });
    return;
  }

  const config = await getConfig();
  if (!config.apiKeys.openai) {
    res.status(400).json({ error: 'No OpenAI API key configured' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  function send(data: object) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  try {
    // A regenerate that only tweaks name/backstory can omit the image and reuse the last upload —
    // the whole point of persisting this sandbox is not having to redo every input each time.
    const portraitBuffer = portraitBase64?.trim()
      ? await sharp(Buffer.from(portraitBase64, 'base64')).jpeg().toBuffer()
      : await getMediaStore().get(path.join(STORYBOARD_TEST_DIR, 'portrait.jpg'));
    if (!portraitBuffer) {
      send({ type: 'error', message: 'A portrait image is required' });
      return;
    }
    const { slides: results, rawAtlas } = await runStoryboardPipeline({ name, backstory }, portraitBuffer, config, message => send({ type: 'progress', message }));

    send({ type: 'progress', message: 'Saving portrait, source atlas, and slides…' });
    await writeStoryboardTestFile('portrait.jpg', portraitBuffer);
    await writeStoryboardTestFile('source.jpg', await sharp(rawAtlas).jpeg().toBuffer());
    // This sandbox reuses the same fixed filenames on every regenerate (see comment above), so the
    // URLs below must change even when the path doesn't — otherwise a regenerate for a totally
    // different character never re-fetches at all: React sees an unchanged `src` string and never
    // re-issues the request, so the old cached bytes just keep showing. Confirmed live. `generatedAt`
    // as a cache-busting query param forces both React and the browser to treat it as a new image.
    const v = Date.now();
    const slides = await Promise.all(results.map(async ({ buffer, caption }, i) => {
      const n = i + 1;
      await writeStoryboardTestFile(`slide_${n}.jpg`, buffer);
      return { url: `/api/admin/storyboard-test/slide/${n}?v=${v}`, caption };
    }));

    const record: StoryboardTestRecord = {
      name, backstory, portraitUrl: `/api/admin/storyboard-test/portrait?v=${v}`, slides,
      generatedAt: new Date().toISOString(),
      sourceUrl: `/api/admin/storyboard-test/source?v=${v}`,
    };
    await getTextStore().put(path.join(STORYBOARD_TEST_DIR, 'record.json'), JSON.stringify(record, null, 2));
    send({ type: 'complete', record });
  } catch (err) {
    logError('routes/admin:storyboardTestGenerate', err);
    send({ type: 'error', message: err instanceof Error ? err.message : 'Generation failed' });
  } finally {
    res.end();
  }
});

// Unguarded, same as routes/props.ts's sprite serving — imagery is fetched by plain <img src>,
// which can't attach the admin password header.
adminRouter.get('/storyboard-test/portrait', async (_req, res) => {
  const data = await getMediaStore().get(path.join(STORYBOARD_TEST_DIR, 'portrait.jpg'));
  if (!data) { res.status(404).json({ error: 'Portrait not found' }); return; }
  res.type('.jpg').send(data);
});

adminRouter.get('/storyboard-test/source', async (_req, res) => {
  const data = await getMediaStore().get(path.join(STORYBOARD_TEST_DIR, 'source.jpg'));
  if (!data) { res.status(404).json({ error: 'Source atlas not found' }); return; }
  res.type('.jpg').send(data);
});

adminRouter.get('/storyboard-test/slide/:n', async (req, res) => {
  const n = req.params['n']!;
  if (!new RegExp(`^[1-${SLIDE_COUNT}]$`).test(n)) { res.status(400).json({ error: 'Invalid slide number' }); return; }
  const data = await getMediaStore().get(path.join(STORYBOARD_TEST_DIR, `slide_${n}.jpg`));
  if (!data) { res.status(404).json({ error: 'Slide not found' }); return; }
  res.type('.jpg').send(data);
});

adminRouter.delete('/storyboard-test', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await Promise.all([getTextStore().deletePrefix(STORYBOARD_TEST_DIR), getMediaStore().deletePrefix(STORYBOARD_TEST_DIR)]);
    res.json({ ok: true });
  } catch (err) {
    logError('routes/admin:deleteStoryboardTest', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Plot hook pool ────────────────────────────────────────────────────────────
// Global, not per-campaign — admin-authored arcs, normalized into a reusable skeleton at write
// time (see buildPlotHookNormalizePrompt) so selection/reflavor later can read a uniform shape.

type NormalizedPlotHook = Pick<PlotHook, 'title' | 'tags' | 'structuralRequirements' | 'beats'>;

async function normalizePlotHook(rawText: string): Promise<NormalizedPlotHook> {
  const config = await getConfig();
  const raw = await getFeatureProvider(config, 'plotHookNormalize').complete(buildPlotHookNormalizePrompt(rawText));
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return parseLlmJson<NormalizedPlotHook>(cleaned);
}

adminRouter.get('/plot-hooks', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { page, pageSize } = parsePageParams(req, 10);
  // Newest first, so a freshly created hook always lands on page 1 instead of wherever the
  // append-order tail happens to fall.
  const hooks = (await readPlotHooks()).slice().reverse();
  const start = (page - 1) * pageSize;
  res.json({ items: hooks.slice(start, start + pageSize), total: hooks.length });
});

adminRouter.post('/plot-hooks', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { rawText } = req.body as { rawText?: string };
  if (!rawText?.trim()) { res.status(400).json({ error: 'rawText is required' }); return; }
  try {
    const normalized = await normalizePlotHook(rawText);
    const hook: PlotHook = {
      id: randomUUID(),
      rawText,
      ...normalized,
      createdAt: new Date().toISOString(),
      usedIn: [],
    };
    const hooks = await readPlotHooks();
    await writePlotHooks([...hooks, hook]);
    res.json(hook);
  } catch (err) {
    logError('routes/admin:createPlotHook', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Normalization failed' });
  }
});

// Re-normalizes against a (possibly edited) rawText — id/createdAt/usedIn survive untouched.
adminRouter.put('/plot-hooks/:id', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { rawText } = req.body as { rawText?: string };
  if (!rawText?.trim()) { res.status(400).json({ error: 'rawText is required' }); return; }
  try {
    const hooks = await readPlotHooks();
    const existing = hooks.find(h => h.id === req.params['id']);
    if (!existing) { res.status(404).json({ error: 'Plot hook not found' }); return; }
    const normalized = await normalizePlotHook(rawText);
    const updated: PlotHook = { ...existing, rawText, ...normalized };
    await writePlotHooks(hooks.map(h => h.id === updated.id ? updated : h));
    res.json(updated);
  } catch (err) {
    logError('routes/admin:updatePlotHook', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Normalization failed' });
  }
});

adminRouter.delete('/plot-hooks/:id', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const hooks = await readPlotHooks();
  await writePlotHooks(hooks.filter(h => h.id !== req.params['id']));
  res.json({ ok: true });
});
