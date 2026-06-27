import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { WorldConcept, Character } from 'shared';
import {
  CAMPAIGNS_DIR,
  getConfig, writeCampaignFile, listCampaigns,
  getWorldMeta, writeWorldMeta,
  writeCharacter, getCharacter, listCharacters, findCharacterByPassword, writeCharacterImage,
  readWorldState, writeWorldState, readCampaignFile, writeEntity,
  listEntitySlugs, readEntity, saveDungeon, writeManifest, readManifest, emptyManifest, writeQuests,
} from '../storage.ts';
import { generateGrid } from '../dungeon/generator.ts';
import { placeEntities } from '../dungeon/placer.ts';
import { getStoryProvider, getTierApiKey } from '../providers/index.ts';
import { copyCompendiumToCampaign } from '../compendium/storage.ts';
import { buildConceptsPrompt, buildWorldGenPrompt } from '../prompts.ts';
import { processSession, generateDmBrief } from '../session-processor/index.ts';
import { processPortrait } from '../utils/image.ts';
import { generateWorldState, tickWorldNarrative, buildWorldMapPrompt } from '../session-processor/imagePrompts.ts';
import { generateBattleMap } from '../providers/openai.ts';
import { writeFile } from 'fs/promises';
import path from 'path';

export const campaignsRouter = Router();

// ── session processing ────────────────────────────────────────────────────────

campaignsRouter.post('/:slug/session/process', async (req, res) => {
  try {
    const result = await processSession(req.params.slug ?? '');
    res.json(result);
  } catch (err) {
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
  } catch {
    res.json(meta);
  }
});

// ── concept generation ────────────────────────────────────────────────────────

campaignsRouter.post('/concepts', async (req, res) => {
  const { tags, type = 'campaign' } = req.body as { tags: string[]; type?: 'campaign' | 'one-shot' };
  if (!tags?.length) { res.status(400).json({ error: 'tags required' }); return; }
  const config = await getConfig();
  try {
    const raw = await getStoryProvider(config).complete(buildConceptsPrompt(tags, type));
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    res.json(JSON.parse(cleaned) as WorldConcept[]);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Concept generation failed' });
  }
});

// ── world generation (SSE) ────────────────────────────────────────────────────

