import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, Player, Dungeon, EffectSpec } from 'shared';
import { Encounter } from './domain/encounter.ts';
import { logError } from './logger.ts';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

export const httpServer = createServer(app);
export const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

export const ROOM = 'sandbox';

// ponytail: intercept console.log to broadcast logs to connected clients for the combat log overlay
const _origLog = console.log;
console.log = (...args: unknown[]) => {
  _origLog(...args);
  try {
    const text = args.map(a => { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch (err) { logError('index:consoleLogOverride:stringify', err); return String(a); } }).join(' ');
    io.to(ROOM).emit('combat:log', { text, timestamp: Date.now() });
  } catch (err) { logError('index:consoleLogOverride', err); }
};

export const connected = new Set<Player>();
export const sessionState = new Map<string, boolean>();
export const combatState = new Map<string, boolean>();
export const encounters = new Map<string, Encounter>();
export const tokenPositions = new Map<string, Record<string, { gx: number; gy: number }>>();
export const dmQueue = new Map<string, Promise<void>>();
export const campaignPlayers = new Map<string, string[]>();
export const playerSocketIds = new Map<string, string>(); // charId → socketId (for private events)
export const enemiesReady   = new Map<string, boolean>();  // true once rollEnemyInitiatives has fired
export const combatStartedAt = new Map<string, number>();  // timestamp when combat_init fired, for nemesis transcript slicing
export const dungeons = new Map<string, Dungeon>(); // in-memory mirror of saveDungeon/loadDungeon, mutated on reveal
// cid → casterId → self-buff spell (e.g. Divine Smite) queued to trigger on that caster's next
// weapon hit. Effects are stored unresolved (not pre-rolled) so appliesIf (e.g. vs Fiend/Undead)
// can be evaluated against whichever creature actually gets hit.
export const pendingWeaponBonuses = new Map<string, Record<string, { spellName: string; effects: EffectSpec[]; casterLevel: number; slotLevel: number }>>();
export const microDungeons = new Set<string>(); // cids whose current dungeon is an ephemeral combat arena — discarded on victory instead of continued

export const PLAYER_SIGHT_RADIUS = 20; // square (Chebyshev) radius, in cells
export const ENEMY_AGGRO_RADIUS  = 12;

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

// Every dungeon:loaded broadcast must carry live positions, not just what was last saved to disk —
// the client's entrance-spawn effect treats any player missing from `positions` as never-placed and
// re-defaults (and re-broadcasts) their position, so a stale/absent snapshot here silently teleports
// already-positioned players back to the entrance on the next reveal or reconnect.
export function withLivePositions(cid: string, dungeon: Dungeon): Dungeon {
  const positions = tokenPositions.get(cid);
  return positions ? { ...dungeon, positions } : dungeon;
}
