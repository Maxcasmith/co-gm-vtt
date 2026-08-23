// Standalone check for narrateEvents — no test framework in this repo, so this is the one runnable
// check: `tsx src/dungeon/narrateEvents.selfcheck.ts` from packages/api.
// Asserts: a room with description + dressing + a discovered entity concatenates all three (and
// leaves out the undiscovered one), a bare room templates to null, each entity type produces a
// distinct found-line, a hiddenDressing hit reports its text, and a miss produces a plain line.
import { templateRoomEntry, templateSearchResult } from './narrateEvents.ts';
import type { Dungeon } from 'shared';

const dungeon: Dungeon = {
  id: 'fixture',
  name: 'Fixture Dungeon',
  width: 14,
  height: 4,
  cells: Array.from({ length: 4 }, () => new Array(14).fill(0)),
  rooms: [
    { id: 'a', name: 'Room A', x: 0, y: 0, width: 3, height: 3, description: 'A low vaulted chamber.', dressing: ['Cracked flagstones underfoot.', 'A toppled bench.'] },
    { id: 'b', name: 'Room B', x: 10, y: 0, width: 3, height: 3 },
  ],
  entities: [
    { id: 'e1', type: 'loot', x: 1, y: 1, name: 'Rusty Key', discovered: true },
    { id: 'e2', type: 'trap', x: 2, y: 2, name: 'Tripwire', discovered: false, hideDC: 15 },
  ],
};

const roomA = dungeon.rooms[0]!;
const roomB = dungeon.rooms[1]!;

// ── room entry ────────────────────────────────────────────────────────────────
const entry = templateRoomEntry(dungeon, roomA);
if (entry !== 'A low vaulted chamber.\nCracked flagstones underfoot.\nA toppled bench.\nHere: Rusty Key.') {
  throw new Error(`unexpected room-entry text:\n${entry}`);
}
if (entry.includes('Tripwire')) throw new Error(`undiscovered entity leaked into room-entry text:\n${entry}`);

if (templateRoomEntry(dungeon, roomB) !== null) {
  throw new Error('expected null for a room with no description, dressing, or discovered entities');
}

// ── search results ────────────────────────────────────────────────────────────
const lines = [
  templateSearchResult('Aria', { id: 'c', type: 'creature', x: 0, y: 0, name: 'Skulking Rat', discovered: true }),
  templateSearchResult('Aria', { id: 'l', type: 'loot', x: 0, y: 0, name: 'Rusty Key', discovered: true }),
  templateSearchResult('Aria', { id: 't', type: 'trap', x: 0, y: 0, name: 'Tripwire', discovered: true }),
  templateSearchResult('Aria', { id: 'o', type: 'object', x: 0, y: 0, name: 'Iron Lever', discovered: true }),
  templateSearchResult('Aria', { id: 'hd', text: 'a scratched tally on the wall', hideDC: 12, discovered: true }),
];
if (new Set(lines).size !== lines.length) throw new Error(`found-lines are not distinct per type:\n${lines.join('\n')}`);
for (const [i, needle] of ['Skulking Rat', 'Rusty Key', 'Tripwire', 'Iron Lever', 'a scratched tally on the wall'].entries()) {
  if (!lines[i]!.includes(needle)) throw new Error(`line ${i} missing "${needle}": ${lines[i]}`);
}
if (!lines[2]!.includes('trap')) throw new Error(`trap line should say it is a trap: ${lines[2]}`);

// Miss — rotates over a small fixed set, so assert shape rather than one exact string.
for (let i = 0; i < 30; i++) {
  const miss = templateSearchResult('Aria', null);
  if (!miss.startsWith('Aria ') || !miss.endsWith('.')) throw new Error(`malformed miss line: ${miss}`);
  if (/find[s]? [A-Z]/.test(miss)) throw new Error(`miss line named something: ${miss}`);
}

console.log('narrateEvents selfcheck: OK — room entry concatenates stored facts only, bare rooms template to null, each find type reads distinctly, misses stay empty-handed.');
