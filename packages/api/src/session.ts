import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { CAMPAIGNS_DIR, listEntitySlugs, readEntity, getWorldMeta, getConfig, saveDungeon, loadDungeon, readManifest, writeManifest, emptyManifest, readQuests, appendChatLog } from './storage.ts';
import { getFeatureProvider, hasFeatureProvider } from './providers/index.ts';
import { buildRecapPrompt, buildDungeonRecapPrompt } from './session-processor/prompts.ts';
import { processSession, getDMResponse, getDungeonNarrationResponse } from './session-processor/index.ts';
import { describeDungeonState, describeDungeonGroundTruth } from './dungeon/index.ts';
import { processVdmResponse } from './tag-processor.ts';
import { logError } from './logger.ts';
import { io, ROOM, sessionState, combatState, dungeons, tokenPositions, connected, dmQueue } from './state.ts';
import { endCombat } from './combat/runtime.ts';
import { applyEffects } from './effects.ts';

export function queueDMResponse(campaignId: string, fn: () => Promise<void>): void {
  const prev = dmQueue.get(campaignId) ?? Promise.resolve();
  dmQueue.set(campaignId, prev.then(fn).catch(err => logError('index:queueDMResponse', err)));
}

export function endSession(cid: string): void {
  if (!sessionState.get(cid)) return;
  sessionState.set(cid, false);
  io.to(ROOM).emit('session:state', false);
  const dungeon = dungeons.get(cid);
  if (dungeon) {
    dungeon.positions = tokenPositions.get(cid) ?? {};
    void saveDungeon(cid, dungeon);
  }
  void readManifest(cid).then(manifest => {
    const m = manifest ?? emptyManifest();
    m.sessionsPlayed = (m.sessionsPlayed ?? 0) + 1;
    void writeManifest(cid, m);
  });
  void processSession(cid).then(async result => {
    const names = [...(result.updated ?? []), ...(result.created ?? []), ...(result.cascaded ?? [])];
    const text = result.skipped
      ? 'Session ended — no chat to process.'
      : `Session ended — notes updated: ${names.join(', ') || 'nothing new'}`;
    io.to(ROOM).emit('chat:message', { text, senderName: 'System', timestamp: Date.now() });
    const [quests, manifest] = await Promise.all([readQuests(cid), readManifest(cid)]);
    io.to(ROOM).emit('quest:update', { quests, act: manifest?.act ?? 1 });
  });
}

async function buildEntitySummaries(campaignId: string): Promise<string> {
  const lines: string[] = [];

  // World bible — generated campaigns; absent for modules, that's fine
  for (const filename of ['world.md', 'factions.md']) {
    try {
      const content = await readFile(path.join(CAMPAIGNS_DIR, campaignId, filename), 'utf-8');
      lines.push(`### ${filename}\n${content.slice(0, 1000)}`);
    } catch (err) { logError('index:buildEntitySummaries', err); }
  }

  // Characters — always load (the active party)
  const charSlugs = await listEntitySlugs(campaignId, 'character');
  for (const slug of charSlugs) {
    const content = await readEntity(campaignId, 'character', slug);
    if (content) lines.push(`### character/${slug}\n${content.slice(0, 500)}`);
  }

  const manifest = await readManifest(campaignId);
  if (!manifest) return lines.join('\n\n') || '(no entity notes yet)';

  // Current location — full content (scene text + DM notes)
  if (manifest.currentLocation) {
    const content = await readEntity(campaignId, 'location', manifest.currentLocation);
    if (content) lines.push(`### location/${manifest.currentLocation} [CURRENT]\n${content}`);
  }

  // NPCs and factions in current scene
  for (const slug of manifest.npcs) {
    const content = await readEntity(campaignId, 'npc', slug);
    if (content) lines.push(`### npc/${slug}\n${content.slice(0, 800)}`);
  }
  for (const slug of manifest.factions) {
    const content = await readEntity(campaignId, 'faction', slug);
    if (content) lines.push(`### faction/${slug}\n${content.slice(0, 600)}`);
  }

  // Adjacent zones — names only so DM can narrate transitions
  if (manifest.connectedZones.length) {
    lines.push(`### Connected zones\n${manifest.connectedZones.join(', ')}`);
  }

  return lines.join('\n\n') || '(no entity notes yet)';
}

export async function isFirstSession(campaignId: string): Promise<boolean> {
  const sessionsDir = path.join(CAMPAIGNS_DIR, campaignId, 'sessions');
  return !existsSync(sessionsDir) || (await readdir(sessionsDir)).length === 0;
}

