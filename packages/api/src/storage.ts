import path from 'path';
import { randomUUID } from 'crypto';
import type { AppConfig, Campaign, WorldMeta, Character, ChatPayload, NotePayload, BattleMap, WorldState, WorldActor, EnemyStatBlock, Dungeon, SessionManifest, Quest, NemesisRecord, CharacterStoryboard, ScenarioStoryboard, StoryboardTestRecord, HouseRules, PlotHook, ActivePlotArc, Goal, GenreTileMap, PartyGroups } from 'shared';
import { DEFAULT_HOUSE_RULES, slugifyTheme } from 'shared';
import { Encounter } from './domain/encounter.ts';
import { renderDungeonAscii } from './dungeon/index.ts';
import { logError } from './logger.ts';
import { getTextStore, getMediaStore, STORAGE_ROOT } from './storage/index.ts';

// Local-disk-only, install-level state (the license cache) that never becomes part of a campaign
// a player downloads/uploads — deliberately kept off the TextStore/MediaStore abstraction. See
// licenses/licenseFile.ts, the only other direct consumer of STORAGE_DIR.
export const STORAGE_DIR = STORAGE_ROOT;
const CONFIG_KEY = 'config.json';
const PLOT_HOOKS_KEY = 'plot-hooks.json';
const GENRE_TILE_MAP_KEY = 'genre-tile-map.json';

// Key prefixes for the TextStore/MediaStore abstraction below — same relative shape the old
// flat on-disk layout always used, now backend-agnostic (local disk, S3, or RDS depending on
// STORAGE_TEXT_BACKEND/STORAGE_MEDIA_BACKEND).
export const CAMPAIGNS_DIR = 'campaigns';
export const PREMADE_DIR   = 'premade';
export const TILESETS_DIR  = 'tilesets';
export const CREATURES_DIR = 'creatures';
export const PROPS_DIR      = 'props';
export const ICONS_DIR      = 'icons';
export const STORYBOARD_TEST_DIR = 'storyboard-test';

const NARRATIVE_FEATURES: AppConfig['workflows'][number]['features'] = [
  'campaignConcepts', 'dungeonPremise', 'dungeonScenarioSynopsis', 'backstoryGeneration', 'backstoryCheck', 'worldLoreSync', 'storyboardCaptions',
  'nemesisGeneration', 'dmBrief', 'questGeneration', 'dmChatResponse', 'sessionTriage', 'sessionRecap', 'tagEffectProcessing', 'plotHookNormalize',
];
const WORLD_AND_COMBAT_FEATURES: AppConfig['workflows'][number]['features'] = [
  'worldGeneration', 'dungeonGeneration', 'worldStateAdvance',
  'combatNarration', 'encounterGeneration', 'improvisedResolution',
  'compendium',
];

const DEFAULT_CONFIG: AppConfig = {
  workflows: [
    { id: 'default-story', name: 'Story & DM', enabled: true, models: [{ provider: 'claude', model: 'claude-sonnet-4-6' }], features: NARRATIVE_FEATURES },
    { id: 'default-combat', name: 'Combat & World', enabled: true, models: [{ provider: 'openai', model: 'gpt-4o-mini' }], features: WORLD_AND_COMBAT_FEATURES },
  ],
  apiKeys:  { openai: '', anthropic: '', deepseek: '', kimi: '', qwen: '' },
  image:    { model: 'gpt-image-1', generateWorldMap: false, generateTilesets: false, generateStoryboard: false, generateBestiaryPortraits: false, generatePropImages: false },
  narration: { model: 'none', voice: 'onyx' },
  adminPassword: '',
};

// Legacy config.json (pre-workflows) used `tiers`/`tasks` instead of `workflows`.
// Converts the old two-chain shape into the two equivalent default workflows above.
function migrateLegacyConfig(raw: Record<string, unknown>): AppConfig {
  const tiers = raw.tiers as { light: AppConfig['workflows'][number]['models']; thinking: AppConfig['workflows'][number]['models'] };
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    workflows: [
      { id: 'default-story', name: 'Story & DM', enabled: true, models: tiers.thinking, features: NARRATIVE_FEATURES },
      { id: 'default-combat', name: 'Combat & World', enabled: true, models: tiers.light, features: WORLD_AND_COMBAT_FEATURES },
    ],
  } as AppConfig;
}