campaignsRouter.post('/generate', async (req, res) => {
  const { tags, concept, name, type = 'campaign' } = req.body as { tags: string[]; concept: WorldConcept; name: string; type?: 'campaign' | 'one-shot' | 'dungeon-crawl' };
  if (!concept || !tags?.length) { res.status(400).json({ error: 'tags and concept required' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const slug = (name || concept.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  try {
    let accumulated = '';
    const config = await getConfig();
    send({ type: 'progress', message: 'Generating world…' });
    await getStoryProvider(config).stream(
      buildWorldGenPrompt(tags, concept.name, concept.description, type),
      token => { accumulated += token; },
    );

    const start = accumulated.indexOf('{');
    const end   = accumulated.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('Model did not return a JSON object');
    const jsonStr = accumulated.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1');
    const world = JSON.parse(jsonStr) as Record<string, unknown> & { world?: { name?: string } };

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

    if (type === 'dungeon-crawl') {
      const { cells, rooms } = generateGrid(null);
      const entities = placeEntities(rooms, null);
      await saveDungeon(slug, { id: randomUUID(), name: concept.name, width: 50, height: 50, cells, rooms, entities });
    }

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
          console.error('[world-map] generation failed:', err);
        }
      }
    }

    send({ type: 'complete', id: slug, name: campaignName });
  } catch (err) {
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

  const slug = campaignName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
    send({ type: 'error', message: err instanceof Error ? err.message : 'Failed to create campaign' });
  } finally {
    res.end();
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
});

campaignsRouter.get('/:id/party/:charId', async (req, res) => {
  const char = await getCharacter(req.params.id ?? '', req.params.charId ?? '');
  if (!char) { res.status(404).json({ error: 'Character not found' }); return; }
  res.json(char);
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

// ── Resting ───────────────────────────────────────────────────────────────────

const HIT_DICE: Record<string, number> = {
  Artificer: 8, Barbarian: 12, Bard: 8, Cleric: 8, Druid: 8,
  Fighter: 10, Monk: 8, Paladin: 10, Ranger: 10, Rogue: 8,
  Sorcerer: 6, Warlock: 8, Wizard: 6,
};
function statMod(score: number) { return Math.floor((score - 10) / 2); }
function calcMaxHp(char: Character): number {
  return char.maxHp ?? ((HIT_DICE[char.class] ?? 8) + statMod(char.stats.con));
}

campaignsRouter.post('/:id/rest/short', async (req, res) => {
  try {
    const { id } = req.params;
    const { characterId, hitDiceSpent } = req.body as { characterId: string; hitDiceSpent: number };
    const char = await getCharacter(id, characterId);
    if (!char) return res.status(404).json({ error: 'Character not found' });

    const dieSize  = HIT_DICE[char.class] ?? 8;
    const conMod   = statMod(char.stats.con);
    const maxHp    = calcMaxHp(char);
    const current  = char.currentHp ?? maxHp;

    let hpGained = 0;
    for (let i = 0; i < (hitDiceSpent ?? 0); i++) {
      hpGained += Math.floor(Math.random() * dieSize) + 1 + conMod;
    }
    hpGained = Math.max(0, hpGained);
    const currentHp = Math.min(maxHp, current + hpGained);

    await writeCharacter(id, characterId, { ...char, currentHp, maxHp });
    return res.json({ hpGained, currentHp, maxHp });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Rest failed' });
  }
});

campaignsRouter.post('/:id/rest/long', async (req, res) => {
  try {
    const { id } = req.params;
    const { characterId } = req.body as { characterId: string };
    const char = await getCharacter(id, characterId);
    if (!char) return res.status(404).json({ error: 'Character not found' });

    const maxHp = calcMaxHp(char);
    await writeCharacter(id, characterId, { ...char, currentHp: maxHp, maxHp });

    // Advance world state
    const HOURS = 8;
    let state = await readWorldState(id);

    const config = await getConfig();
    const { model, provider } = config.tiers[config.tasks.combat];
    const apiKey = getTierApiKey(config.apiKeys, provider);

    if (!state && apiKey) {
      const [worldMd, factionsMd] = await Promise.all([
        readCampaignFile(id, 'world.md'),
        readCampaignFile(id, 'factions.md'),
      ]);
      state = await generateWorldState(worldMd ?? '', factionsMd ?? '', apiKey, model);
      if (state) { state.dayNumber = 1; state.totalHoursElapsed = 0; }
    }

    let worldEvents: string | null = null;
    if (state) {
      state.totalHoursElapsed += HOURS;
      state.dayNumber = Math.floor(state.totalHoursElapsed / 24) + 1;
      const newlyCompleted: string[] = [];

      for (const actor of state.actors) {
        if (actor.status !== 'active') continue;
        actor.daysElapsed += HOURS / 24;
        for (const ms of actor.milestones) {
          if (!ms.completed && actor.daysElapsed >= ms.day) {
            ms.completed = true;
            ms.completedOnDay = Math.floor(actor.daysElapsed);
            newlyCompleted.push(`${actor.name}: ${ms.description}`);
          }
        }
        // Update currentStatus to next uncompleted milestone
        const next = actor.milestones.find(m => !m.completed);
        if (next) actor.currentStatus = `Working toward: ${next.description}`;
        else if (actor.daysElapsed >= actor.totalDays) {
          actor.status = 'succeeded';
          actor.currentStatus = `Has achieved their ultimate goal: ${actor.ultimateGoal}`;
          newlyCompleted.push(`⚠️ ${actor.name} HAS SUCCEEDED: ${actor.ultimateGoal}`);
        }
      }

      if (apiKey) {
        const worldMd = await readCampaignFile(id, 'world.md');
        worldEvents = await tickWorldNarrative(state, HOURS, worldMd ?? '', newlyCompleted, apiKey, model);
      }

      await writeWorldState(id, state);
    }

    return res.json({ currentHp: maxHp, maxHp, worldEvents: worldEvents ?? undefined });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Long rest failed' });
  }
});
