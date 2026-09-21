import path from 'path';
import { SKILL_ABILITY, trackOf, type ChatPayload, type CheckRequest, type GroupColor } from 'shared';
import { CAMPAIGNS_DIR, listEntitySlugs, readEntity, getWorldMeta, getConfig, saveDungeon, loadDungeons, readManifest, writeManifest, emptyManifest, readQuests, appendChatLog, appendNote } from './storage.ts';
import { getTextStore } from './storage/index.ts';
import { getFeatureProvider, hasFeatureProvider } from './providers/index.ts';
import { buildRecapPrompt, buildDungeonRecapPrompt } from './session-processor/prompts.ts';
import { processSession, getDMResponse, getDungeonNarrationResponse } from './session-processor/index.ts';
import { describeDungeonState, describeDungeonGroundTruth, describeCombatLocation } from './dungeon/index.ts';
import { processVdmResponse, repairMissedPickup } from './tag-processor.ts';
import { logError } from './logger.ts';
import { io, campaignRoom, sessionState, dungeonsIn, dungeonOf, connected, dmQueue, fightOf, toFight, type Audience } from './state.ts';
import { endCombat } from './combat/runtime/lifecycle.ts';
import { applyEffects } from './effects.ts';
import { audienceTracks, toTracks, tagForSplit, readChatContext, getPartyGroups, type ChatAudience } from './partyGroups.ts';

// Keyed per campaign + audience tracks, not per campaign alone — two split groups' DM turns are
// independent and shouldn't wait on each other; same-track turns still serialize.
export function queueDMResponse(key: string, fn: () => Promise<void>): void {
  const prev = dmQueue.get(key) ?? Promise.resolve();
  dmQueue.set(key, prev.then(fn).catch(err => logError('index:queueDMResponse', err)));
}

export function endSession(cid: string): void {
  if (!sessionState.get(cid)) return;
  sessionState.set(cid, false);
  io.to(campaignRoom(cid)).emit('session:state', false);
  // Positions live on each dungeon already — just flush every loaded map.
  for (const dungeon of dungeonsIn(cid)) void saveDungeon(cid, dungeon);
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
    io.to(campaignRoom(cid)).emit('chat:message', { text, senderName: 'System', timestamp: Date.now() });
    const [quests, manifest] = await Promise.all([readQuests(cid), readManifest(cid)]);
    io.to(campaignRoom(cid)).emit('quest:update', { quests, act: manifest?.act ?? 1 });

    for (const noteText of result.notes ?? []) {
      try {
        const payload = { text: noteText, authorName: 'Virtual DM', timestamp: Date.now() };
        await appendNote(cid, payload);
        io.to(campaignRoom(cid)).emit('note:added', payload);
      } catch (err) { logError('session:endSession:note', err); }
    }
  });
}