export async function getConfig(): Promise<AppConfig> {
  try {
    const raw = await getTextStore().get(CONFIG_KEY);
    if (raw === null) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if ('tiers' in parsed && !('workflows' in parsed)) return migrateLegacyConfig(parsed);
    return { ...DEFAULT_CONFIG, ...parsed } as AppConfig;
  } catch (err) {
    logError('storage:getConfig', err);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await getTextStore().put(CONFIG_KEY, JSON.stringify(config, null, 2));
}

// Global pool, not per-campaign — same single-document shape as config.json above.
export async function readPlotHooks(): Promise<PlotHook[]> {
  try {
    const raw = await getTextStore().get(PLOT_HOOKS_KEY);
    return raw === null ? [] : (JSON.parse(raw) as PlotHook[]);
  } catch (err) {
    logError('storage:readPlotHooks', err);
    return [];
  }
}

export async function writePlotHooks(hooks: PlotHook[]): Promise<void> {
  await getTextStore().put(PLOT_HOOKS_KEY, JSON.stringify(hooks, null, 2));
}

// App-wide (not per-campaign), same single-document shape as plot hooks above — genre -> material
// category -> tilesetSlug of an already-generated tileset. See dungeon/tilesets.ts (write side,
// on every successful generation) and dungeon/manifest.ts (read side, narrows what's offered to
// the room-material LLM call to what's already available for this campaign's genre).
export async function readGenreTileMap(): Promise<GenreTileMap> {
  try {
    const raw = await getTextStore().get(GENRE_TILE_MAP_KEY);
    return raw === null ? {} : (JSON.parse(raw) as GenreTileMap);
  } catch (err) {
    logError('storage:readGenreTileMap', err);
    return {};
  }
}

export async function writeGenreTileMap(map: GenreTileMap): Promise<void> {
  await getTextStore().put(GENRE_TILE_MAP_KEY, JSON.stringify(map, null, 2));
}

export async function writeCampaignFile(slug: string, filename: string, content: string): Promise<void> {
  await getTextStore().put(path.join(campaignDir(slug), filename), content);
}

export async function getWorldMeta(slug: string): Promise<WorldMeta | null> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'world.json'));
    return raw === null ? null : (JSON.parse(raw) as WorldMeta);
  } catch (err) {
    logError('storage:getWorldMeta', err);
    return null;
  }
}

export async function writeWorldMeta(slug: string, meta: WorldMeta): Promise<void> {
  await writeCampaignFile(slug, 'world.json', JSON.stringify(meta, null, 2));
}

export async function getHouseRules(slug: string): Promise<HouseRules> {
  const meta = await getWorldMeta(slug);
  return meta?.houseRules ?? DEFAULT_HOUSE_RULES;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const names = await getTextStore().list(CAMPAIGNS_DIR);
  const results = await Promise.all(
    names.map(async name => {
      const meta = await getWorldMeta(name);
      if (!meta) return null; // skip entries without world.json (e.g. stray upload dirs)
      const campaign: Campaign = { id: name, name: meta.name, type: meta.type };
      if (meta.concept !== undefined) campaign.concept = meta.concept;
      if (meta.tags !== undefined) campaign.tags = meta.tags;
      if (meta.scenarioSynopsis !== undefined) campaign.scenarioSynopsis = meta.scenarioSynopsis;
      if (meta.partySize !== undefined) campaign.partySize = meta.partySize;
      return campaign;
    })
  );
  return results.filter((r): r is Campaign => r !== null);
}

export function campaignDir(slug: string): string {
  return path.join(CAMPAIGNS_DIR, slug);
}

export function partyDir(slug: string, charId: string): string {
  return path.join(CAMPAIGNS_DIR, slug, 'party', charId);
}

