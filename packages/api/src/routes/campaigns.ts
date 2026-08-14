import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { WorldConcept, Character, Quest } from 'shared';
import { spellSlotsForClass } from 'shared';
import {
  CAMPAIGNS_DIR,
  getConfig, writeCampaignFile, listCampaigns,
  getWorldMeta, writeWorldMeta,
  writeCharacter, updateCharacter, getCharacter, listCharacters, findCharacterByPassword, writeCharacterImage,
  readCampaignFile, writeEntity,
  listEntitySlugs, readEntity, saveDungeon, saveDungeonAscii, writeManifest, readManifest, emptyManifest, readQuests, writeQuests,
} from '../storage.ts';
import { generateDungeon, buildDungeonQuests } from '../dungeon/index.ts';
import { calcMaxHp } from '../combat/dice.ts';
import { getFeatureProvider } from '../providers/index.ts';
import { copyCompendiumToCampaign } from '../compendium/storage.ts';
import { copyAdventureToCampaign } from '../adventures/storage.ts';
import { buildConceptsPrompt, buildWorldGenPrompt, buildDungeonCrawlPremisePrompt, buildBackstoryCheckPrompt, buildBackstoryGeneratePrompt, buildBackstoryExtractPrompt } from '../prompts.ts';
import { processSession, generateDmBrief } from '../session-processor/index.ts';
import { processPortrait } from '../utils/image.ts';
import { buildWorldMapPrompt } from '../session-processor/imagePrompts.ts';
import { generateBattleMap } from '../providers/openai.ts';
import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { logError } from '../logger.ts';

export const campaignsRouter = Router();

