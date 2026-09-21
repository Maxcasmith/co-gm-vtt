import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, Player, Dungeon, EffectSpec, HookSpec, AbilityKey, PartyGroups } from 'shared';
import { trackOf, locationOfTrack } from 'shared';
import { Encounter } from './domain/encounter.ts';
import { StateEngine } from './combat/stateEngine/StateEngine.ts';
import { logError } from './logger.ts';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

export const httpServer = createServer(app);
export const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

// Every campaign's clients join its own room — emits scoped by campaign instead of one global room
// every campaign on this server shared. Narrower audiences (a Party Groups track, a fight) aren't
// rooms: they're resolved to socket ids at emit time — see toSockets/toFight/toTracks.
export const campaignRoom = (cid: string): string => `campaign:${cid}`;
// The console.log mirror below has no campaign in scope, so it keeps one server-wide room.
export const DEBUG_LOG_ROOM = 'debug-log';

// ponytail: intercept console.log to broadcast logs to connected clients for the combat log overlay
const _origLog = console.log;
console.log = (...args: unknown[]) => {
  _origLog(...args);
  try {
    const text = args.map(a => { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch (err) { logError('index:consoleLogOverride:stringify', err); return String(a); } }).join(' ');
    io.to(DEBUG_LOG_ROOM).emit('combat:log', { text, timestamp: Date.now() });
  } catch (err) { logError('index:consoleLogOverride', err); }
};

export const connected = new Set<Player>();
export const sessionState = new Map<string, boolean>();
// cid → fightId → Encounter. A campaign runs any number of independent fights at once (split
// groups in different parts of a dungeon); every combatant is in at most one of them. Per-fight
// state (scores, marks, readiness, …) lives on the Encounter itself.
const fights = new Map<string, Map<string, Encounter>>();

/** Every live fight in the campaign — one that's been decided (ended, awaiting teardown) no longer counts. */
export function fightsIn(cid: string): Encounter[] {
  return [...(fights.get(cid)?.values() ?? [])].filter(f => !f.ended);
}

/** The live fight `key` (participant id, character id, or player name) is in, if any. */
export function fightOf(cid: string, key: string): Encounter | undefined {
  return fightsIn(cid).find(f => f.findParticipant(key) || f.pendingPlayerNames.includes(key));
}

export function registerFight(cid: string, fight: Encounter): void {
  const byId = fights.get(cid) ?? new Map<string, Encounter>();
  byId.set(fight.id, fight);
  fights.set(cid, byId);
}

/** False once endCombat has removed it — how a delayed teardown knows it's still the one to tear down. */
export function isRegisteredFight(cid: string, fight: Encounter): boolean {
  return fights.get(cid)?.get(fight.id) === fight;
}

export function unregisterFight(cid: string, fight: Encounter): void {
  fights.get(cid)?.delete(fight.id);
}

// io.to([]) broadcasts to EVERY socket on the server — an audience that resolves to nobody must
// reach nobody, so it targets a room no socket ever joins instead.
const NOBODY_ROOM = 'nobody';
export function toSockets(socketIds: string[]) {
  return io.to(socketIds.length ? socketIds : NOBODY_ROOM);
}
export type Audience = ReturnType<typeof toSockets>;

/** toFight for whichever fight `key` (participant id/name) is in — or the whole campaign when
 * they're in none (a trap sprung while exploring still shows its save result to everyone). */
export function toFightOf(cid: string, key: string) {
  const fight = fightOf(cid, key);
  return fight ? toFight(fight) : io.to(campaignRoom(cid));
}

/** The fight's own players (by live socket) — the audience for every combat event. Computed at emit
 * time from the fight itself rather than kept as room membership, so joins, merges, reconnects and
 * lane changes can never leave it stale. */
export function toFight(fight: Encounter) {
  return toSockets(fight.turnOrder.concat(fight.players)
    .filter(p => p.isPlayer)
    .map(p => playerSocketIds.get(p.id))
    .filter((sid): sid is string => !!sid));
}
// Combat hook registry, lifecycle-matched to `encounters` — created on demand at combat start,
// deleted by endCombat so a finished fight's hooks can never leak into the next one.
export const stateEngines = new Map<string, StateEngine>();