export async function writeCharacter(slug: string, charId: string, data: Character): Promise<void> {
  await getTextStore().put(path.join(partyDir(slug, charId), 'character.json'), JSON.stringify(data, null, 2));
}

export async function getCharacter(slug: string, charId: string): Promise<Character | null> {
  try {
    const raw = await getTextStore().get(path.join(partyDir(slug, charId), 'character.json'));
    return raw === null ? null : (JSON.parse(raw) as Character);
  } catch (err) {
    logError('storage:getCharacter', err);
    return null;
  }
}

// Concurrent tag effects / requests can each read-modify-write the same character.json;
// without serializing, the slower write silently clobbers the faster one's changes.
const characterLocks = new Map<string, Promise<unknown>>();

export async function updateCharacter(
  slug: string, charId: string, updater: (char: Character) => Character,
): Promise<Character | null> {
  const key = `${slug}/${charId}`;
  const run = (characterLocks.get(key) ?? Promise.resolve()).then(async () => {
    const char = await getCharacter(slug, charId);
    if (!char) return null;
    const updated = updater(char);
    await writeCharacter(slug, charId, updated);
    return updated;
  });
  characterLocks.set(key, run.catch(err => logError('storage:updateCharacter:lock', err)));
  return run;
}

export async function listCharacters(slug: string): Promise<Character[]> {
  const ids = await getTextStore().list(path.join(CAMPAIGNS_DIR, slug, 'party'));
  const chars = await Promise.all(ids.map(id => getCharacter(slug, id)));
  return chars.filter((c): c is Character => c !== null);
}

export async function findCharacterByPassword(slug: string, password: string): Promise<Character | null> {
  const ids = await getTextStore().list(path.join(CAMPAIGNS_DIR, slug, 'party'));
  for (const id of ids) {
    const char = await getCharacter(slug, id);
    if (char?.password === password) return char;
  }
  return null;
}

export async function readChatLog(slug: string): Promise<ChatPayload[]> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'chat.json'));
    return raw === null ? [] : (JSON.parse(raw) as ChatPayload[]);
  } catch (err) {
    logError('storage:readChatLog', err);
    return [];
  }
}

export async function appendChatLog(slug: string, message: ChatPayload): Promise<void> {
  const log = await readChatLog(slug);
  log.push(message);
  await writeCampaignFile(slug, 'chat.json', JSON.stringify(log, null, 2));
}

export async function readNotes(slug: string): Promise<NotePayload[]> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'notes.json'));
    return raw === null ? [] : (JSON.parse(raw) as NotePayload[]);
  } catch (err) {
    logError('storage:readNotes', err);
    return [];
  }
}

export async function appendNote(slug: string, note: NotePayload): Promise<void> {
  const notes = await readNotes(slug);
  notes.push(note);
  await writeCampaignFile(slug, 'notes.json', JSON.stringify(notes, null, 2));
}

export async function writeCharacterImage(slug: string, charId: string, filename: string, data: Buffer): Promise<void> {
  await getMediaStore().put(path.join(partyDir(slug, charId), filename), data);
}

export async function getCharacterStoryboard(slug: string, charId: string): Promise<CharacterStoryboard | null> {
  const raw = await getTextStore().get(path.join(partyDir(slug, charId), 'storyboard.json'));
  return raw === null ? null : (JSON.parse(raw) as CharacterStoryboard);
}

// Campaign-root equivalent of writeCharacterImage — for images that belong to the campaign itself
// rather than any one character (currently just the scenario storyboard's atlas slides).
export async function writeCampaignImage(slug: string, filename: string, data: Buffer): Promise<void> {
  await getMediaStore().put(path.join(campaignDir(slug), filename), data);
}

export async function getScenarioStoryboard(slug: string): Promise<ScenarioStoryboard | null> {
  const raw = await getTextStore().get(path.join(campaignDir(slug), 'scenario-storyboard.json'));
  return raw === null ? null : (JSON.parse(raw) as ScenarioStoryboard);
}

