// Standalone check for buildDungeonQuests — no test framework in this repo, so this is the one
// runnable check: `tsx src/dungeon/buildDungeonQuests.selfcheck.ts` from packages/api.
// Asserts: dungeon.goals no longer gets re-derived into quests here (that now happens BEFORE the
// dungeon exists — see generateDungeonQuests) — only the deterministic boss-defeat and
// escape-dungeon entries come out of this function, merged with whatever quests already exist.
import { buildDungeonQuests } from './index.ts';
import type { Dungeon, Quest } from 'shared';

const dungeon: Dungeon = {
  id: 'fixture-dungeon',
  name: 'Fixture Crypt',
  width: 20,
  height: 20,
  cells: Array.from({ length: 20 }, () => new Array(20).fill(1)),
  rooms: [],
  // Even with goals present (as they will be — set from predefinedQuests now), this function
  // must not turn them into a second, slug-id'd copy of a quest that already exists.
  goals: ['Rescue the Cartographer.'],
  entities: [
    { id: 'boss-1', type: 'creature', x: 5, y: 5, name: 'The Rot King', discovered: false, statBlock: { id: 'boss-1', name: 'The Rot King', cr: 5, hp: 90, ac: 16, speed: 30, stats: { str: 16, dex: 12, con: 16, int: 8, wis: 10, cha: 8 }, attacks: [], creatureType: 'Undead', isBoss: true } },
  ],
};

const existing: Quest[] = [
  { id: 'rescue-the-cartographer', name: 'Rescue the Cartographer', description: 'Find and free the cartographer.', status: 'open', log: [], addedAt: '2026-01-01', sourceDungeonId: 'fixture-dungeon' },
];

const result = buildDungeonQuests(dungeon, existing);

// The pre-existing goal-sourced quest survives untouched — not duplicated under a slugified-goal id.
if (result.filter(q => q.name === 'Rescue the Cartographer').length !== 1) {
  throw new Error(`expected exactly one 'Rescue the Cartographer' quest, got: ${JSON.stringify(result.map(q => q.name))}`);
}
if (result.some(q => q.id === 'rescue-the-cartographer-')) throw new Error('goal text should never be re-slugified into a second quest id');

// Boss-defeat and escape-dungeon entries are still generated in code. The boss quest must stay
// generic — the boss is undiscovered at this point, naming it here would leak its identity.
if (!result.some(q => q.id === 'boss-boss-1' && q.name === 'Defeat the boss')) throw new Error(`missing boss quest: ${JSON.stringify(result)}`);
if (!result.some(q => q.id === 'exit-dungeon')) throw new Error(`missing escape-dungeon quest: ${JSON.stringify(result)}`);

// Total count: the 1 pre-existing quest + boss + exit = 3, not 4 (no goal-derived duplicate).
if (result.length !== 3) throw new Error(`expected exactly 3 quests (existing + boss + exit), got ${result.length}: ${JSON.stringify(result.map(q => q.id))}`);

console.log('buildDungeonQuests selfcheck: OK — goals are never re-derived into quests here anymore, only boss/escape entries, no duplication.');