export function getStateEngine(cid: string): StateEngine {
  let engine = stateEngines.get(cid);
  if (!engine) {
    engine = new StateEngine(cid);
    stateEngines.set(cid, engine);
  }
  return engine;
}
export const dmQueue = new Map<string, Promise<void>>();
export const campaignPlayers = new Map<string, string[]>();
export const playerSocketIds = new Map<string, string>(); // charId → socketId (for private events)
// cid → player name → charId, filled on join — lets name-keyed audiences (a dungeon's occupants) reach sockets.
export const playerCharIds = new Map<string, Map<string, string>>();
// cid → casterId → self-buff spell (e.g. Divine Smite) queued to trigger on that caster's next
// weapon hit. Effects are stored unresolved (not pre-rolled) so appliesIf (e.g. vs Fiend/Undead)
// can be evaluated against whichever creature actually gets hit. `save`/`hooks` are only present
// for spells with a secondary save-gated effect on top of unconditional damage (Thunderous
// Smite's push+Prone, Searing Smite's Burning) — damage-only smites (Divine Smite) omit both.
export const pendingWeaponBonuses = new Map<string, Record<string, {
  spellName: string;
  effects: EffectSpec[];
  casterLevel: number;
  slotLevel: number;
  save?: { ability: AbilityKey; halfOnSave: boolean } | undefined;
  hooks?: HookSpec[] | undefined;
  /** Burst color played on the target when this buff's weapon hit lands (SpellCombatMeta.impactColor). */
  impactColor?: string | undefined;
  /** Visual variant for the impact burst (SpellCombatMeta.impactStyle). */
  impactStyle?: 'fire' | undefined;
  /** Hail of Thorns' splash — every other living creature within this many feet of the hit target rolls the same `save` against the same gated damage effects too. */
  splashRadiusFt?: number | undefined;
  /** Green-Flame Blade's splash — a single nearest enemy within splashRadiusFt of the hit target takes this flat, no-save damage instead of rolling a save against `effects` (mutually exclusive with the Hail-of-Thorns save-based splash above). */
  splashOnHit?: EffectSpec[] | undefined;
  /** Caster's spellcasting ability modifier, needed to resolve a 'cantrip-plus-ability-mod' or 'ability-mod' Scaling on splashOnHit. */
  casterAbilityMod?: number | undefined;
}>>();

export interface RestChoice {
  resting: boolean; restType: 'short' | 'long'; hitDiceSpent: number;
  /** Origin feat Crafter — one FAST_CRAFTING_TABLE name, only honored on a Long Rest. */
  craftedItem?: string;
  /** Origin feat Musician — play an instrument to grant Heroic Inspiration, see grantMusicianInspiration. */
  grantInspiration?: boolean;
}
// In-memory mirror of groups.json — read on every chat message to route it, so kept hot rather than
// re-read from storage each time. See partyGroups.ts getPartyGroups.
export const partyGroups = new Map<string, PartyGroups>();
export const pendingRests = new Map<string, Map<string, RestChoice>>(); // campaignId → charId → choice, cleared once every online charId has voted

// A campaign delete only wipes the persisted store — call this alongside it so a slug reused
// right after (same adventure recreated under the same name) doesn't resume from the erased
// predecessor's cached dungeon/combat state still sitting in these Maps.
export function clearCampaignRuntimeState(cid: string): void {
  sessionState.delete(cid);
  fights.delete(cid);
  stateEngines.delete(cid);
  dmQueue.delete(cid);
  campaignPlayers.delete(cid);
  dungeonRegistry.delete(cid);
  playerCharIds.delete(cid);
  pendingWeaponBonuses.delete(cid);
  pendingRests.delete(cid);
  partyGroups.delete(cid);
}

export const PLAYER_SIGHT_RADIUS = 20; // square (Chebyshev) radius, in cells
export const ENEMY_AGGRO_RADIUS  = 12;
// A player outside every fight joins one once within this many cells (and in sight) of anyone in it — see chainClosure.
export const COMBAT_CHAIN_RADIUS = 7;

export const NEMESIS_COOLDOWN_SESSIONS = 2;
export const NEMESIS_CAP_PER_TARGET = 3;
export const NEMESIS_MAX_DEATHS = 3;
export const ALLY_XP_PER_LEVEL = 100;
export const CR_STEPS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8];

export const HIT_DICE: Record<string, number> = {
  Artificer: 8, Barbarian: 12, Bard: 8, Cleric: 8, Druid: 8,
  Fighter: 10, Monk: 8, Paladin: 10, Ranger: 10, Rogue: 8,
  Sorcerer: 6, Warlock: 8, Wizard: 6,
};

export const CR_XP: [number, number][] = [
  [0, 10], [0.125, 25], [0.25, 50], [0.5, 100],
  [1, 200], [2, 450], [3, 700], [4, 1100], [5, 1800],
  [6, 2300], [7, 2900], [8, 3900], [9, 5000], [10, 5900],
];

export const STAT_FULL: Record<string, string> = {
  STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution',
  INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma',
};

export const BG_SKILLS: Record<string, string[]> = {
  Acolyte:       ['Insight', 'Religion'],
  Charlatan:     ['Deception', 'Sleight of Hand'],
  Criminal:      ['Deception', 'Stealth'],
  Entertainer:   ['Acrobatics', 'Performance'],
  'Folk Hero':   ['Animal Handling', 'Survival'],
  Gladiator:     ['Acrobatics', 'Performance'],
  'Guild Artisan':['Insight', 'Persuasion'],
  Hermit:        ['Medicine', 'Religion'],
  Noble:         ['History', 'Persuasion'],
  Outlander:     ['Athletics', 'Survival'],
  Sage:          ['Arcana', 'History'],
  Sailor:        ['Athletics', 'Perception'],
  Soldier:       ['Athletics', 'Intimidation'],
  Urchin:        ['Sleight of Hand', 'Stealth'],
};