// Admin Resources "storyboard test" sandbox — a single scratch record, not tied to any campaign
// or character, so the storyboard pipeline can be exercised without spending a real character slot.
export async function writeStoryboardTestFile(filename: string, data: Buffer): Promise<void> {
  await getMediaStore().put(path.join(STORYBOARD_TEST_DIR, filename), data);
}

export async function getStoryboardTestRecord(): Promise<StoryboardTestRecord | null> {
  const raw = await getTextStore().get(path.join(STORYBOARD_TEST_DIR, 'record.json'));
  return raw === null ? null : (JSON.parse(raw) as StoryboardTestRecord);
}

export async function listEntitySlugs(slug: string, type: string): Promise<string[]> {
  const names = await getTextStore().list(path.join(CAMPAIGNS_DIR, slug, 'entities', type));
  return names.filter(n => n.endsWith('.md')).map(n => n.replace(/\.md$/, ''));
}

export async function readEntity(slug: string, type: string, entitySlug: string): Promise<string | null> {
  try {
    return await getTextStore().get(path.join(CAMPAIGNS_DIR, slug, 'entities', type, `${entitySlug}.md`));
  } catch (err) {
    logError('storage:readEntity', err);
    return null;
  }
}

export async function writeEntity(slug: string, type: string, entitySlug: string, content: string): Promise<void> {
  await getTextStore().put(path.join(CAMPAIGNS_DIR, slug, 'entities', type, `${entitySlug}.md`), content);
}

export async function listPremadeMaps(): Promise<string[]> {
  const names = await getMediaStore().list(PREMADE_DIR);
  return names.filter(f => f.endsWith('.jpg')).map(f => f.replace(/\.jpg$/, ''));
}

export async function saveMap(slug: string, mapId: string, buffer: Buffer): Promise<void> {
  await getMediaStore().put(path.join(CAMPAIGNS_DIR, slug, 'maps', `${mapId}.jpg`), buffer);
}

export async function appendMapIndex(slug: string, entry: BattleMap): Promise<void> {
  const indexKey = path.join(CAMPAIGNS_DIR, slug, 'maps', 'index.json');
  let index: BattleMap[] = [];
  try {
    const raw = await getTextStore().get(indexKey);
    if (raw !== null) index = JSON.parse(raw) as BattleMap[];
  } catch (err) { logError('storage:appendMapIndex', err); }
  index.push(entry);
  await getTextStore().put(indexKey, JSON.stringify(index, null, 2));
}

export async function listMaps(slug: string): Promise<BattleMap[]> {
  try {
    const raw = await getTextStore().get(path.join(CAMPAIGNS_DIR, slug, 'maps', 'index.json'));
    return raw === null ? [] : (JSON.parse(raw) as BattleMap[]);
  } catch (err) {
    logError('storage:listMaps', err);
    return [];
  }
}

// One file per fight (encounters/<id>.json) — a campaign can have several running at once.
export async function saveEncounter(slug: string, encounter: Encounter): Promise<void> {
  await writeCampaignFile(slug, `encounters/${encounter.id}.json`, JSON.stringify(encounter.toJSON(), null, 2));
}

/** Every fight saved for the campaign, plus a legacy single encounter.json (pre-Party-Groups saves) if it still holds enemies. */
export async function loadEncounters(slug: string): Promise<Encounter[]> {
  const out: Encounter[] = [];
  try {
    const dir = path.join(campaignDir(slug), 'encounters');
    for (const name of await getTextStore().list(dir)) {
      const raw = await getTextStore().get(path.join(dir, name));
      if (raw !== null) out.push(Encounter.fromJSON(JSON.parse(raw)));
    }
    const legacy = await getTextStore().get(path.join(campaignDir(slug), 'encounter.json'));
    if (legacy !== null) out.push(Encounter.fromJSON(JSON.parse(legacy)));
  } catch (err) {
    logError('storage:loadEncounters', err);
  }
  return out;
}

