import path from 'path';
import {
  readChatLog, listEntitySlugs, readEntity, writeEntity, archiveChatLog,
  getCharacter, getWorldMeta, writeWorldMeta, CAMPAIGNS_DIR, readManifest, writeManifest,
  readQuests, writeQuests, readCampaignFile,
  readPlotHooks, readPlotArcs, writePlotArcs, markPlotHookUsed,
} from '../storage.ts';
import { getTextStore } from '../storage/index.ts';
import { getConfig } from '../storage.ts';
import { getFeatureProvider, type ChatMessage } from '../providers/index.ts';
import { buildTriagePrompt, buildResolvePrompt, buildDMSystemPrompt, buildDungeonNarrationPrompt, buildDmBriefPrompt, buildSessionQuestsPrompt, buildPlotHookCandidatePrompt, buildDungeonQuestPrompt, buildStoryTagsPrompt, buildSessionNotesPrompt, type EntityType } from './prompts.ts';
import { PLOT_HOOK_TAGS } from 'shared';
import type { AppConfig, ChatPayload, Character, CurrencyDenomination, Dungeon, Quest, PlotHook, ActivePlotArc, PlotHookTag } from 'shared';
import { logError } from '../logger.ts';

const ENTITY_TYPES: EntityType[] = ['npc', 'faction', 'location', 'character', 'nemesis'];

// ── YAML parsing ─────────────────────────────────────────────────────────────
// ponytail: hand-rolled parser for the simple list-of-objects shape the AI returns

interface TriageEntity { slug: string; type: EntityType; reason: string }

function parseTriageYaml(raw: string): { touched: TriageEntity[]; new: TriageEntity[] } {
  const result: { touched: TriageEntity[]; new: TriageEntity[] } = { touched: [], new: [] };
  let current: TriageEntity[] | null = null;
  let item: Partial<TriageEntity> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'touched:') { current = result.touched; continue; }
    if (trimmed === 'new:') { current = result.new; continue; }
    if (!current) continue;
    if (trimmed.startsWith('- slug:')) {
      if (item.slug) current.push(item as TriageEntity);
      item = { slug: trimmed.replace('- slug:', '').trim() };
    } else if (trimmed.startsWith('type:')) {
      item.type = trimmed.replace('type:', '').trim() as EntityType;
    } else if (trimmed.startsWith('reason:')) {
      item.reason = trimmed.replace('reason:', '').trim().replace(/^"|"$/g, '');
    }
  }
  if (item.slug && current) current.push(item as TriageEntity);
  return result;
}

function parseSessionNotesYaml(raw: string): string[] {
  const notes: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;
    const text = trimmed.slice(2).trim().replace(/^"|"$/g, '');
    if (text) notes.push(text);
  }
  return notes;
}

function parseCascadeYaml(raw: string): TriageEntity[] {
  const items: TriageEntity[] = [];
  let item: Partial<TriageEntity> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'cascade: []' || trimmed === 'cascade:') continue;
    if (trimmed.startsWith('- slug:')) {
      if (item.slug) items.push(item as TriageEntity);
      item = { slug: trimmed.replace('- slug:', '').trim() };
    } else if (trimmed.startsWith('type:')) {
      item.type = trimmed.replace('type:', '').trim() as EntityType;
    } else if (trimmed.startsWith('reason:')) {
      item.reason = trimmed.replace('reason:', '').trim().replace(/^"|"$/g, '');
    }
  }
  if (item.slug) items.push(item as TriageEntity);
  return items;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function getPartyCharacters(campaignSlug: string): Promise<Character[]> {
  const partyPath = path.join(CAMPAIGNS_DIR, campaignSlug, 'party');
  const ids = await getTextStore().list(partyPath);
  const chars = await Promise.all(ids.map(id => getCharacter(campaignSlug, id)));
  return chars.filter((c): c is Character => c !== null);
}

async function getCharacterNames(campaignSlug: string): Promise<string[]> {
  return (await getPartyCharacters(campaignSlug)).map(c => c.name);
}

const CURRENCY_DENOMS: CurrencyDenomination[] = ['platinum', 'gold', 'electrum', 'silver', 'bronze'];