// LLMs occasionally tack a stray closing quote onto true/false/null literals
// (e.g. `"factionAffiliation": null"`) — jsonrepair can't infer intent there, so strip it first.
function parseLlmJson<T>(raw: string): T {
  const desanitized = raw.replace(/(:\s*(?:true|false|null))"(?=\s*[,}])/g, '$1');
  return JSON.parse(jsonrepair(desanitized)) as T;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Regenerating with the same name/tags previously overwrote the prior campaign in place — bump a
// numeric suffix until the directory is free instead of silently clobbering it.
function uniqueSlug(base: string): string {
  let slug = base;
  let n = 2;
  while (existsSync(path.join(CAMPAIGNS_DIR, slug))) {
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

campaignsRouter.get('/:id/world-map', (req, res) => {
  res.sendFile(`${req.params.id}/world-map.jpg`, { root: CAMPAIGNS_DIR }, err => {
    if (err) res.status(404).json({ error: 'No world map' });
  });
});

// ── campaign meta ─────────────────────────────────────────────────────────────

campaignsRouter.get('/:id', async (req, res) => {
  const slug = req.params.id ?? '';
  const meta = await getWorldMeta(slug);
  if (!meta) { res.status(404).json({ error: 'Campaign not found' }); return; }
  // merge tags from meta.json if present
  try {
    const { readFile } = await import('fs/promises');
    const raw = await readFile(`${CAMPAIGNS_DIR}/${slug}/meta.json`, 'utf-8');
    const campaign = JSON.parse(raw) as { tags?: string[] };
    res.json({ ...meta, tags: campaign.tags ?? [] });
  } catch (err) {
    logError('routes/campaigns:getById', err);
    res.json(meta);
  }
});

// ── concept generation ────────────────────────────────────────────────────────

campaignsRouter.post('/concepts', async (req, res) => {
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

campaignsRouter.post('/generate', async (req, res) => {
  const { tags, concept, name, type = 'campaign', partySize = 4 } = req.body as { tags: string[]; concept: WorldConcept; name: string; type?: 'campaign' | 'one-shot' | 'dungeon-crawl'; partySize?: number };
  if (!concept || !tags?.length) { res.status(400).json({ error: 'tags and concept required' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const config = await getConfig();

    // Dungeon crawl: no world, no factions, no NPC roster — just a short premise and the dungeon
    // itself, generated straight from the tags rather than funnelled through a world concept.
    if (type === 'dungeon-crawl') {
      send({ type: 'progress', message: 'Writing premise…' });
      const raw = await getFeatureProvider(config, 'dungeonPremise').stream(
        buildDungeonCrawlPremisePrompt(tags),
        token => send({ type: 'token', text: token }),
      );
      let title = concept.name, premise = concept.description;
      try {
        const parsed = parseLlmJson<{ title?: string; premise?: string }>(raw);
        if (parsed.title) title = parsed.title;
        if (parsed.premise) premise = parsed.premise;
      } catch (err) { logError('routes/campaigns:generate:dungeonCrawlPremise', err); }

      // Slugged from the generated title (like campaigns), not the tags[0] placeholder the client
      // passes as `name`/`concept.name` before the real title exists.
      const slug = uniqueSlug(slugify(title));
      await writeCampaignFile(slug, 'world.md', `# ${title}\n\n${premise.trim()}`);

      const campaignName = title;
      await writeWorldMeta(slug, {
        id: randomUUID(),
        name: campaignName,
        campaignDir: slug,
        type,
        concept: { name: concept.name, description: concept.description },
      });

      send({ type: 'progress', message: 'Generating dungeon…' });
      const dungeon = await generateDungeon(
        title, 'dungeon-crawl', getFeatureProvider(config, 'dungeonGeneration'), tags.join(', '),
        { width: 100, height: 100, roomRange: [14, 20], partySize },
        token => send({ type: 'token', text: token }),
      );
      await saveDungeon(slug, dungeon);
      await saveDungeonAscii(slug, dungeon);
      await writeQuests(slug, buildDungeonQuests(dungeon, await readQuests(slug)));

      send({ type: 'complete', id: slug, name: campaignName });
      return;
    }

    const slug = uniqueSlug(slugify(name || concept.name));

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
    const campaignName = world.world?.name ?? name ?? concept.name;
    await writeWorldMeta(slug, {
      id: randomUUID(),
      name: campaignName,
      campaignDir: slug,
      type,
      concept: { name: concept.name, description: concept.description },
    });

    if (type === 'campaign' && config.image.generateWorldMap) {
      const apiKey = config.apiKeys.openai;
      if (apiKey) {
        send({ type: 'progress', message: 'Generating world map...' });
        try {
          const worldMd = await readCampaignFile(slug, 'world.md') ?? '';
          const locationSlugs = await listEntitySlugs(slug, 'location');
          const locationContents = await Promise.all(locationSlugs.map(s => readEntity(slug, 'location', s)));
          const locationsSummary = locationContents.filter(Boolean).map(c => {
            // Extract name + description only (stop before ## Scene Notes)
            const text = c!;
            const cutoff = text.indexOf('\n## ');
            return cutoff === -1 ? text.trim() : text.slice(0, cutoff).trim();
          }).join('\n\n');
          const prompt = buildWorldMapPrompt(worldMd, locationsSummary, tags);
          const buffer = await generateBattleMap(prompt, apiKey, config.image.model);
          await writeFile(path.join(CAMPAIGNS_DIR, slug, 'world-map.jpg'), buffer);
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

campaignsRouter.post('/from-module', async (req, res) => {
  const { adventureSlug, campaignName } = req.body as { adventureSlug?: string; campaignName?: string };
  if (!adventureSlug || !campaignName) {
    res.status(400).json({ error: 'adventureSlug and campaignName are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function send(data: object) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

  const slug = uniqueSlug(slugify(campaignName));
  try {
    send({ type: 'progress', message: 'Copying module entities…' });
    await copyCompendiumToCampaign(adventureSlug, slug, campaignName);

    send({ type: 'progress', message: 'Generating DM brief…' });
    const locationSlugs = await listEntitySlugs(slug, 'location');
    const npcSlugs = await listEntitySlugs(slug, 'npc');
    const factionSlugs = await listEntitySlugs(slug, 'faction');
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

    await Promise.all([
      writeFile(path.join(CAMPAIGNS_DIR, slug, 'dm-brief.md'), brief.dmBrief, 'utf-8'),
      writeManifest(slug, manifest),
      writeQuests(slug, initialQuests),
      writeCampaignFile(slug, 'acts.json', JSON.stringify(brief.acts ?? [], null, 2)),
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

campaignsRouter.post('/from-adventure', async (req, res) => {
  const { adventureSlug, campaignName } = req.body as { adventureSlug?: string; campaignName?: string };
  if (!adventureSlug || !campaignName) {
    res.status(400).json({ error: 'adventureSlug and campaignName are required' });
    return;
  }

  const slug = uniqueSlug(slugify(campaignName));
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
  await writeCharacter(slug, charId, character);
  res.json({ id: charId });
  void syncCharacterToWorldLore(slug, character);
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
    const backstory = await getFeatureProvider(config, 'backstoryGeneration').complete(
      buildBackstoryGeneratePrompt(worldMd, { name, species, background, characterClass }),
    );
    res.json({ backstory: backstory.trim() });
  } catch (err) {
    logError('routes/campaigns:backstory-generate', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Backstory generation failed' });
  }
});

campaignsRouter.get('/:id/party/:charId', async (req, res) => {
  const char = await getCharacter(req.params.id ?? '', req.params.charId ?? '');
  if (!char) { res.status(404).json({ error: 'Character not found' }); return; }
  const maxHp = calcMaxHp(char);
  const maxSpellSlots1 = spellSlotsForClass(char.class);
  res.json({
    ...char,
    maxHp, currentHp: char.currentHp ?? maxHp,
    maxSpellSlots1, currentSpellSlots1: char.currentSpellSlots1 ?? maxSpellSlots1,
  });
});

campaignsRouter.patch('/:id/party/:charId', async (req, res) => {
  const { id, charId } = req.params as { id: string; charId: string };
  const allowed = ['xp', 'level', 'proficiencyBonus'] as const;
  const patch = Object.fromEntries(allowed.filter(k => k in req.body).map(k => [k, (req.body as Record<string, unknown>)[k]]));
  const updated = await updateCharacter(id, charId, char => ({ ...char, ...patch }));
  if (!updated) { res.status(404).json({ error: 'Character not found' }); return; }
  res.json({ ok: true });
});

campaignsRouter.get('/:id/party/:charId/portrait', (req, res) => {
  const { id, charId } = req.params as { id: string; charId: string };
  // try .jpg first (new), fall back to .png (legacy)
  res.sendFile(`${id}/party/${charId}/portrait.jpg`, { root: CAMPAIGNS_DIR }, err => {
    if (err) res.sendFile(`${id}/party/${charId}/portrait.png`, { root: CAMPAIGNS_DIR }, err2 => {
      if (err2) res.status(404).json({ error: 'Portrait not found' });
    });
  });
});

campaignsRouter.get('/:id/party/:charId/token', (req, res) => {
  const { id, charId } = req.params as { id: string; charId: string };
  res.sendFile(`${id}/party/${charId}/token.png`, { root: CAMPAIGNS_DIR }, err => {
    if (err) res.status(404).json({ error: 'Token not found' });
  });
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
