import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { CAMPAIGNS_DIR, listEntitySlugs, readEntity, getWorldMeta, getConfig, saveDungeon, readManifest, writeManifest, emptyManifest, readQuests, appendChatLog } from './storage.ts';
import { getFeatureProvider, hasFeatureProvider } from './providers/index.ts';
import { buildRecapPrompt } from './session-processor/prompts.ts';
import { processSession, getDMResponse, getDungeonExplorationResponse } from './session-processor/index.ts';
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

export async function runRecap(campaignId: string): Promise<{ text: string; isFirstSession: boolean }> {
  const sessionsDir = path.join(CAMPAIGNS_DIR, campaignId, 'sessions');
  const isFirstSession = !existsSync(sessionsDir) || (await readdir(sessionsDir)).length === 0;

  let lastSessionText: string | null = null;
  if (!isFirstSession) {
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

  const entitySummaries = await buildEntitySummaries(campaignId);
  const meta = await getWorldMeta(campaignId);
  const config = await getConfig();
  const provider = getFeatureProvider(config, 'sessionRecap');
  const text = await provider.complete(buildRecapPrompt(lastSessionText, entitySummaries, meta?.name ?? 'Unknown World', isFirstSession));
  return { text, isFirstSession };
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
      // Dungeon loaded, combat not active → dedicated exploration pathway with the full floor plan.
      // Otherwise (no dungeon, or combat narration between turns) → the general narrator, same as always.
      const response = dungeon && !combatState.get(cid)
        ? await getDungeonExplorationResponse(cid, describeDungeonGroundTruth(dungeon, playerPositions))
        : await getDMResponse(cid, dungeon ? describeDungeonState(dungeon, playerPositions) : '');
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