export const SAVE_PROFS: Record<string, string[]> = {
  Barbarian: ['STR', 'CON'], Bard:    ['DEX', 'CHA'], Cleric:   ['WIS', 'CHA'],
  Druid:     ['INT', 'WIS'], Fighter: ['STR', 'CON'], Monk:     ['STR', 'DEX'],
  Paladin:   ['WIS', 'CHA'], Ranger:  ['STR', 'DEX'], Rogue:    ['DEX', 'INT'],
  Sorcerer:  ['CON', 'CHA'], Warlock: ['WIS', 'CHA'], Wizard:   ['INT', 'WIS'],
};

// ── Dungeons ────────────────────────────────────────────────────────────────────
// cid → dungeonId → Dungeon (in-memory mirror of saveDungeon/loadDungeons, mutated on reveal).
// Several can be loaded at once: split groups in different dungeons, and each open-world fight's
// own combat arena (Dungeon.arena). Everything's live position lives on the dungeon it's standing
// in (Dungeon.positions) — there is no campaign-wide position table.
const dungeonRegistry = new Map<string, Map<string, Dungeon>>();

export function dungeonsIn(cid: string): Dungeon[] {
  return [...(dungeonRegistry.get(cid)?.values() ?? [])];
}

export function dungeonById(cid: string, id: string | undefined): Dungeon | undefined {
  return id ? dungeonRegistry.get(cid)?.get(id) : undefined;
}

export function registerDungeon(cid: string, dungeon: Dungeon): void {
  dungeon.positions ??= {};
  const byId = dungeonRegistry.get(cid) ?? new Map<string, Dungeon>();
  byId.set(dungeon.id, dungeon);
  dungeonRegistry.set(cid, byId);
}

export function unregisterDungeon(cid: string, id: string): void {
  dungeonRegistry.get(cid)?.delete(id);
}

function isPlayerName(cid: string, key: string): boolean {
  return playerCharIds.get(cid)?.has(key) || (campaignPlayers.get(cid) ?? []).includes(key);
}

/** A player's name for `key` (their name, or their character id). */
function playerNameOf(cid: string, key: string): string | undefined {
  if (isPlayerName(cid, key)) return key;
  for (const [name, id] of playerCharIds.get(cid) ?? []) if (id === key) return name;
  const p = fightOf(cid, key)?.findParticipant(key);
  return p?.isPlayer ? p.name : undefined;
}

/** The dungeon id a player (name or character id) stands in — their open-world fight's arena while
 * it lasts, otherwise their Party Groups track's location. undefined = the open world. */
export function locationOf(cid: string, key: string): string | undefined {
  const arenaId = fightOf(cid, key)?.arenaId;
  if (arenaId) return arenaId;
  const name = playerNameOf(cid, key) ?? key;
  const groups = partyGroups.get(cid);
  return groups ? locationOfTrack(groups, trackOf(groups, name)) : undefined;
}

/** The dungeon `key` is in: a player by their location; anything else (creature, object, summon)
 * by its fight's arena, or whichever loaded dungeon holds its token or entity. */
export function dungeonOf(cid: string, key: string): Dungeon | undefined {
  if (playerNameOf(cid, key)) return dungeonById(cid, locationOf(cid, key));
  const arena = dungeonById(cid, fightOf(cid, key)?.arenaId);
  if (arena) return arena;
  return dungeonsIn(cid).find(d => d.positions?.[key] || d.entities.some(e => e.id === key));
}

/** Live token positions of the dungeon `key` is standing in — {} in the open world, where there's
 * no map to place anything on (writes to it go nowhere, by design). */
export function positionsOf(cid: string, key: string): Record<string, { gx: number; gy: number }> {
  return dungeonOf(cid, key)?.positions ?? {};
}

/** The dungeon a fight is being fought in — its open-world arena, or the dungeon its combatants stand in. */
export function fightDungeon(cid: string, fight: Encounter): Dungeon | undefined {
  const arena = dungeonById(cid, fight.arenaId);
  if (arena) return arena;
  for (const p of [...fight.enemies, ...fight.players]) {
    const d = dungeonOf(cid, p.isPlayer ? p.name : p.id);
    if (d) return d;
  }
  return undefined;
}

/** Players (by name) standing in `dungeonId` right now. */
export function occupantsOf(cid: string, dungeonId: string): string[] {
  const names = new Set([...(campaignPlayers.get(cid) ?? []), ...(playerCharIds.get(cid)?.keys() ?? [])]);
  return [...names].filter(name => locationOf(cid, name) === dungeonId);
}

/** Everyone in the dungeon `key` (a token: player name or creature id) is standing in — nobody in the open world. */
export function toDungeonOf(cid: string, key: string) {
  const dungeon = dungeonOf(cid, key);
  return dungeon ? toDungeon(cid, dungeon.id) : toSockets([]);
}

/** Everyone standing in `dungeonId` (live sockets, resolved now) — the audience for its map events. */
export function toDungeon(cid: string, dungeonId: string) {
  const ids = playerCharIds.get(cid);
  return toSockets(occupantsOf(cid, dungeonId)
    .map(name => { const charId = ids?.get(name); return charId ? playerSocketIds.get(charId) : undefined; })
    .filter((sid): sid is string => !!sid));
}