export async function runRecap(campaignId: string): Promise<{ text: string; isFirstSession: boolean }> {
  const sessionsDir = path.join(CAMPAIGNS_DIR, campaignId, 'sessions');
  const firstSession = await isFirstSession(campaignId);

  let lastSessionText: string | null = null;
  if (!firstSession) {
    const files = (await readdir(sessionsDir)).sort();
    const last = files[files.length - 1];
    if (last) {
      try {
        const raw = await readFile(path.join(sessionsDir, last), 'utf-8');
        const msgs = JSON.parse(raw) as Array<{ senderName: string; text: string }>;
        lastSessionText = msgs.map(m => `[${m.senderName}]: ${m.text}`).join('\n');
      } catch (err) { logError('index:runRecap', err); }
    }
  }

  const meta = await getWorldMeta(campaignId);
  const config = await getConfig();
  const provider = getFeatureProvider(config, 'sessionRecap');

  // Dungeon-crawl worlds are closed-world (see getDungeonNarrationResponse) — the open-world recap
  // pulls in world.md/factions.md/NPC notes and improvises freely, which is exactly what invented
  // the hallucinated rope-ladder/gills prose. Route through the dungeon's own seeded goals/quests
  // and floor plan instead, same as every other narration path into a dungeon.
  if (meta?.type === 'dungeon-crawl') {
    const dungeon = dungeons.get(campaignId) ?? await loadDungeon(campaignId);
    const dungeonQuests = dungeon ? (await readQuests(campaignId)).filter(q => q.sourceDungeonId === dungeon.id) : [];
    const groundTruth = dungeon ? describeDungeonGroundTruth(dungeon, {}) : '(no dungeon generated yet)';
    const text = await provider.complete(buildDungeonRecapPrompt({
      dungeonName: dungeon?.name ?? meta.name ?? 'the dungeon',
      goals: dungeon?.goals ?? [],
      dungeonQuests,
      groundTruth,
      lastSessionText,
      isFirstSession: firstSession,
    }));
    return { text, isFirstSession: firstSession };
  }

  const entitySummaries = await buildEntitySummaries(campaignId);
  const text = await provider.complete(buildRecapPrompt(lastSessionText, entitySummaries, meta?.name ?? 'Unknown World', firstSession));
  return { text, isFirstSession: firstSession };
}

export function dispatchDMResponse(cid: string): void {
  if (!sessionState.get(cid)) return;
  io.to(ROOM).emit('dm:thinking', true);
  queueDMResponse(cid, async () => {
    try {
      const dungeon = dungeons.get(cid);
      const playerPositions = Object.fromEntries(
        Object.entries(tokenPositions.get(cid) ?? {}).filter(([name]) => connected.has(name))
      );
      // Anything inside a dungeon → the closed-world dungeon narrator, combat or not. Exploration
      // gets the full floor plan so spatial questions can be answered accurately; combat gets the
      // lighter discovered-only view, since between-turn narration has no spatial reasoning to do
      // and the mechanical combat log already carries the blow-by-blow. Only genuinely open-world
      // play still reaches the general narrator.
      const combatActive = !!combatState.get(cid);
      const response = dungeon
        ? await getDungeonNarrationResponse(
            cid,
            dungeon,
            combatActive ? describeDungeonState(dungeon, playerPositions) : describeDungeonGroundTruth(dungeon, playerPositions),
            combatActive,
          )
        : await getDMResponse(cid);
      if (!response) return;

      if (response.includes('[COMBAT END]') && combatState.get(cid)) {
        combatState.set(cid, false);
        void endCombat(cid);
        io.to(ROOM).emit('combat:state', false);
      }

      const rawResponse = response.replace(/\[COMBAT END\]/g, '').trim();
      const config = await getConfig();
      const { text: cleanResponse, effects, speakingAs, checkRequests } = hasFeatureProvider(config, 'tagEffectProcessing')
        ? await processVdmResponse(rawResponse, getFeatureProvider(config, 'tagEffectProcessing'))
        : { text: rawResponse, effects: [], speakingAs: undefined, checkRequests: [] };

      await applyEffects(cid, effects);

      const senderName = speakingAs ? `${speakingAs} (Virtual DM)` : 'Virtual DM';
      await appendChatLog(cid, { text: cleanResponse, senderName, timestamp: Date.now() });
      io.to(ROOM).emit('session:recap', { text: cleanResponse, senderName, checkRequests });
    } catch (err) {
      logError('index:dmResponse', err);
      io.to(ROOM).emit('chat:message', { text: `[DM error: ${(err as Error).message}]`, senderName: 'System', timestamp: Date.now() });
    } finally {
      io.to(ROOM).emit('dm:thinking', false);
    }
  });
}