export async function clearEncounter(slug: string, encounter: Encounter): Promise<void> {
  try {
    const key = path.join(campaignDir(slug), 'encounters', `${encounter.id}.json`);
    if (await getTextStore().exists(key)) await getTextStore().delete(key);
    const legacy = path.join(campaignDir(slug), 'encounter.json');
    if (await getTextStore().exists(legacy)) await getTextStore().delete(legacy);
  } catch (err) { logError('storage:clearEncounter', err); }
}

export async function readWorldState(slug: string): Promise<WorldState | null> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'world-state.json'));
    if (raw === null) return null;
    const state = JSON.parse(raw) as WorldState;
    await migrateLegacyWorldActors(slug, state);
    return state;
  } catch (err) { logError('storage:readWorldState', err); return null; }
}

export async function writeWorldState(slug: string, state: WorldState): Promise<void> {
  await writeCampaignFile(slug, 'world-state.json', JSON.stringify(state, null, 2));
}

// Old world-state.json shape embedded each antagonist's goal/milestones directly on WorldActor;
// goal-tracking now lives in goals.json (shared with player goals — see types/goals.ts), so an
// actor loaded with its legacy `ultimateGoal` field gets split into a Goal record + slim
// WorldActor here, once, transparently. No separate migration script needed.
async function migrateLegacyWorldActors(slug: string, state: WorldState): Promise<void> {
  type LegacyActor = WorldActor & {
    ultimateGoal?: string; totalDays?: number; daysElapsed?: number;
    milestones?: Array<{ day: number; description: string; completed: boolean; completedOnDay?: number }>;
  };
  const legacy = (state.actors as LegacyActor[]).filter(a => a.ultimateGoal !== undefined);
  if (!legacy.length) return;

  const goals = await readGoals(slug);
  const now = new Date().toISOString();
  for (const actor of legacy) {
    const goalId = randomUUID();
    goals.push({
      id: goalId,
      ownerType: actor.type,
      ownerId: actor.id,
      tier: 'long',
      description: actor.ultimateGoal!,
      status: actor.status === 'succeeded' ? 'succeeded' : 'active',
      milestones: (actor.milestones ?? []).map(m => ({
        id: randomUUID(), description: m.description, completed: m.completed, day: m.day,
        ...(m.completedOnDay !== undefined ? { completedOnDay: m.completedOnDay } : {}),
      })),
      createdAt: now,
      ...(actor.totalDays !== undefined ? { totalDays: actor.totalDays } : {}),
      ...(actor.daysElapsed !== undefined ? { daysElapsed: actor.daysElapsed } : {}),
    });
    actor.goalId = goalId;
    delete actor.ultimateGoal;
    delete actor.totalDays;
    delete actor.daysElapsed;
    delete actor.milestones;
  }
  await writeGoals(slug, goals);
  await writeCampaignFile(slug, 'world-state.json', JSON.stringify(state, null, 2));
}

export async function readGoals(slug: string): Promise<Goal[]> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'goals.json'));
    return raw === null ? [] : (JSON.parse(raw) as Goal[]);
  } catch (err) { logError('storage:readGoals', err); return []; }
}

export async function writeGoals(slug: string, goals: Goal[]): Promise<void> {
  await writeCampaignFile(slug, 'goals.json', JSON.stringify(goals, null, 2));
}

export async function readCampaignFile(slug: string, filename: string): Promise<string | null> {
  try {
    return await getTextStore().get(path.join(campaignDir(slug), filename));
  } catch (err) { logError('storage:readCampaignFile', err); return null; }
}

export async function loadPartyAllies(slug: string): Promise<EnemyStatBlock[]> {
  try {
    const raw = await getTextStore().get(path.join(CAMPAIGNS_DIR, slug, 'party-allies.json'));
    return raw === null ? [] : (JSON.parse(raw) as EnemyStatBlock[]);
  } catch (err) { logError('storage:loadPartyAllies', err); return []; }
}

export async function savePartyAllies(slug: string, allies: EnemyStatBlock[]): Promise<void> {
  await getTextStore().put(path.join(CAMPAIGNS_DIR, slug, 'party-allies.json'), JSON.stringify(allies, null, 2));
}

