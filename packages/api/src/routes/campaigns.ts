import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { WorldConcept, Character, Quest, HouseRules } from 'shared';
import { spellSlotsForCharacter, DEFAULT_HOUSE_RULES } from 'shared';
import {
  CAMPAIGNS_DIR,
  getConfig, writeCampaignFile, listCampaigns,
  getWorldMeta, writeWorldMeta,
  writeCharacter, updateCharacter, getCharacter, listCharacters, findCharacterByPassword, writeCharacterImage, getCharacterStoryboard,
  getScenarioStoryboard,
  readCampaignFile, writeEntity,
  listEntitySlugs, readEntity, saveDungeon, saveDungeonAscii, writeManifest, readManifest, emptyManifest, readQuests, writeQuests,
  loadDungeons, deleteCampaign,
} from '../storage.ts';
import { getTextStore, getMediaStore } from '../storage/index.ts';
import { deleteUnusedResources, type ResourceCleanupRequest } from '../resourceUsage.ts';
import { generateDungeon } from '../dungeon/index.ts';
import { classifyCampaignGenre } from '../dungeon/genreTiles.ts';
import { generateCharacterStoryboard, generateScenarioStoryboard, SLIDE_COUNT, SCENARIO_SLIDE_COUNT } from '../dungeon/storyboard.ts';
import { calcMaxHp } from '../combat/dice.ts';
import { getFeatureProvider } from '../providers/index.ts';
import { copyCompendiumToCampaign, loadCompendiumMeta } from '../compendium/storage.ts';
import { copyAdventureToCampaign, saveCampaignAsAdventure, slugifyAdventureName, uniqueAdventureSlug } from '../adventures/storage.ts';
import { buildConceptsPrompt, buildWorldGenPrompt, buildDungeonCrawlPremisePrompt, buildDungeonScenarioSynopsisPrompt, buildDungeonScenarioGoalPrompt, buildBackstoryCheckPrompt, buildBackstoryGeneratePrompt, buildBackstoryRewritePrompt, buildBackstoryExtractPrompt, BACKSTORY_HOOKS } from '../prompts.ts';
import { processSession, generateDmBrief } from '../session-processor/index.ts';
import { processPortrait } from '../utils/image.ts';
import { buildWorldMapPrompt } from '../session-processor/imagePrompts.ts';
import { generateBattleMap } from '../providers/openai.ts';
import path from 'path';
import { parseLlmJson } from '../utils/llmJson.ts';
import { logError } from '../logger.ts';
import { licenseOrJwtMiddleware } from '../presentation/middleware/AuthMiddleware/AuthMiddleware.ts';
import { clearCampaignRuntimeState } from '../state.ts';

export const campaignsRouter = Router();

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Regenerating with the same name/tags previously overwrote the prior campaign in place — bump a
// numeric suffix until the directory is free instead of silently clobbering it.
async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (await getTextStore().exists(path.join(CAMPAIGNS_DIR, slug, 'world.json'))) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

// ── session processing ────────────────────────────────────────────────────────

