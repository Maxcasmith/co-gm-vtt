import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { WorldConcept, Character } from 'shared';
import {
  CAMPAIGNS_DIR,
  getConfig, writeCampaignFile, listCampaigns,
  getWorldMeta, writeWorldMeta,
  writeCharacter, getCharacter, listCharacters, findCharacterByPassword, writeCharacterImage,
  readWorldState, writeWorldState, readCampaignFile,
} from '../storage.ts';
import { getStoryProvider } from '../providers/index.ts';
import { buildConceptsPrompt, buildWorldGenPrompt } from '../prompts.ts';
import { processSession } from '../session-processor/index.ts';
import { processPortrait } from '../utils/image.ts';
import { generateWorldState, tickWorldNarrative } from '../session-processor/imagePrompts.ts';

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
  const { tags, concept, name, type = 'campaign' } = req.body as { tags: string[]; concept: WorldConcept; name: string; type?: 'campaign' | 'one-shot' };
  if (!concept || !tags?.length) { res.status(400).json({ error: 'tags and concept required' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const slug = (name || concept.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  try {
    let accumulated = '';
    await getStoryProvider(await getConfig()).stream(
      buildWorldGenPrompt(tags, concept.name, concept.description, type),
      token => { accumulated += token; send({ type: 'token', content: token }); },
    );

    const start = accumulated.indexOf('{');
    const end   = accumulated.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('Model did not return a JSON object');
    const jsonStr = accumulated.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1');
    const world = JSON.parse(jsonStr) as Record<string, unknown> & { world?: { name?: string } };

    send({ type: 'progress', message: 'Writing vault...' });
    await writeVault(slug, world, tags, concept);

    // write world.json with stable id + display name
    const campaignName = world.world?.name ?? name ?? concept.name;
    await writeWorldMeta(slug, {
      id: randomUUID(),
      name: campaignName,
      campaignDir: slug,
      type,
      concept: { name: concept.name, description: concept.description },
    });

    send({ type: 'complete', id: slug, name: campaignName });
  } catch (err) {
    send({ type: 'error', message: err instanceof Error ? err.message : 'Generation failed' });
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
  world?: { name?: string; overview?: string; history?: string; currentState?: string };
  geography?: { regions?: unknown[]; startingLocation?: { name?: string; description?: string } };
  factions?: Array<{ name?: string; description?: string; goals?: string; methods?: string }>;
  npcs?: Array<{ name?: string; role?: string; race?: string; occupation?: string; personality?: string; motivation?: string; secret?: string; factionAffiliation?: string | null }>;
}

async function writeVault(slug: string, data: Record<string, unknown>, tags: string[], concept: WorldConcept): Promise<void> {
  const w = data as WorldData;

  const worldMd = `# ${w.world?.name ?? 'World'}\n\n## Overview\n${w.world?.overview ?? ''}\n\n## History\n${w.world?.history ?? ''}\n\n## Current State\n${w.world?.currentState ?? ''}\n`;

  const factionsMd = `# Factions\n\n${(w.factions ?? []).map(f =>
    `## ${f.name ?? 'Unknown'}\n${f.description ?? ''}\n\n**Goals:** ${f.goals ?? ''}\n**Methods:** ${f.methods ?? ''}\n`
  ).join('\n')}`;

  const npcsMd = `# NPCs\n\n${(w.npcs ?? []).map(n =>
    `## ${n.name ?? 'Unknown'}\n**Role:** ${n.role ?? ''} | **Race:** ${n.race ?? ''} | **Occupation:** ${n.occupation ?? ''}\n\n**Personality:** ${n.personality ?? ''}\n**Motivation:** ${n.motivation ?? ''}\n**Secret:** ${n.secret ?? ''}\n**Faction:** ${n.factionAffiliation ?? 'Independent'}\n`
  ).join('\n')}`;

  const geo = w.geography;
  const locationsMd = `# Locations\n\n## Starting Location\n**${geo?.startingLocation?.name ?? ''}**\n${geo?.startingLocation?.description ?? ''}\n\n## Regions\n${(geo?.regions ?? []).map((r: unknown) => {
    const region = r as { name?: string; description?: string; keyLocations?: Array<{ name?: string; description?: string }> };
    return `### ${region.name ?? ''}\n${region.description ?? ''}\n\n${(region.keyLocations ?? []).map(l => `- **${l.name ?? ''}**: ${l.description ?? ''}`).join('\n')}\n`;
  }).join('\n')}`;

  await Promise.all([
    writeCampaignFile(slug, 'world.md', worldMd),
    writeCampaignFile(slug, 'factions.md', factionsMd),
    writeCampaignFile(slug, 'npcs.md', npcsMd),
    writeCampaignFile(slug, 'locations.md', locationsMd),
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
    const { model, apiKey } = config.combat;

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