// One file per dungeon (dungeons/<id>.json) — a campaign can have several loaded at once.
export async function saveDungeon(slug: string, dungeon: Dungeon): Promise<void> {
  await writeCampaignFile(slug, `dungeons/${dungeon.id}.json`, JSON.stringify(dungeon, null, 2));
}

// Written once per generation (not on every entity-discover save) — a snapshot of the freshly
// generated layout to compare across regenerations while debugging the generator.
export async function saveDungeonAscii(slug: string, dungeon: Dungeon): Promise<void> {
  await writeCampaignFile(slug, 'dungeon.ascii.txt', renderDungeonAscii(dungeon));
}

/** Every dungeon saved for the campaign, plus a legacy single dungeon.json (pre-step-15 saves). */
export async function loadDungeons(slug: string): Promise<Dungeon[]> {
  const out: Dungeon[] = [];
  try {
    const dir = path.join(campaignDir(slug), 'dungeons');
    for (const name of await getTextStore().list(dir)) {
      const raw = await getTextStore().get(path.join(dir, name));
      if (raw !== null) out.push(JSON.parse(raw) as Dungeon);
    }
    const legacy = await getTextStore().get(path.join(campaignDir(slug), 'dungeon.json'));
    if (legacy !== null) {
      const d = JSON.parse(legacy) as Dungeon;
      if (!out.some(o => o.id === d.id)) out.push(d);
    }
  } catch (err) { logError('storage:loadDungeons', err); }
  return out;
}

/**
 * Real (non-arena) dungeons the campaign has stored, newest-visited last. These survive the party
 * leaving (see effects.ts's dungeon_exit) so a return visit re-opens the same place — this is what
 * the DM prompt lists as "already visited" and what a reopen tag resolves against.
 */
export async function listVisitedDungeons(slug: string): Promise<Dungeon[]> {
  return (await loadDungeons(slug)).filter(d => !d.arena);
}

/**
 * The stored dungeon a reopen tag is naming, or null. Matched on slugified name because the only
 * handle the model has is the location name it wrote — it will not reproduce casing or punctuation
 * reliably. A miss is safe: the caller generates a new dungeon, which is what happened every time
 * before any of this existed.
 */
export async function findVisitedDungeonByName(slug: string, name: string): Promise<Dungeon | null> {
  const wanted = slugifyTheme(name);
  if (!wanted) return null;
  const matches = (await listVisitedDungeons(slug)).filter(d => slugifyTheme(d.name) === wanted);
  return matches[matches.length - 1] ?? null;
}

/** Deletes one dungeon — and a legacy dungeon.json, which only ever held the campaign's one dungeon. */
export async function clearDungeon(slug: string, dungeonId: string): Promise<void> {
  const key = path.join(campaignDir(slug), 'dungeons', `${dungeonId}.json`);
  if (await getTextStore().exists(key)) await getTextStore().delete(key);
  const legacy = path.join(campaignDir(slug), 'dungeon.json');
  if (await getTextStore().exists(legacy)) await getTextStore().delete(legacy);
}

export async function readManifest(slug: string): Promise<SessionManifest | null> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'manifest.json'));
    return raw === null ? null : (JSON.parse(raw) as SessionManifest);
  } catch (err) { logError('storage:readManifest', err); return null; }
}

export async function writeManifest(slug: string, manifest: SessionManifest): Promise<void> {
  await writeCampaignFile(slug, 'manifest.json', JSON.stringify(manifest, null, 2));
}

export function emptyManifest(): SessionManifest {
  return { currentLocation: null, npcs: [], factions: [], connectedZones: [], updatedAt: new Date().toISOString(), act: 1, worldTimeSecs: 43200, sessionsPlayed: 0 };
}

export async function readNemeses(slug: string): Promise<NemesisRecord[]> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'nemeses.json'));
    return raw === null ? [] : (JSON.parse(raw) as NemesisRecord[]);
  } catch (err) { logError('storage:readNemeses', err); return []; }
}