campaignsRouter.post('/:slug/session/process', async (req, res) => {
  try {
    const result = await processSession(req.params.slug ?? '');
    res.json(result);
  } catch (err) {
    logError('routes/campaigns:session/process', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Processing failed' });
  }
});

// ── list ──────────────────────────────────────────────────────────────────────

campaignsRouter.get('/', async (_req, res) => {
  res.json(await listCampaigns());
});

campaignsRouter.get('/:id/world-map', async (req, res) => {
  const data = await getMediaStore().get(path.join(CAMPAIGNS_DIR, req.params.id ?? '', 'world-map.jpg'));
  if (!data) { res.status(404).json({ error: 'No world map' }); return; }
  res.type('.jpg').send(data);
});

// Same delete as the admin panel's, but reachable from the game lobby, which has no admin
// password — the lobby's own game-password gate is this route's only protection.
campaignsRouter.delete('/:id', async (req, res) => {
  const campaignId = req.params.id ?? '';
  try {
    const { resources } = req.body as { resources?: ResourceCleanupRequest };
    let messages: string[] = [];
    if (resources && (resources.tiles || resources.creatures || resources.props)) {
      // Every dungeon the campaign kept, not just the first — they accumulate now that leaving one
      // preserves it for re-entry, and cleaning only ds[0] would orphan the rest of the art.
      for (const dungeon of await loadDungeons(campaignId)) {
        messages = messages.concat(await deleteUnusedResources(dungeon, resources, { excludeId: campaignId, excludeKind: 'campaign' }));
      }
    }
    await deleteCampaign(campaignId);
    clearCampaignRuntimeState(campaignId);
    res.json({ ok: true, messages });
  } catch (err) {
    logError('routes/campaigns:deleteCampaign', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── campaign meta ─────────────────────────────────────────────────────────────

campaignsRouter.get('/:id', async (req, res) => {
  const slug = req.params.id ?? '';
  const meta = await getWorldMeta(slug);
  if (!meta) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const { gamePassword: _pw, ...safeMeta } = meta;
  // merge tags from meta.json if present
  try {
    const raw = await getTextStore().get(path.join(CAMPAIGNS_DIR, slug, 'meta.json'));
    const campaign = raw === null ? {} : (JSON.parse(raw) as { tags?: string[] });
    res.json({ ...safeMeta, tags: campaign.tags ?? [], houseRules: meta.houseRules ?? DEFAULT_HOUSE_RULES });
  } catch (err) {
    logError('routes/campaigns:getById', err);
    res.json({ ...safeMeta, houseRules: meta.houseRules ?? DEFAULT_HOUSE_RULES });
  }
});

// ── game password auth ────────────────────────────────────────────────────────
// Empty/unset gamePassword means the game has no password — anyone gets in.

campaignsRouter.post('/:id/auth', async (req, res) => {
  const { password } = req.body as { password: string };
  const meta = await getWorldMeta(req.params.id ?? '');
  if (!meta) { res.status(404).json({ error: 'Campaign not found' }); return; }
  if (meta.gamePassword && meta.gamePassword !== password) { res.status(401).json({ error: 'Invalid password' }); return; }
  res.json({ ok: true });
});

campaignsRouter.get('/:id/game-password', async (req, res) => {
  const meta = await getWorldMeta(req.params.id ?? '');
  if (!meta) { res.status(404).json({ error: 'Campaign not found' }); return; }
  res.json({ gamePassword: meta.gamePassword ?? '' });
});

campaignsRouter.put('/:id/game-password', async (req, res) => {
  const slug = req.params.id ?? '';
  const meta = await getWorldMeta(slug);
  if (!meta) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const { gamePassword } = req.body as { gamePassword?: string };
  const { gamePassword: _old, ...rest } = meta;
  await writeWorldMeta(slug, gamePassword ? { ...rest, gamePassword } : rest);
  res.json({ gamePassword: gamePassword ?? '' });
});

campaignsRouter.post('/:id/save-adventure', async (req, res) => {
  const campaignSlug = req.params.id ?? '';
  const { name } = req.body as { name?: string };
  try {
    const meta = await getWorldMeta(campaignSlug);
    if (!meta) { res.status(404).json({ error: 'Campaign not found' }); return; }
    const adventureName = name || meta.name || campaignSlug;
    const adventureSlug = await uniqueAdventureSlug(slugifyAdventureName(adventureName));
    await saveCampaignAsAdventure(campaignSlug, adventureSlug, adventureName);
    res.json({ ok: true, slug: adventureSlug });
  } catch (err) {
    logError('routes/campaigns:saveAdventure', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── house rules ───────────────────────────────────────────────────────────────

campaignsRouter.put('/:id/house-rules', async (req, res) => {
  const slug = req.params.id ?? '';
  const meta = await getWorldMeta(slug);
  if (!meta) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const houseRules = req.body as HouseRules;
  await writeWorldMeta(slug, { ...meta, houseRules });
  res.json(houseRules);
});

// ── concept generation ────────────────────────────────────────────────────────

campaignsRouter.post('/concepts', licenseOrJwtMiddleware, async (req, res) => {
  const { tags, type = 'campaign' } = req.body as { tags: string[]; type?: 'campaign' | 'one-shot' };
  if (!tags?.length) { res.status(400).json({ error: 'tags required' }); return; }
  const config = await getConfig();
  try {
    const raw = await getFeatureProvider(config, 'campaignConcepts').complete(buildConceptsPrompt(tags, type));
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    res.json(parseLlmJson<WorldConcept[]>(cleaned));
  } catch (err) {
    logError('routes/campaigns:concepts', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Concept generation failed' });
  }
});

// ── world generation (SSE) ────────────────────────────────────────────────────

campaignsRouter.post('/generate', licenseOrJwtMiddleware, async (req, res) => {
  const { tags, concept, name, type = 'campaign', partySize = 4 } = req.body as { tags: string[]; concept: WorldConcept; name: string; type?: 'campaign' | 'one-shot' | 'dungeon-crawl'; partySize?: number };
  if (!concept || !tags?.length) { res.status(400).json({ error: 'tags and concept required' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const config = await getConfig();
    // Runs alongside the premise/world generation below; never throws.
    const genrePromise = classifyCampaignGenre(tags, config);

    // Dungeon crawl: no world, no factions, no NPC roster — just a short premise and the dungeon
    // itself, generated straight from the tags rather than funnelled through a world concept.
    if (type === 'dungeon-crawl') {
      // The client's rename step already gave the user final say over the title, so it's settled
      // before any generation runs and is handed to the premise prompt rather than invented there.
      // concept.name only covers a caller that omits `name` — the UI never does (it blocks Next on
      // an empty name), so this is a defensive fallback, not a path the app takes.
      const title = name || concept.name;

      send({ type: 'progress', message: 'Writing premise…' });
      const raw = await getFeatureProvider(config, 'dungeonPremise').stream(
        buildDungeonCrawlPremisePrompt(tags, title),
        token => send({ type: 'token', text: token }),
      );
      let premise = concept.description;
      try {
        const parsed = parseLlmJson<{ premise?: string }>(raw);
        if (parsed.premise) premise = parsed.premise;
      } catch (err) { logError('routes/campaigns:generate:dungeonCrawlPremise', err); }

      const slug = await uniqueSlug(slugify(title));
      await writeCampaignFile(slug, 'world.md', `# ${title}\n\n${premise.trim()}`);

      // Separate from the short premise above (that one stays a campaign-record blurb, untouched)
      // — this is the richer, dramatic scenario synopsis: read in full by the player in the game
      // lobby, AND handed to the manifest below as story context so the dungeon it invents actually
      // serves this specific scenario rather than just the bare genre tags.
      send({ type: 'progress', message: 'Writing scenario synopsis…' });
      let synopsis = premise;
      try {
        // Streamed like the premise above, and awaited the same way — everything after this block
        // (storyboard kickoff, goal derivation, dungeon generation) only starts once this resolves.
        const synopsisRaw = await getFeatureProvider(config, 'dungeonScenarioSynopsis').stream(
          buildDungeonScenarioSynopsisPrompt(tags, title, premise),
          token => send({ type: 'token', text: token }),
        );
        const parsed = parseLlmJson<{ synopsis?: string }>(synopsisRaw);
        if (parsed.synopsis) synopsis = parsed.synopsis;
      } catch (err) { logError('routes/campaigns:generate:dungeonScenarioSynopsis', err); }

      const campaignName = title;
      const genre = await genrePromise;
      await writeWorldMeta(slug, {
        id: randomUUID(),
        name: campaignName,
        campaignDir: slug,
        type,
        concept: { name: concept.name, description: concept.description },
        scenarioSynopsis: synopsis,
        partySize,
        genre,
      });

      // Started here, awaited only right before `complete` below — runs the whole time the goal
      // and dungeon are being generated instead of after, and never throws out (see
      // generateScenarioStoryboard's own try/catch), so it's safe to await plainly.
      const storyboardDone = generateScenarioStoryboard(slug, title, synopsis, config);

      // One strong opening stage derived from the synopsis, not the manifest's own free-form
      // invention — same predefinedChain mechanism effects.ts's mid-campaign dungeon_gen handler
      // already uses. The manifest call below decides this stage's trigger (nothing exists yet
      // for it to reference) plus the entire rest of the chain.
      send({ type: 'progress', message: 'Determining the dungeon\'s goal…' });
      let predefinedChain: { id: string; name: string; description: string }[] = [];
      try {
        const goalRaw = await getFeatureProvider(config, 'questGeneration').complete(
          buildDungeonScenarioGoalPrompt(synopsis, 'dungeon-crawl', []),
        );
        const goal = parseLlmJson<{ id?: string; name?: string; description?: string }>(goalRaw);
        if (goal.name && goal.description) predefinedChain = [{ id: goal.id || slugify(goal.name), name: goal.name, description: goal.description }];
      } catch (err) { logError('routes/campaigns:generate:dungeonScenarioGoal', err); }

      send({ type: 'progress', message: 'Generating dungeon…' });
      const dungeonId = randomUUID();
      const dungeon = await generateDungeon(
        title, 'dungeon-crawl', getFeatureProvider(config, 'dungeonGeneration'), synopsis,
        { width: 100, height: 100, roomRange: [14, 20], partySize, id: dungeonId, predefinedChain, genre },
        token => send({ type: 'token', text: token }),
        config,
      );
      await saveDungeon(slug, dungeon);
      await saveDungeonAscii(slug, dungeon);

      const today = new Date().toISOString().slice(0, 10);
      // dungeon.questChain[0] is authoritative either way — the predefinedChain stage above
      // (id/name/description preserved verbatim, see fetchManifest) or, if that goal call failed
      // outright, whatever the manifest invented on its own. Only stage 0 becomes a visible quest
      // now; later stages activate one at a time as each one's trigger resolves (dungeon/questChain.ts).
      const stage0 = dungeon.questChain?.[0];
      const goalQuests: Quest[] = stage0
        ? [{ id: stage0.id, name: stage0.name, description: stage0.description, status: 'open' as const, log: [], addedAt: today, sourceDungeonId: dungeonId }]
        : [];
      await writeQuests(slug, [...(await readQuests(slug)), ...goalQuests]);

      send({ type: 'progress', message: 'Finishing scenario storyboard…' });
      await storyboardDone;

      send({ type: 'complete', id: slug, name: campaignName });
      return;
    }

    const slug = await uniqueSlug(slugify(name || concept.name));

    let accumulated = '';
    send({ type: 'progress', message: 'Generating world…' });
    await getFeatureProvider(config, 'worldGeneration').stream(
      buildWorldGenPrompt(tags, concept.name, concept.description, type),
      token => { accumulated += token; send({ type: 'token', text: token }); },
    );

    const start = accumulated.indexOf('{');
    const end   = accumulated.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('Model did not return a JSON object');
    const jsonStr = accumulated.slice(start, end + 1);
    const world = parseLlmJson<Record<string, unknown> & { world?: { name?: string } }>(jsonStr);

    await writeVault(slug, world, tags, concept, msg => send({ type: 'progress', message: msg }));

    // write world.json with stable id + display name
    // The client's rename step gives the user final say over the title — an explicitly-provided
    // name wins over whatever the world-generation step invented on its own.
    const campaignName = name || world.world?.name || concept.name;
    const genre = await genrePromise;
    await writeWorldMeta(slug, {
      id: randomUUID(),
      name: campaignName,
      campaignDir: slug,
      type,
      concept: { name: concept.name, description: concept.description },
      genre,
    });

    if (type === 'campaign' && config.image.generateWorldMap) {
      const apiKey = config.apiKeys.openai;
      if (apiKey) {
        send({ type: 'progress', message: 'Generating world map...' });
        try {
          const worldMd = await readCampaignFile(slug, 'world.md') ?? '';
          const locationSlugs = await listEntitySlugs(slug, 'location');
          const locationContents = await Promise.all(locationSlugs.map(s => readEntity(slug, 'location', s)));
          const locations = locationContents.filter(Boolean).map(c => {
            // Written by writeVault as "# Name\n\n<description>\n\n## Scene Notes\n..." — split
            // off the heading for the map's name field and everything up to Scene Notes as description.
            const text = c!.trim();
            const cutoff = text.indexOf('\n## ');
            const body = (cutoff === -1 ? text : text.slice(0, cutoff)).trim();
            const nameMatch = body.match(/^#\s*(.+)/);
            return {
              name: nameMatch?.[1]?.trim() || 'Unnamed Location',
              description: body.replace(/^#.*\n?/, '').trim(),
            };
          });
          const prompt = buildWorldMapPrompt(worldMd, locations, tags);
          const buffer = await generateBattleMap(prompt, apiKey, config.image.model);
          await getMediaStore().put(path.join(CAMPAIGNS_DIR, slug, 'world-map.jpg'), buffer);
          console.log('[world-map] generated for:', slug);
        } catch (err) {
          logError('routes/campaigns:generate:worldMap', err);
        }
      }
    }

    send({ type: 'complete', id: slug, name: campaignName });
  } catch (err) {
    logError('routes/campaigns:generate', err);
    send({ type: 'error', message: err instanceof Error ? err.message : 'Generation failed' });
  } finally {
    res.end();
  }
});

// ── create from module ────────────────────────────────────────────────────────

campaignsRouter.post('/from-module', licenseOrJwtMiddleware, async (req, res) => {
  const { adventureSlug, campaignName } = req.body as { adventureSlug?: string; campaignName?: string };
  if (!adventureSlug || !campaignName) {
    res.status(400).json({ error: 'adventureSlug and campaignName are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function send(data: object) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  const slug = await uniqueSlug(slugify(campaignName));
  try {
    send({ type: 'progress', message: 'Copying module entities…' });
    await copyCompendiumToCampaign(adventureSlug, slug, campaignName);

    send({ type: 'progress', message: 'Generating DM brief…' });
    const locationSlugs = await listEntitySlugs(slug, 'location');
    const npcSlugs = await listEntitySlugs(slug, 'npc');
    const factionSlugs = await listEntitySlugs(slug, 'faction');

    // Classified here rather than inside copyCompendiumToCampaign — that's a storage function and
    // has no business making an LLM call. Without a genre, worldMeta.genre stays undefined and
    // every dungeon and arena this campaign ever generates skips the tile map entirely: nothing is
    // reused, AND nothing is recorded back for the next one (see ensureTilesetSupport's `if (genre)`),
    // so a module campaign pays full price for art forever and contributes none of it.
    // The module's own title carries most of the signal — named IPs are exactly what the
    // classification prompt is told to place — with the location names covering homebrew modules
    // whose title says nothing about how the place physically looks.
    // Started before the brief and awaited after, so the two model calls overlap; never throws.
    const compendiumMeta = await loadCompendiumMeta(adventureSlug);
    const genrePromise = classifyCampaignGenre([
      compendiumMeta?.name || campaignName,
      ...(compendiumMeta?.source ? [compendiumMeta.source] : []),
      ...locationSlugs.slice(0, 12).map(s => s.replace(/-/g, ' ')),
    ], await getConfig());

    const brief = await generateDmBrief(campaignName, locationSlugs, npcSlugs, factionSlugs);

    send({ type: 'progress', message: 'Writing campaign files…' });
    const today = new Date().toISOString().slice(0, 10);
    const initialQuests = (brief.initialQuests ?? []).map(q => ({
      id: q.id, name: q.name, description: q.description,
      status: 'undiscovered' as const, log: [], addedAt: today,
    }));

    const manifest = (await readManifest(slug)) ?? emptyManifest();
    if (brief.startingLocationSlug) {
      manifest.currentLocation = brief.startingLocationSlug;
      manifest.updatedAt = new Date().toISOString();
    }

    // copyCompendiumToCampaign already wrote world.json — this stamps the classified genre onto it
    // rather than rebuilding the shape here, so the two writers can't drift.
    const worldMeta = await getWorldMeta(slug);
    const genre = await genrePromise;

    await Promise.all([
      writeCampaignFile(slug, 'dm-brief.md', brief.dmBrief),
      writeManifest(slug, manifest),
      writeQuests(slug, initialQuests),
      writeCampaignFile(slug, 'acts.json', JSON.stringify(brief.acts ?? [], null, 2)),
      ...(worldMeta ? [writeWorldMeta(slug, { ...worldMeta, genre })] : []),
    ]);

    send({ type: 'complete', id: slug, name: campaignName });
  } catch (err) {
    logError('routes/campaigns:from-module', err);
    send({ type: 'error', message: err instanceof Error ? err.message : 'Failed to create campaign' });
  } finally {
    res.end();
  }
});

// ── create from saved adventure ───────────────────────────────────────────────
// No LLM calls: the template already carries a starting location, undiscovered quests, and a
// reset dungeon — spinning up a copy is a plain filesystem clone, so no SSE progress is needed.

campaignsRouter.post('/from-adventure', licenseOrJwtMiddleware, async (req, res) => {
  const { adventureSlug, campaignName } = req.body as { adventureSlug?: string; campaignName?: string };
  if (!adventureSlug || !campaignName) {
    res.status(400).json({ error: 'adventureSlug and campaignName are required' });
    return;
  }

  const slug = await uniqueSlug(slugify(campaignName));
  try {
    await copyAdventureToCampaign(adventureSlug, slug, campaignName);
    res.json({ id: slug, name: campaignName });
  } catch (err) {
    logError('routes/campaigns:from-adventure', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create campaign' });
  }
});

// ── character endpoints ───────────────────────────────────────────────────────

campaignsRouter.get('/:id/party', async (req, res) => {
  const chars = await listCharacters(req.params.id ?? '');
  res.json(chars.map(({ password: _pw, ...c }) => c));
});

campaignsRouter.post('/:id/party', async (req, res) => {
  const slug = req.params.id ?? '';
  const data = req.body as Omit<Character, 'createdAt'> & { id?: string };
  const existing = await listCharacters(slug);
  if (existing.some(c => c.name.toLowerCase() === data.name?.toLowerCase())) {
    res.status(409).json({ error: 'A character with that name already exists in this campaign' });
    return;
  }
  const charId = data.id ?? randomUUID();
  const character: Character = { ...data, id: charId, campaignId: slug, createdAt: new Date().toISOString() };
  // 2024 PHB Artificer (Tinker's Magic): always knows Mending, free of the normal cantrip
  // choices — granted here rather than as a pickable option, since it's automatic per RAW.
  if (character.class === 'Artificer' && !(character.spells ?? []).includes('Mending')) {
    character.spells = [...(character.spells ?? []), 'Mending'];
    character.spellSources = { ...(character.spellSources ?? {}), Mending: "Tinker's Magic" };
  }
  await writeCharacter(slug, charId, character);
  res.json({ id: charId });
  void syncCharacterToWorldLore(slug, character);
  void generateCharacterStoryboard(slug, character);
});

// Fire-and-forget: deconstructs a finalised character's backstory into world content — NPCs,
// locations, quest hooks — the same way module import seeds a campaign, so the character feels
// woven into the world rather than bolted on. Runs after the response is already sent; a slow or
// failed LLM call must never block character creation.
async function syncCharacterToWorldLore(slug: string, character: Character): Promise<void> {
  try {
    const meta = await getWorldMeta(slug);
    if (meta?.type !== 'campaign') return;
    const config = await getConfig();
    const worldMd = await readCampaignFile(slug, 'world.md') ?? '';
    const raw = await getFeatureProvider(config, 'worldLoreSync').complete(buildBackstoryExtractPrompt(worldMd, character));
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const extracted = parseLlmJson<{
      worldEntry: string;
      npcs: Array<{ name: string; role?: string; race?: string; occupation?: string; personality?: string; motivation?: string; secret?: string; factionAffiliation?: string | null }>;
      locations: Array<{ name: string; description?: string }>;
      quests: Array<{ id: string; name: string; description: string }>;
    }>(cleaned);

    const toEntitySlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    if (extracted.worldEntry) {
      const heading = '## Party Arrivals';
      const bullet = `- ${extracted.worldEntry.trim().replace(/\n+/g, ' ')}`;
      const updated = worldMd.includes(heading)
        ? `${worldMd.trimEnd()}\n${bullet}\n`
        : `${worldMd.trimEnd()}\n\n${heading}\n${bullet}\n`;
      await writeCampaignFile(slug, 'world.md', updated);
    }

    const [existingNpcSlugs, existingLocationSlugs, existingQuests] = await Promise.all([
      listEntitySlugs(slug, 'npc'),
      listEntitySlugs(slug, 'location'),
      readQuests(slug),
    ]);

    // Skip anything that collides with an existing slug — a same-named NPC/location is almost
    // certainly the established one, and this pass must never clobber hand-authored lore.
    const npcWrites = (extracted.npcs ?? [])
      .filter(n => n.name && !existingNpcSlugs.includes(toEntitySlug(n.name)))
      .map(n => {
        const content = `# ${n.name}\n\n**Role:** ${n.role ?? ''} | **Race:** ${n.race ?? ''} | **Occupation:** ${n.occupation ?? ''}\n\n**Personality:** ${n.personality ?? ''}\n**Motivation:** ${n.motivation ?? ''}\n**Secret:** ${n.secret ?? ''}\n**Faction:** ${n.factionAffiliation ?? 'Independent'}\n\n## Observed\n- Connected to ${character.name} (${character.class})\n`;
        return writeEntity(slug, 'npc', toEntitySlug(n.name), content);
      });

    const locationWrites = (extracted.locations ?? [])
      .filter(l => l.name && !existingLocationSlugs.includes(toEntitySlug(l.name)))
      .map(l => {
        const content = `# ${l.name}\n\n${l.description ?? ''}\n\n## Scene Notes\n`;
        return writeEntity(slug, 'location', toEntitySlug(l.name), content);
      });

    const existingQuestIds = new Set(existingQuests.map(q => q.id));
    const today = new Date().toISOString().slice(0, 10);
    const newQuests: Quest[] = (extracted.quests ?? [])
      .filter(q => q.id && !existingQuestIds.has(q.id))
      .map(q => ({ id: q.id, name: q.name, description: q.description, status: 'undiscovered', log: [], addedAt: today }));

    await Promise.all([
      ...npcWrites,
      ...locationWrites,
      ...(newQuests.length ? [writeQuests(slug, [...existingQuests, ...newQuests])] : []),
    ]);

    console.log(`[lore-sync] ${character.name}: +${npcWrites.length} npcs, +${locationWrites.length} locations, +${newQuests.length} quests`);
  } catch (err) {
    logError('routes/campaigns:syncCharacterToWorldLore', err);
  }
}

campaignsRouter.post('/:id/party/backstory-check', async (req, res) => {
  const slug = req.params.id ?? '';
  const { name, species, background, characterClass, backstory } = req.body as
    { name: string; species: string; background: string; characterClass: string; backstory: string };
  const meta = await getWorldMeta(slug);
  if (meta?.type !== 'campaign') { res.status(403).json({ error: 'Backstory tools are only available for campaign-type worlds' }); return; }
  const config = await getConfig();
  try {
    const worldMd = await readCampaignFile(slug, 'world.md') ?? '';
    const raw = await getFeatureProvider(config, 'backstoryCheck').complete(
      buildBackstoryCheckPrompt(worldMd, { name, species, background, characterClass, backstory }),
    );
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    res.json(parseLlmJson<{ score: number; verdict: string; issues: string[]; suggestions: string[] }>(cleaned));
  } catch (err) {
    logError('routes/campaigns:backstory-check', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Backstory check failed' });
  }
});

campaignsRouter.post('/:id/party/backstory-generate', async (req, res) => {
  const slug = req.params.id ?? '';
  const { name, species, background, characterClass } = req.body as
    { name: string; species: string; background: string; characterClass: string };
  const meta = await getWorldMeta(slug);
  if (meta?.type !== 'campaign') { res.status(403).json({ error: 'Backstory tools are only available for campaign-type worlds' }); return; }
  const config = await getConfig();
  try {
    const worldMd = await readCampaignFile(slug, 'world.md') ?? '';
    // Picked server-side — left to the LLM it reaches for tragedy nearly every time.
    const hook = BACKSTORY_HOOKS[Math.floor(Math.random() * BACKSTORY_HOOKS.length)]!;
    const backstory = await getFeatureProvider(config, 'backstoryGeneration').complete(
      buildBackstoryGeneratePrompt(worldMd, { name, species, background, characterClass }, hook),
    );
    res.json({ backstory: backstory.trim() });
  } catch (err) {
    logError('routes/campaigns:backstory-generate', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Backstory generation failed' });
  }
});

campaignsRouter.post('/:id/party/backstory-rewrite', async (req, res) => {
  const slug = req.params.id ?? '';
  const { name, species, background, characterClass, backstory, suggestions } = req.body as
    { name: string; species: string; background: string; characterClass: string; backstory: string; suggestions: string[] };
  if (!backstory?.trim() || !Array.isArray(suggestions) || suggestions.length === 0) {
    res.status(400).json({ error: 'A backstory and at least one suggestion are required' });
    return;
  }
  const meta = await getWorldMeta(slug);
  if (meta?.type !== 'campaign') { res.status(403).json({ error: 'Backstory tools are only available for campaign-type worlds' }); return; }
  const config = await getConfig();
  try {
    const worldMd = await readCampaignFile(slug, 'world.md') ?? '';
    const rewritten = await getFeatureProvider(config, 'backstoryGeneration').complete(
      buildBackstoryRewritePrompt(worldMd, { name, species, background, characterClass, backstory }, suggestions),
    );
    res.json({ backstory: rewritten.trim() });
  } catch (err) {
    logError('routes/campaigns:backstory-rewrite', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Backstory rewrite failed' });
  }
});

campaignsRouter.get('/:id/party/:charId', async (req, res) => {
  const char = await getCharacter(req.params.id ?? '', req.params.charId ?? '');
  if (!char) { res.status(404).json({ error: 'Character not found' }); return; }
  const maxHp = calcMaxHp(char);
  const maxSpellSlots1 = spellSlotsForCharacter(char);
  res.json({
    ...char,
    maxHp, currentHp: char.currentHp ?? maxHp,
    maxSpellSlots1, currentSpellSlots1: char.currentSpellSlots1 ?? maxSpellSlots1,
  });
});

campaignsRouter.patch('/:id/party/:charId', async (req, res) => {
  const { id, charId } = req.params as { id: string; charId: string };
  const allowed = ['xp', 'level', 'proficiencyBonus', 'maxHp', 'currentHp', 'classes', 'maxSpellSlots1', 'currentSpellSlots1'] as const;
  const patch = Object.fromEntries(allowed.filter(k => k in req.body).map(k => [k, (req.body as Record<string, unknown>)[k]]));
  const updated = await updateCharacter(id, charId, char => ({ ...char, ...patch }));
  if (!updated) { res.status(404).json({ error: 'Character not found' }); return; }
  res.json({ ok: true });
});

campaignsRouter.get('/:id/party/:charId/portrait', async (req, res) => {
  const { id, charId } = req.params as { id: string; charId: string };
  const store = getMediaStore();
  // try .jpg first (new), fall back to .png (legacy)
  const jpg = await store.get(path.join(CAMPAIGNS_DIR, id, 'party', charId, 'portrait.jpg'));
  if (jpg) { res.type('.jpg').send(jpg); return; }
  const png = await store.get(path.join(CAMPAIGNS_DIR, id, 'party', charId, 'portrait.png'));
  if (!png) { res.status(404).json({ error: 'Portrait not found' }); return; }
  res.type('.png').send(png);
});

campaignsRouter.get('/:id/party/:charId/token', async (req, res) => {
  const { id, charId } = req.params as { id: string; charId: string };
  const data = await getMediaStore().get(path.join(CAMPAIGNS_DIR, id, 'party', charId, 'token.png'));
  if (!data) { res.status(404).json({ error: 'Token not found' }); return; }
  res.type('.png').send(data);
});

// Manifest (slide URLs + captions) as JSON — for an on-demand single-viewer "Play" fetch, distinct
// from the room-wide session-start broadcast (socketHandlers/session.ts's storyboard:queue).
campaignsRouter.get('/:id/party/:charId/storyboard', async (req, res) => {
  const { id, charId } = req.params as { id: string; charId: string };
  const storyboard = await getCharacterStoryboard(id, charId);
  if (!storyboard) { res.status(404).json({ error: 'No storyboard generated for this character' }); return; }
  res.json(storyboard);
});

campaignsRouter.get('/:id/party/:charId/storyboard/:n', async (req, res) => {
  const { id, charId, n } = req.params as { id: string; charId: string; n: string };
  if (!new RegExp(`^[1-${SLIDE_COUNT}]$`).test(n)) { res.status(400).json({ error: 'Invalid slide number' }); return; }
  const data = await getMediaStore().get(path.join(CAMPAIGNS_DIR, id, 'party', charId, `storyboard_slide_${n}.jpg`));
  if (!data) { res.status(404).json({ error: 'Storyboard slide not found' }); return; }
  res.type('.jpg').send(data);
});

// Dungeon-crawl worlds only — campaign-root equivalent of the two routes above, for the scenario
// storyboard rather than any one character's.
campaignsRouter.get('/:id/scenario-storyboard', async (req, res) => {
  const { id } = req.params as { id: string };
  const storyboard = await getScenarioStoryboard(id);
  if (!storyboard) { res.status(404).json({ error: 'No scenario storyboard generated for this campaign' }); return; }
  res.json(storyboard);
});

campaignsRouter.get('/:id/scenario-storyboard/:n', async (req, res) => {
  const { id, n } = req.params as { id: string; n: string };
  if (!new RegExp(`^[1-${SCENARIO_SLIDE_COUNT}]$`).test(n)) { res.status(400).json({ error: 'Invalid slide number' }); return; }
  const data = await getMediaStore().get(path.join(CAMPAIGNS_DIR, id, `scenario-storyboard_slide_${n}.jpg`));
  if (!data) { res.status(404).json({ error: 'Scenario storyboard slide not found' }); return; }
  res.type('.jpg').send(data);
});

campaignsRouter.post('/:id/party/auth', async (req, res) => {
  const { password } = req.body as { password: string };
  const char = await findCharacterByPassword(req.params.id ?? '', password);
  if (!char) { res.status(401).json({ error: 'Invalid password' }); return; }
  res.json(char);
});

// ── portrait processing ───────────────────────────────────────────────────────

campaignsRouter.post('/:id/party/portrait', async (req, res) => {
  const { charId, base64image } = req.body as { charId: string; base64image: string };
  if (!charId || !base64image) { res.status(400).json({ error: 'charId and base64image required' }); return; }

  try {
    const input = Buffer.from(base64image, 'base64');
    const { portrait, token } = await processPortrait(input);

    await Promise.all([
      writeCharacterImage(req.params.id ?? '', charId, 'portrait.jpg', portrait),
      writeCharacterImage(req.params.id ?? '', charId, 'token.png', token),
    ]);

    res.json({
      portraitPath: `party/${charId}/portrait.jpg`,
      tokenPath: `party/${charId}/token.png`,
    });
  } catch (err) {
    logError('routes/campaigns:portrait', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Portrait processing failed' });
  }
});

// ── vault writer ──────────────────────────────────────────────────────────────

interface WorldData {
  world?: { name?: string; overview?: string; history?: string; currentState?: string; hooks?: string[]; countdown?: string };
  geography?: { regions?: unknown[]; startingLocation?: { name?: string; description?: string } };
  factions?: Array<{ name?: string; description?: string; goals?: string; methods?: string }>;
  npcs?: Array<{ name?: string; role?: string; race?: string; occupation?: string; personality?: string; motivation?: string; secret?: string; factionAffiliation?: string | null; crossFactionTie?: string | null }>;
  scenario?: { objective?: string; climax?: string; resolution?: string };
}

async function writeVault(slug: string, data: Record<string, unknown>, tags: string[], concept: WorldConcept, onProgress: (msg: string) => void = () => {}): Promise<void> {
  const w = data as WorldData;

  const hooksSection = (w.world?.hooks?.length)
    ? `\n## Hooks\n${w.world.hooks.map(h => `- ${h}`).join('\n')}\n`
    : '';
  const countdownSection = w.world?.countdown
    ? `\n## Countdown\n${w.world.countdown}\n`
    : '';

  const worldMd = `# ${w.world?.name ?? 'World'}\n\n## Overview\n${w.world?.overview ?? ''}\n\n## History\n${w.world?.history ?? ''}\n\n## Current State\n${w.world?.currentState ?? ''}${hooksSection}${countdownSection}`;

  const factionsMd = `# Factions\n\n${(w.factions ?? []).map(f =>
    `## ${f.name ?? 'Unknown'}\n${f.description ?? ''}\n\n**Goals:** ${f.goals ?? ''}\n**Methods:** ${f.methods ?? ''}\n`
  ).join('\n')}`;

  const toSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const npcs = w.npcs ?? [];
  const npcFiles = npcs.map(n => {
    const name = n.name ?? 'Unknown';
    const crossTie = n.crossFactionTie ? `\n**Cross-faction tie:** ${n.crossFactionTie}` : '';
    const content = `# ${name}\n\n**Role:** ${n.role ?? ''} | **Race:** ${n.race ?? ''} | **Occupation:** ${n.occupation ?? ''}\n\n**Personality:** ${n.personality ?? ''}\n**Motivation:** ${n.motivation ?? ''}\n**Secret:** ${n.secret ?? ''}\n**Faction:** ${n.factionAffiliation ?? 'Independent'}${crossTie}\n\n## Observed\n`;
    return writeEntity(slug, 'npc', toSlug(name), content);
  });

  const geo = w.geography;
  const allLocations: Array<{ name: string; description: string }> = [];
  if (geo?.startingLocation?.name) allLocations.push({ name: geo.startingLocation.name, description: geo.startingLocation.description ?? '' });
  for (const r of geo?.regions ?? []) {
    const region = r as { name?: string; description?: string; keyLocations?: Array<{ name?: string; description?: string }> };
    if (region.name) allLocations.push({ name: region.name, description: region.description ?? '' });
    for (const l of region.keyLocations ?? []) {
      if (l.name) allLocations.push({ name: l.name, description: l.description ?? '' });
    }
  }
  const locationFiles = allLocations.map(({ name, description }) => {
    const content = `# ${name}\n\n${description}\n\n## Scene Notes\n`;
    return writeEntity(slug, 'location', toSlug(name), content);
  });

  const scenarioFiles: Promise<void>[] = [];
  if (w.scenario) {
    const s = w.scenario;
    const scenarioMd = `# Scenario\n\n## Objective\n${s.objective ?? ''}\n\n## Climax\n${s.climax ?? ''}\n\n## Resolution\n${s.resolution ?? ''}\n`;
    scenarioFiles.push(writeCampaignFile(slug, 'scenario.md', scenarioMd));
  }

  const startingLocationSlug = geo?.startingLocation?.name ? toSlug(geo.startingLocation.name) : null;
  const manifest = emptyManifest();
  if (startingLocationSlug) manifest.currentLocation = startingLocationSlug;
  const rawStartingTime = (w as Record<string, unknown>).startingTime as string | undefined;
  if (rawStartingTime) {
    const [hh, mm] = rawStartingTime.split(':').map(Number);
    if (!isNaN(hh!) && !isNaN(mm!)) manifest.worldTimeSecs = hh! * 3600 + mm! * 60;
  }

  const today = new Date().toISOString().slice(0, 10);
  type InitialQuest = { id: string; name: string; description: string };
  type ActDef = { act: number; conditions: string[] };
  const rawQuests = (w as Record<string, unknown>).initialQuests as InitialQuest[] | undefined ?? [];
  const rawActs = (w as Record<string, unknown>).acts as ActDef[] | undefined ?? [];
  const initialQuests = rawQuests.map(q => ({
    id: q.id, name: q.name, description: q.description,
    status: 'undiscovered' as const, log: [], addedAt: today,
  }));

  console.log(`[worldgen] initial quests (${initialQuests.length}):\n${initialQuests.map(q => `  ${q.id}: ${q.name} — ${q.description}`).join('\n')}`);

  // Report what's being created before writing
  onProgress(`World: ${w.world?.name ?? concept.name}`);
  if (npcs.length) {
    const preview = npcs.slice(0, 4).map(n => n.name ?? '?').join(', ');
    onProgress(`${npcs.length} NPCs — ${preview}${npcs.length > 4 ? '…' : ''}`);
  }
  if (allLocations.length) {
    const preview = allLocations.slice(0, 4).map(l => l.name).join(', ');
    onProgress(`${allLocations.length} locations — ${preview}${allLocations.length > 4 ? '…' : ''}`);
  }
  const factions = w.factions ?? [];
  if (factions.length) {
    const preview = factions.slice(0, 3).map(f => f.name ?? '?').join(', ');
    onProgress(`${factions.length} factions — ${preview}${factions.length > 3 ? '…' : ''}`);
  }
  if (rawQuests.length) onProgress(`${rawQuests.length} quests`);
  if (w.scenario) onProgress('Scenario and hooks');

  await Promise.all([
    writeCampaignFile(slug, 'world.md', worldMd),
    writeCampaignFile(slug, 'factions.md', factionsMd),
    writeCampaignFile(slug, 'manifest.json', JSON.stringify(manifest, null, 2)),
    writeQuests(slug, initialQuests),
    writeCampaignFile(slug, 'acts.json', JSON.stringify(rawActs, null, 2)),
    ...npcFiles,
    ...locationFiles,
    ...scenarioFiles,
    writeCampaignFile(slug, 'meta.json', JSON.stringify({ tags, concept, createdAt: new Date().toISOString() }, null, 2)),
  ]);
}