async function buildEntitySummaries(campaignId: string): Promise<string> {
  const lines: string[] = [];

  // World bible — generated campaigns; absent for modules, that's fine
  for (const filename of ['world.md', 'factions.md']) {
    try {
      const content = await getTextStore().get(path.join(CAMPAIGNS_DIR, campaignId, filename));
      if (content !== null) lines.push(`### ${filename}\n${content.slice(0, 1000)}`);
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
  return (await getTextStore().list(sessionsDir)).length === 0;
}

export async function runRecap(campaignId: string): Promise<{ text: string; isFirstSession: boolean }> {
  const sessionsDir = path.join(CAMPAIGNS_DIR, campaignId, 'sessions');
  const firstSession = await isFirstSession(campaignId);

  let lastSessionText: string | null = null;
  if (!firstSession) {
    const files = (await getTextStore().list(sessionsDir)).sort();
    const last = files[files.length - 1];
    if (last) {
      try {
        const raw = await getTextStore().get(path.join(sessionsDir, last));
        const msgs = raw === null ? [] : (JSON.parse(raw) as Array<{ senderName: string; text: string }>);
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
    // Skip arenas: they live in the same dungeons/ store, and a transient combat map is never what
    // a dungeon-crawl recap is about.
    const dungeon = dungeonsIn(campaignId).find(d => !d.arena) ?? (await loadDungeons(campaignId)).find(d => !d.arena);
    const dungeonQuests = dungeon ? (await readQuests(campaignId)).filter(q => q.sourceDungeonId === dungeon.id) : [];
    const groundTruth = dungeon ? describeDungeonGroundTruth(dungeon, {}) : '(no dungeon generated yet)';
    const text = await provider.complete(buildDungeonRecapPrompt({
      dungeonName: dungeon?.name ?? meta.name ?? 'the dungeon',
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

function normalizeSentence(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Backstop for the "never restate a dressing/scene detail" prompt instruction — that's an
// instruction, not a guarantee. Strips a sentence from the new response if it's a close word-set
// match (Jaccard > 0.6) for a sentence the DM already said in its last few turns. Falls back to
// the untouched response if stripping would empty it out — an occasional repeat beats a blank turn.
export function stripRepeatedSentences(newText: string, recentDmText: string): string {
  const recentSets = recentDmText
    .split(/(?<=[.!?])\s+/)
    .map(s => normalizeSentence(s))
    .filter(s => s.split(/\s+/).length >= 4)
    .map(s => new Set(s.split(/\s+/)));
  if (!recentSets.length) return newText;

  const sentences = newText.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(sentence => {
    const norm = normalizeSentence(sentence);
    const words = norm.split(/\s+/).filter(Boolean);
    if (words.length < 4) return true; // too short to judge meaningfully — keep
    const wordSet = new Set(words);
    return !recentSets.some(rs => jaccard(wordSet, rs) > 0.6);
  });

  const result = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return result.length ? result : newText;
}

const CHECK_ASK_RE = /\b(check|roll)\b/i;

// A player who names a skill and asks to check/roll it should always get a [[REQUEST_CHECK]]
// button — but that's a prompt instruction, not a guarantee, and it's been observed skipped
// (a player asked to "insight check" someone and got narrated tells with no roll offered).
// Backstop: if the DM's own tags produced no check/save request for this player this turn,
// and their triggering message names a skill alongside check/roll wording, synthesize the
// request directly. No second LLM pass needed — a CheckRequest is just {player, skill, type},
// nothing here requires anything an LLM would need to invent.
export function detectMissedSkillCheck(recentLog: ChatPayload[], existing: CheckRequest[]): CheckRequest | undefined {
  const last = [...recentLog].reverse().find(m =>
    m.senderName !== 'System' && m.senderName !== 'Combat' && m.senderName !== 'Virtual DM' && !m.senderName.endsWith('(Virtual DM)')
  );
  if (!last || !CHECK_ASK_RE.test(last.text)) return undefined;

  const lower = last.text.toLowerCase();
  const skill = Object.keys(SKILL_ABILITY).find(s => new RegExp(`\\b${s.toLowerCase().replace(/ /g, '\\s+')}\\b`, 'i').test(lower));
  if (!skill || existing.some(c => c.player === last.senderName && c.skill === skill)) return undefined;

  return { player: last.senderName, skill, type: 'check' };
}

/** `audience` — who the DM is answering (see ChatAudience): while the party is split, only their
 * track(s) see the reply, and the DM only sees the chat those tracks saw. */
export function dispatchDMResponse(cid: string, audience: ChatAudience, combatEndedNear?: { gx: number; gy: number }[]): void {
  if (!sessionState.get(cid)) return;
  void audienceTracks(cid, audience).then(async tracks => dispatchToTracks(cid, audience, tracks, await toTracks(cid, tracks), combatEndedNear));
}

function dispatchToTracks(cid: string, audience: ChatAudience, tracks: GroupColor[] | null, to: Audience, combatEndedNear?: { gx: number; gy: number }[]): void {
  to.emit('dm:thinking', true);
  queueDMResponse(tracks ? `${cid}:${[...tracks].sort().join(',')}` : cid, async () => {
    try {
      // Only this audience's own group — a split group's narrator mustn't treat the others' tokens
      // as "the party", and it only ever describes the map its own group is standing on.
      const groups = await getPartyGroups(cid);
      const ourPlayers = [...connected].filter(name => !tracks || tracks.includes(trackOf(groups, name)));
      const dungeon = ourPlayers.map(name => dungeonOf(cid, name)).find(d => !!d);
      const playerPositions = Object.fromEntries(
        Object.entries(dungeon?.positions ?? {}).filter(([name]) => ourPlayers.includes(name))
      );
      // Anything inside a dungeon → the closed-world dungeon narrator, combat or not. Exploration
      // gets the full floor plan so spatial questions can be answered accurately; combat gets the
      // lighter discovered-only view, since between-turn narration has no spatial reasoning to do
      // and the mechanical combat log already carries the blow-by-blow. Only genuinely open-world
      // play still reaches the general narrator.
      // This audience's own fight, not "is anyone in the campaign fighting" — another group's battle elsewhere doesn't make this an in-combat narration.
      const audienceFights = audience === 'all' ? [] : [...new Set(audience.map(k => fightOf(cid, k)).filter(f => !!f))];
      const combatActive = audienceFights.length > 0;
      let groundTruth = dungeon
        ? (combatActive ? describeDungeonState(dungeon, playerPositions) : describeDungeonGroundTruth(dungeon, playerPositions))
        : undefined;
      // Victory dispatch only: anchor the aftermath to where the fight actually happened (the
      // defeated creatures' own positions), not just the player's token — a ranged/aggro fight
      // can end with the player still standing well outside the room the kill happened in.
      if (dungeon && combatEndedNear?.length) {
        groundTruth = `${groundTruth}\n${describeCombatLocation(dungeon, combatEndedNear)}`;
      }
      if (dungeon) console.log(`[dm] dispatch cid=${cid} combatActive=${combatActive} positions=${JSON.stringify(playerPositions)} combatEndedNear=${JSON.stringify(combatEndedNear ?? [])}`);
      const response = dungeon
        ? await getDungeonNarrationResponse(cid, dungeon, groundTruth!, combatActive, audience)
        : await getDMResponse(cid, audience);
      if (!response) return;

      if (response.includes('[COMBAT END]')) {
        for (const fight of audienceFights) {
          const fightAudience = toFight(fight);
          void endCombat(cid, fight);
          fightAudience.emit('combat:state', false);
        }
      }

      const rawResponse = response.replace(/\[COMBAT END\]/g, '').trim();
      const config = await getConfig();
      const { text: taggedCleanResponse, effects, speakingAs, checkRequests } = hasFeatureProvider(config, 'tagEffectProcessing')
        ? await processVdmResponse(rawResponse, getFeatureProvider(config, 'tagEffectProcessing'))
        : { text: rawResponse, effects: [], speakingAs: undefined, checkRequests: [] };

      const recentLog = await readChatContext(cid, audience);
      const recentDmText = recentLog.slice(-12).filter(m => m.senderName === 'Virtual DM' || m.senderName.endsWith('(Virtual DM)')).map(m => m.text).join(' ');
      const cleanResponse = stripRepeatedSentences(taggedCleanResponse, recentDmText);

      await applyEffects(cid, effects, audience);

      // The prompt makes the PICKED_UP_* tag mandatory alongside pickup narration, but that's an
      // instruction, not a guarantee. When narration reads like a pickup and no tag fired, run a
      // second, narrow extraction pass on the flagged text and apply whatever it finds — a repair,
      // not just a log, so a skipped tag doesn't silently leave the item out of inventory.
      if (!effects.some(e => e.type === 'inventory_add') && /\b(you (take|pick up|pocket|grab)|picks? up (a|an|the|some)|stashes? (it|them|the) (in|into)|slips? (it|them) into (your|his|her|their) (pack|pocket|bag))\b/i.test(cleanResponse)) {
        console.warn(`[dm] cid=${cid} narration reads like an item pickup but no PICKED_UP_* tag was emitted — attempting repair: "${cleanResponse.slice(0, 200)}"`);
        if (hasFeatureProvider(config, 'tagEffectProcessing')) {
          void repairMissedPickup(cleanResponse, getFeatureProvider(config, 'tagEffectProcessing')).then(repaired => {
            if (repaired) void applyEffects(cid, [repaired], audience);
          });
        }
      }

      const missedCheck = detectMissedSkillCheck(recentLog, checkRequests);
      const finalCheckRequests = missedCheck ? [...checkRequests, missedCheck] : checkRequests;
      if (missedCheck) console.warn(`[dm] cid=${cid} ${missedCheck.player} asked for a ${missedCheck.skill} check but no REQUEST_CHECK tag was emitted — synthesizing one`);

      const senderName = speakingAs ? `${speakingAs} (Virtual DM)` : 'Virtual DM';
      const tags = await tagForSplit(cid, tracks);
      await appendChatLog(cid, { text: cleanResponse, senderName, timestamp: Date.now(), ...tags });
      to.emit('session:recap', { text: cleanResponse, senderName, checkRequests: finalCheckRequests, ...tags });
    } catch (err) {
      logError('index:dmResponse', err);
      to.emit('chat:message', { text: `[DM error: ${(err as Error).message}]`, senderName: 'System', timestamp: Date.now() });
    } finally {
      to.emit('dm:thinking', false);
    }
  });
}