export async function writeNemeses(slug: string, records: NemesisRecord[]): Promise<void> {
  await writeCampaignFile(slug, 'nemeses.json', JSON.stringify(records, null, 2));
}

export async function readPartyGroups(slug: string): Promise<PartyGroups | null> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'groups.json'));
    return raw === null ? null : (JSON.parse(raw) as PartyGroups);
  } catch (err) { logError('storage:readPartyGroups', err); return null; }
}

export async function writePartyGroups(slug: string, groups: PartyGroups): Promise<void> {
  await writeCampaignFile(slug, 'groups.json', JSON.stringify(groups, null, 2));
}

export async function readQuests(slug: string): Promise<Quest[]> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'quests.json'));
    return raw === null ? [] : (JSON.parse(raw) as Quest[]);
  } catch (err) { logError('storage:readQuests', err); return []; }
}

export async function writeQuests(slug: string, quests: Quest[]): Promise<void> {
  await writeCampaignFile(slug, 'quests.json', JSON.stringify(quests, null, 2));
}

// A campaign's in-progress plot hooks — only the current beat of each is ever exposed as a real
// quest (see plotArcs.ts's advancePlotArc); the rest live only here until their turn comes.
export async function readPlotArcs(slug: string): Promise<ActivePlotArc[]> {
  try {
    const raw = await getTextStore().get(path.join(campaignDir(slug), 'plot-arcs.json'));
    return raw === null ? [] : (JSON.parse(raw) as ActivePlotArc[]);
  } catch (err) { logError('storage:readPlotArcs', err); return []; }
}

export async function writePlotArcs(slug: string, arcs: ActivePlotArc[]): Promise<void> {
  await writeCampaignFile(slug, 'plot-arcs.json', JSON.stringify(arcs, null, 2));
}

// Records that a pool hook has been committed to a campaign — checked at selection time so the
// same hook is never picked for a campaign twice while (or after) it's already running there.
export async function markPlotHookUsed(hookId: string, campaignId: string): Promise<void> {
  const hooks = await readPlotHooks();
  const hook = hooks.find(h => h.id === hookId);
  if (!hook) return;
  hook.usedIn.push({ campaignId, usedAt: new Date().toISOString() });
  await writePlotHooks(hooks);
}

// Parse [[NPC:slug]], [[Location:slug]], [[Faction:slug]] links from entity file content.
export function parseEntityLinks(content: string): { npcs: string[]; locations: string[]; factions: string[] } {
  const toSlug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const npcs      = [...content.matchAll(/\[\[NPC:([^\]]+)\]\]/g)].map(m => toSlug(m[1]!));
  const locations = [...content.matchAll(/\[\[Location:([^\]]+)\]\]/g)].map(m => toSlug(m[1]!));
  const factions  = [...content.matchAll(/\[\[Faction:([^\]]+)\]\]/g)].map(m => toSlug(m[1]!));
  return { npcs, locations, factions };
}

export async function archiveChatLog(slug: string): Promise<void> {
  const chatKey = path.join(campaignDir(slug), 'chat.json');
  const sessionsDir = path.join(campaignDir(slug), 'sessions');
  try {
    const raw = await getTextStore().get(chatKey);
    if (raw !== null) {
      const date = new Date().toISOString().slice(0, 10);
      const existing = await getTextStore().list(sessionsDir);
      const count = existing.filter(f => f.startsWith(date)).length;
      const archiveName = `${date}-${String(count + 1).padStart(3, '0')}.json`;
      await getTextStore().put(path.join(sessionsDir, archiveName), raw);
    }
  } catch (err) { logError('storage:archiveChatLog', err); }
  await getTextStore().put(chatKey, '[]');
}

// Deletes every text and media object under a campaign's key prefix — the abstraction-layer
// equivalent of `rm -r` on its old on-disk directory, works the same regardless of backend.
export async function deleteCampaign(slug: string): Promise<void> {
  const dir = campaignDir(slug);
  await Promise.all([getTextStore().deletePrefix(dir), getMediaStore().deletePrefix(dir)]);
}