// So MANAGER MODE ("what's in my inventory") answers from what the character actually has,
// not whatever the model improvises — the prompt used to receive only bare names.
function formatCharacterSummary(char: Character): string {
  const items = (char.inventory ?? []).map(i => i.quantity && i.quantity > 1 ? `${i.name} (x${i.quantity})` : i.name);
  const coins = CURRENCY_DENOMS
    .map(d => [d, char[d] ?? 0] as const)
    .filter(([, amount]) => amount > 0)
    .map(([d, amount]) => `${amount} ${d}`);
  return `- ${char.name}: inventory — ${items.length ? items.join(', ') : 'nothing'}; currency — ${coins.length ? coins.join(', ') : 'none'}`;
}

async function getCharacterSummaries(campaignSlug: string): Promise<string> {
  const chars = await getPartyCharacters(campaignSlug);
  return chars.length ? chars.map(formatCharacterSummary).join('\n') : '(no party members yet)';
}

function excerpts(log: ChatPayload[], entitySlug: string): string {
  const term = entitySlug.replace(/-/g, ' ').toLowerCase();
  const relevant = log.filter(m =>
    m.text.toLowerCase().includes(term) ||
    m.senderName.toLowerCase().includes(term),
  );
  return relevant
    .map(m => `[${m.senderName}]: ${m.text}`)
    .join('\n') || '';
}

async function resolveEntity(
  campaignSlug: string,
  type: EntityType,
  slug: string,
  log: ChatPayload[],
  characters: string[],
  today: string,
  provider: { complete: (p: string) => Promise<string> },
): Promise<{ cascade: TriageEntity[] }> {
  const current = await readEntity(campaignSlug, type, slug);
  const chatExcerpts = excerpts(log, slug);
  const prompt = buildResolvePrompt(type, slug, current, chatExcerpts, characters, today);
  const response = await provider.complete(prompt);

  const [fileContent, cascadeSection] = response.split('===CASCADE===');
  if (fileContent?.trim()) {
    const clean = fileContent.trim()
      .replace(/^```(?:yaml|markdown|md)?\n?/i, '')
      .replace(/\n?```\s*$/, '');
    await writeEntity(campaignSlug, type, slug, clean);
  }
  const cascade = cascadeSection ? parseCascadeYaml(cascadeSection) : [];
  return { cascade };
}

async function readWorldFile(campaignSlug: string, filename: string): Promise<string | null> {
  try {
    return await getTextStore().get(path.join(CAMPAIGNS_DIR, campaignSlug, filename));
  } catch (err) {
    logError('session-processor/index:readWorldFile', err);
    return null;
  }
}

async function buildEntitySummaries(campaignSlug: string): Promise<string> {
  const lines: string[] = [];

  // World bible — generated campaigns use world.md/factions.md; modules use dm-brief.md
  for (const filename of ['world.md', 'factions.md', 'dm-brief.md']) {
    const content = await readWorldFile(campaignSlug, filename);
    const cap = filename === 'dm-brief.md' ? 4000 : 1000;
    if (content) lines.push(`### ${filename}\n${content.slice(0, cap)}`);
  }

  // Characters — always load (the active party)
  const charSlugs = await listEntitySlugs(campaignSlug, 'character');
  for (const slug of charSlugs) {
    const content = await readEntity(campaignSlug, 'character', slug);
    if (content) lines.push(`### character/${slug}\n${content.slice(0, 500)}`);
  }

  // Quests — pending shown as story beats to trigger, active shown as ongoing goals
  const quests = await readQuests(campaignSlug);
  const pendingQuests = quests.filter(q => q.status === 'undiscovered').slice(0, 3);
  const activeQuests = quests.filter(q => q.status === 'open');
  if (pendingQuests.length) {
    const section = pendingQuests.map(q => `- ${q.id}: ${q.name} — ${q.description}`).join('\n');
    lines.push(`### Undiscovered quests (steer the player toward these — do not wait for them to ask)\n${section}`);
  }
  if (activeQuests.length) {
    const section = activeQuests.map(q => {
      const log = q.log.length ? `\n  - ${q.log.map(e => `${e.date}: ${e.text}`).join('\n  - ')}` : '';
      return `- ${q.id}: ${q.name} — ${q.description}${log}`;
    }).join('\n');
    lines.push(`### Open quests (player is tracking these — push toward resolution)\n${section}`);
  }

  const manifest = await readManifest(campaignSlug);
  if (!manifest) return lines.join('\n\n') || '(no entity notes yet)';

  const totalSecs = manifest.worldTimeSecs ?? 43200;
  const day = Math.floor(totalSecs / 86400) + 1;
  const h = Math.floor((totalSecs % 86400) / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  lines.push(`### World Time\nDay ${day}, ${h12}:${String(m).padStart(2, '0')} ${period}`);

  if (!manifest.currentLocation) {
    // Cold start — no scene established yet. Build a compact world index so the DM
    // knows the geography and can place the players correctly from turn one.
    const locationSlugs = await listEntitySlugs(campaignSlug, 'location');
    const npcSlugs = await listEntitySlugs(campaignSlug, 'npc');
    const factionSlugs = await listEntitySlugs(campaignSlug, 'faction');
    const toName = (slug: string) => slug.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ');
    if (locationSlugs.length) lines.push(`### World Locations\n${locationSlugs.map(toName).join('\n')}`);
    if (npcSlugs.length) lines.push(`### Key NPCs\n${npcSlugs.map(toName).join('\n')}`);
    if (factionSlugs.length) lines.push(`### Factions\n${factionSlugs.map(toName).join('\n')}`);
    return lines.join('\n\n') || '(no entity notes yet)';
  }

  // Current location — full content (scene text + DM notes)
  const locContent = await readEntity(campaignSlug, 'location', manifest.currentLocation);
  if (locContent) lines.push(`### location/${manifest.currentLocation} [CURRENT]\n${locContent}`);

  // NPCs and factions in current scene
  for (const slug of manifest.npcs) {
    const content = await readEntity(campaignSlug, 'npc', slug);
    if (content) lines.push(`### npc/${slug}\n${content.slice(0, 800)}`);
  }
  for (const slug of manifest.factions) {
    const content = await readEntity(campaignSlug, 'faction', slug);
    if (content) lines.push(`### faction/${slug}\n${content.slice(0, 600)}`);
  }

  // Adjacent zones — names only so DM can narrate transitions
  if (manifest.connectedZones.length) {
    lines.push(`### Connected zones\n${manifest.connectedZones.join(', ')}`);
  }

  return lines.join('\n\n') || '(no entity notes yet)';
}

// ── DM brief generation ───────────────────────────────────────────────────────

export interface DmBriefResult {
  startingLocationSlug: string;
  dmBrief: string;
  initialQuests?: Array<{ id: string; name: string; description: string }>;
  acts?: Array<{ act: number; conditions: string[] }>;
}

export async function generateDmBrief(
  moduleName: string,
  locationSlugs: string[],
  npcSlugs: string[],
  factionSlugs: string[],
): Promise<DmBriefResult> {
  const config = await getConfig();
  const provider = getFeatureProvider(config, 'dmBrief');
  const prompt = buildDmBriefPrompt(moduleName, locationSlugs, npcSlugs, factionSlugs);
  const raw = await provider.complete(prompt);
  console.log('[dm-brief] raw response:\n', raw);
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
  const parsed = JSON.parse(cleaned) as DmBriefResult;
  // Guard: ensure the slug is actually in the provided list
  if (!locationSlugs.includes(parsed.startingLocationSlug)) {
    parsed.startingLocationSlug = locationSlugs[0] ?? '';
  }
  return parsed;
}

// ── Session quest generation ──────────────────────────────────────────────────

// Grounds a winning plot arc's invented cast as real entity files from the moment it starts,
// instead of leaving them as names that only exist inside quest description text — mirrors
// routes/campaigns.ts's syncCharacterToWorldLore (same "skip anything that collides with an
// existing slug" rule: a same-named entity is almost certainly the established one, and this
// pass must never clobber hand-authored lore).
async function seedPlotArcEntities(
  campaignSlug: string, arcTitle: string, entities: Array<{ name: string; type: 'npc' | 'faction' | 'location'; description: string }>,
): Promise<void> {
  const toEntitySlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await Promise.all(entities.filter(e => e.name?.trim()).map(async e => {
    const slug = toEntitySlug(e.name);
    const existingSlugs = await listEntitySlugs(campaignSlug, e.type);
    if (existingSlugs.includes(slug)) return;
    const heading = e.type === 'location' ? '## Scene Notes' : '## Observed';
    const content = `# ${e.name}\n\n${e.description}\n\n${heading}\n- Introduced by the "${arcTitle}" storyline.\n`;
    await writeEntity(campaignSlug, e.type, slug, content);
  }));
}

const UNDISCOVERED_THRESHOLD = 2;

// Deterministic pre-filter — the only judgment call left to the LLM is Task 3 in
// buildPlotHookCandidatePrompt (does this one fit well enough to beat an invented alternative).
// Empty storyTags means "not yet known" (see WorldMeta.storyTags), not "nothing fits" — every
// not-yet-used hook stays eligible until play has actually proven a theme, at which point overlap
// starts breaking ties toward what this campaign has shown itself to be about.
function pickEligiblePlotHook(hooks: PlotHook[], campaignSlug: string, storyTags: string[]): PlotHook | undefined {
  const eligible = hooks.filter(h =>
    !h.usedIn.some(u => u.campaignId === campaignSlug) &&
    (storyTags.length === 0 || h.tags.some(t => storyTags.includes(t))),
  );
  if (!eligible.length) return undefined;
  return eligible
    .map(h => ({ hook: h, overlap: h.tags.filter(t => storyTags.includes(t)).length }))
    .sort((a, b) => b.overlap - a.overlap)[0]!.hook;
}

export async function ensureSessionQuests(campaignSlug: string): Promise<void> {
  // Dungeon-crawl worlds are closed-world: quests come only from the dungeon's own seeded goals
  // (generateDungeonQuests), never invented mid-session. A campaign-wide invented quest here would be
  // untagged (no sourceDungeonId), so the dungeon narrator would never surface it — permanently
  // orphaned since there's no open-world narration path left to discover it through either.
  const meta = await getWorldMeta(campaignSlug);
  if (meta?.type === 'dungeon-crawl') return;

  const quests = await readQuests(campaignSlug);
  const undiscovered = quests.filter(q => q.status === 'undiscovered');
  if (undiscovered.length >= UNDISCOVERED_THRESHOLD) return;

  try {
    const [manifest, actsRaw] = await Promise.all([
      readManifest(campaignSlug),
      readCampaignFile(campaignSlug, 'acts.json'),
    ]);

    const acts = actsRaw ? JSON.parse(actsRaw) as Array<{ act: number; conditions: string[] }> : [];
    const currentAct = manifest?.act ?? 1;
    const actConditions = acts.find(a => a.act === currentAct)?.conditions ?? [];

    const existingIds = quests.map(q => q.id);
    const openNames = quests.filter(q => q.status === 'open').map(q => q.name);
    const resolvedNames = quests.filter(q => q.status === 'resolved').map(q => q.name);

    const config = await getConfig();
    const provider = getFeatureProvider(config, 'questGeneration');
    const today = new Date().toISOString().slice(0, 10);

    // Pool contributes at most one quest per call — the rest of `needed` (if any) still comes from
    // plain invention below, same as before this feature existed.
    let remainingNeeded = UNDISCOVERED_THRESHOLD - undiscovered.length;
    const newQuests: Quest[] = [];

    const pool = await readPlotHooks();
    const chosenHook = pickEligiblePlotHook(pool, campaignSlug, meta?.storyTags ?? []);
    if (chosenHook) {
      const entitySummaries = await buildEntitySummaries(campaignSlug);
      const candidatePrompt = buildPlotHookCandidatePrompt({
        campaignName: meta?.name ?? campaignSlug,
        entitySummaries,
        currentAct,
        actConditions,
        existingIds,
        openQuestNames: openNames,
        resolvedQuestNames: resolvedNames,
        currentLocation: manifest?.currentLocation ?? null,
        poolHook: { title: chosenHook.title, structuralRequirements: chosenHook.structuralRequirements, beats: chosenHook.beats },
      });

      const raw = await provider.complete(candidatePrompt);
      console.log('[session-quests] plot-hook candidate raw response:\n', raw);
      const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
      const parsed = JSON.parse(cleaned) as {
        poolCandidate: {
          score: number;
          beats: Array<{ order: number; id: string; name: string; description: string }>;
          entities?: Array<{ name: string; type: 'npc' | 'faction' | 'location'; description: string }>;
        };
        inventedCandidate: { score: number; id: string; name: string; description: string };
      };

      const poolWins = parsed.poolCandidate.score > parsed.inventedCandidate.score
        && parsed.poolCandidate.beats.length === chosenHook.beats.length;

      if (poolWins) {
        const arcBeats = parsed.poolCandidate.beats
          .slice().sort((a, b) => a.order - b.order)
          .map(b => ({ order: b.order, questId: b.id, name: b.name, description: b.description }));
        const first = arcBeats[0]!;
        newQuests.push({ id: first.questId, name: first.name, description: first.description, status: 'undiscovered', log: [], addedAt: today });

        const arc: ActivePlotArc = { plotHookId: chosenHook.id, beats: arcBeats, currentBeatIndex: 0, startedAt: new Date().toISOString() };
        await writePlotArcs(campaignSlug, [...await readPlotArcs(campaignSlug), arc]);
        await markPlotHookUsed(chosenHook.id, campaignSlug);
        await seedPlotArcEntities(campaignSlug, chosenHook.title, parsed.poolCandidate.entities ?? []);
        console.log(`[session-quests] plot hook "${chosenHook.title}" selected (score ${parsed.poolCandidate.score} vs invented ${parsed.inventedCandidate.score}) — started arc with ${arcBeats.length} beat(s)`);
      } else {
        const c = parsed.inventedCandidate;
        newQuests.push({ id: c.id, name: c.name, description: c.description, status: 'undiscovered', log: [], addedAt: today });
      }
      remainingNeeded -= 1;
    }

    if (remainingNeeded > 0) {
      const prompt = buildSessionQuestsPrompt({
        campaignName: meta?.name ?? campaignSlug,
        currentAct,
        actConditions,
        existingIds: [...existingIds, ...newQuests.map(q => q.id)],
        openQuestNames: openNames,
        resolvedQuestNames: resolvedNames,
        currentLocation: manifest?.currentLocation ?? null,
        needed: remainingNeeded,
      });

      const raw = await provider.complete(prompt);
      console.log('[session-quests] raw response:\n', raw);
      const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
      const generated = JSON.parse(cleaned) as Array<{ id: string; name: string; description: string }>;
      const knownIds = new Set([...existingIds, ...newQuests.map(q => q.id)]);
      for (const q of generated) {
        if (q.id && q.name && !knownIds.has(q.id)) {
          newQuests.push({ id: q.id, name: q.name, description: q.description, status: 'undiscovered', log: [], addedAt: today });
          knownIds.add(q.id);
        }
      }
    }

    if (newQuests.length) {
      await writeQuests(campaignSlug, [...quests, ...newQuests]);
      console.log(`[session-quests] added ${newQuests.length} undiscovered quest(s): ${newQuests.map(q => q.id).join(', ')}`);
    }
  } catch (err) {
    logError('session-processor/index:ensureSessionQuests', err);
  }
}

// Generated BEFORE the dungeon itself (see effects.ts's dungeon_gen handler) — dungeonId is
// already decided by the caller and stamped onto every quest returned here, so unlike
// ensureSessionQuests these are never orphaned: they're scoped to this dungeon's closed-world
// narration from the moment they exist, whether or not the dungeon has finished generating yet.
export async function generateDungeonQuests(
  cid: string, dungeonId: string, name: string, dungeonType: string, storyContext: string, config: AppConfig,
): Promise<Quest[]> {
  try {
    const existingIds = (await readQuests(cid)).map(q => q.id);
    const provider = getFeatureProvider(config, 'questGeneration');
    const prompt = buildDungeonQuestPrompt({ locationName: name, dungeonType, storyContext, existingIds });
    const raw = await provider.complete(prompt);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
    const generated = JSON.parse(cleaned) as Array<{ id: string; name: string; description: string }>;

    const today = new Date().toISOString().slice(0, 10);
    return generated
      .filter(q => q.id && q.name && !existingIds.includes(q.id))
      .map(q => ({ id: q.id, name: q.name, description: q.description, status: 'open' as const, log: [], addedAt: today, sourceDungeonId: dungeonId }));
  } catch (err) {
    logError('session-processor/index:generateDungeonQuests', err);
    return [];
  }
}

// ── DM chat response ──────────────────────────────────────────────────────────

const DM_SENDER = 'Virtual DM';
const HISTORY_LIMIT = 20;

// Build alternating user/assistant turns from the recent chat log
// Player messages → user role; DM messages → assistant role; System (rolls) → user role labelled as roll
function buildChatMessages(log: ChatPayload[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const msg of log.slice(-HISTORY_LIMIT)) {
    const isRoll = msg.senderName === 'System';
    const role = msg.senderName === DM_SENDER ? 'assistant' : 'user';
    const content = isRoll
      ? `[Roll Result]: ${msg.text}`
      : role === 'user' ? `[${msg.senderName}]: ${msg.text}` : msg.text;
    // Merge consecutive same-role messages (can happen if multiple players speak before DM responds)
    const last = messages[messages.length - 1];
    if (last?.role === role) {
      last.content += `\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }

  // Ensure we end on a user message (the AI can't respond to itself)
  while (messages.length > 0 && messages[messages.length - 1]?.role === 'assistant') {
    messages.pop();
  }
  return messages;
}

// Open-world narration only — anything inside a dungeon goes through
// getDungeonNarrationResponse instead.
export async function getDMResponse(campaignSlug: string): Promise<string> {
  const [config, meta, log] = await Promise.all([
    getConfig(),
    getWorldMeta(campaignSlug),
    readChatLog(campaignSlug),
  ]);

  const entitySummaries = await buildEntitySummaries(campaignSlug);
  const characterSummaries = await getCharacterSummaries(campaignSlug);

  const messages = buildChatMessages(log);
  if (messages.length === 0) return '';

  const worldType = (meta?.type === 'module' ? 'campaign' : meta?.type) ?? 'campaign';
  const system = buildDMSystemPrompt(
    meta?.name ?? 'Unknown World',
    worldType,
    entitySummaries,
    characterSummaries,
    meta?.tags ?? [],
  );

  const provider = getFeatureProvider(config, 'dmChatResponse');
  return provider.chat(system, messages);
}

// Dungeon narration, closed-world — the single entry point for anything happening inside a
// dungeon, combat or not (combatActive covers both). Deliberately does NOT call buildEntitySummaries — no world.md,
// factions.md, dm-brief.md, or campaign-wide quests reach this pathway, only what's seeded on the
// dungeon itself (goals) and quests actually sourced from it (sourceDungeonId match).
export async function getDungeonNarrationResponse(
  campaignSlug: string,
  dungeon: Dungeon,
  groundTruth: string,
  combatActive: boolean,
): Promise<string> {
  const [config, quests, log, characterNames, characterSummaries] = await Promise.all([
    getConfig(),
    readQuests(campaignSlug),
    readChatLog(campaignSlug),
    getCharacterNames(campaignSlug),
    getCharacterSummaries(campaignSlug),
  ]);

  const messages = buildChatMessages(log);
  if (messages.length === 0) return '';

  const dungeonQuests = quests.filter(q => q.sourceDungeonId === dungeon.id);
  const system = buildDungeonNarrationPrompt({
    dungeonName: dungeon.name,
    dungeonQuests,
    characterNames,
    characterSummaries,
    groundTruth,
    combatActive,
  });

  const provider = getFeatureProvider(config, 'dmChatResponse');
  return provider.chat(system, messages);
}

// ── main export ───────────────────────────────────────────────────────────────

export interface ProcessResult {
  skipped?: boolean;
  updated: string[];
  created: string[];
  cascaded: string[];
  notes: string[];
}

export async function processSession(campaignSlug: string): Promise<ProcessResult> {
  const log = await readChatLog(campaignSlug);
  if (log.length === 0) return { skipped: true, updated: [], created: [], cascaded: [], notes: [] };

  const config = await getConfig();
  const provider = getFeatureProvider(config, 'sessionTriage');
  const today = new Date().toISOString().slice(0, 10);
  const characters = await getCharacterNames(campaignSlug);

  // Build existing entity map for triage
  const existingEntities: Record<EntityType, string[]> = { npc: [], faction: [], location: [], character: [], nemesis: [] };
  for (const type of ENTITY_TYPES) {
    existingEntities[type] = await listEntitySlugs(campaignSlug, type);
  }

  // Pass 1 — triage
  const chatLogText = log.map(m => `[${m.senderName}]: ${m.text}`).join('\n');
  const triageRaw = await provider.complete(buildTriagePrompt(chatLogText, existingEntities));
  const triage = parseTriageYaml(triageRaw);

  const existingSlugs = new Set(
    ENTITY_TYPES.flatMap(t => existingEntities[t].map(s => `${t}:${s}`)),
  );
  const updated: string[] = [];
  const created: string[] = [];
  const cascadeQueue: TriageEntity[] = [];
  const processed = new Set<string>();

  // Pass 2 — resolve touched + new entities
  const toResolve = [...triage.touched, ...triage.new];
  for (const entity of toResolve) {
    if (!ENTITY_TYPES.includes(entity.type)) continue;
    const key = `${entity.type}:${entity.slug}`;
    if (processed.has(key)) continue;
    processed.add(key);

    const { cascade } = await resolveEntity(campaignSlug, entity.type, entity.slug, log, characters, today, provider);
    (existingSlugs.has(key) ? updated : created).push(`${entity.type}/${entity.slug}`);
    cascadeQueue.push(...cascade);
  }

  // Pass 3 — cascade (depth 1)
  const cascaded: string[] = [];
  for (const entity of cascadeQueue) {
    if (!ENTITY_TYPES.includes(entity.type)) continue;
    const key = `${entity.type}:${entity.slug}`;
    if (processed.has(key)) continue;
    processed.add(key);

    await resolveEntity(campaignSlug, entity.type, entity.slug, log, characters, today, provider);
    cascaded.push(`${entity.type}/${entity.slug}`);
  }

  await archiveChatLog(campaignSlug);

  // Act advancement check
  try {
    const [manifest, actsRaw] = await Promise.all([
      readManifest(campaignSlug),
      readCampaignFile(campaignSlug, 'acts.json'),
    ]);
    if (manifest && actsRaw) {
      const acts = JSON.parse(actsRaw) as Array<{ act: number; conditions: string[] }>;
      const currentActDef = acts.find(a => a.act === manifest.act);
      if (currentActDef?.conditions.length) {
        const conditionList = currentActDef.conditions.map((c, i) => `${i + 1}. ${c}`).join('\n');
        const checkPrompt = `You are tracking story progression for a TTRPG campaign.\n\nCurrent act: ${manifest.act}\nConditions to advance to act ${manifest.act + 1}:\n${conditionList}\n\nSession log:\n${chatLogText}\n\nBased on this session log, has at least one of the act ${manifest.act} completion conditions been clearly met? Be strict — partial progress does not count. Return ONLY valid JSON: {"advanceAct": true}  or {"advanceAct": false}`;
        const raw = await provider.complete(checkPrompt);
        const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
        const result = JSON.parse(cleaned) as { advanceAct: boolean };
        if (result.advanceAct) {
          manifest.act = manifest.act + 1;
          await writeManifest(campaignSlug, manifest);
          console.log(`[act] advanced to act ${manifest.act}`);
        }
      }
    }
  } catch (err) {
    logError('session-processor/index:actAdvancement', err);
  }

  // Story tag growth — see WorldMeta.storyTags: what this campaign's play has actually proven to be
  // about, used by ensureSessionQuests to filter the plot hook pool. Dungeon-crawl campaigns never
  // read storyTags at all (ensureSessionQuests hard-skips them), so classifying here would be pure
  // wasted cost with nothing downstream to use it.
  try {
    const meta = await getWorldMeta(campaignSlug);
    if (meta && meta.type !== 'dungeon-crawl') {
      const existingTags = meta.storyTags ?? [];
      const candidateTags = PLOT_HOOK_TAGS.filter(t => !existingTags.includes(t));
      if (candidateTags.length) {
        const raw = await provider.complete(buildStoryTagsPrompt(chatLogText, candidateTags));
        const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
        const result = JSON.parse(cleaned) as { tags: Array<{ tag: string; confidence: number; evidence: string }> };
        const earned = result.tags
          .filter(t => t.confidence >= 70 && (candidateTags as readonly string[]).includes(t.tag))
          .map(t => t.tag as PlotHookTag);
        if (earned.length) {
          await writeWorldMeta(campaignSlug, { ...meta, storyTags: [...existingTags, ...earned] });
          console.log(`[story-tags] +${earned.length} for ${campaignSlug}: ${earned.join(', ')}`);
        }
      }
    }
  } catch (err) {
    logError('session-processor/index:storyTags', err);
  }

  // VDM session notes — best-effort, never blocks session end if the LLM call fails.
  let notes: string[] = [];
  try {
    const notesRaw = await provider.complete(buildSessionNotesPrompt(chatLogText));
    notes = parseSessionNotesYaml(notesRaw);
  } catch (err) {
    logError('session-processor/index:sessionNotes', err);
  }

  return { updated, created, cascaded, notes };
}
