// Standalone check for describeDungeonGroundTruth — no test framework in this repo, so this is the
// one runnable check: `tsx src/dungeon/describeDungeonGroundTruth.selfcheck.ts` from packages/api.
// Asserts: no raw (x,y) coordinates leak into the prompt text, a position outside every room's
// bounds (a connector-corridor cell) resolves to the nearest room instead of "an unmapped area",
// and an adjacent room's contents surface under the occupying player's "Right now" entry.
import { describeDungeonGroundTruth } from './index.ts';
import type { Dungeon } from 'shared';

const dungeon: Dungeon = {
  id: 'fixture',
  name: 'Fixture Dungeon',
  width: 14,
  height: 4,
  cells: Array.from({ length: 4 }, () => new Array(14).fill(0)),
  rooms: [
    { id: 'a', name: 'Room A', x: 0, y: 0, width: 3, height: 3, connectsTo: ['Room B'] },
    { id: 'b', name: 'Room B', x: 10, y: 0, width: 3, height: 3, connectsTo: ['Room A'] },
  ],
  entities: [
    { id: 'e1', type: 'loot', x: 1, y: 1, name: 'Rusty Key', discovered: true },
    { id: 'e2', type: 'creature', x: 11, y: 1, name: 'Skulking Rat', discovered: false, hideDC: 12 },
    { id: 'e3', type: 'trap', x: 5, y: 1, name: 'Tripwire', discovered: false, hideDC: 15 }, // sits in the corridor, no owning room
  ],
};

const positions = {
  Aria: { gx: 1, gy: 1 }, // inside Room A
  Cole: { gx: 5, gy: 1 }, // corridor cell — outside every room's bounds
};

const out = describeDungeonGroundTruth(dungeon, positions);

if (/\(\d+,\s*\d+\)/.test(out)) throw new Error(`raw coordinates leaked into output:\n${out}`);
if (out.includes('an unmapped area')) throw new Error(`corridor position fell back to "an unmapped area" instead of nearest room:\n${out}`);
if (!out.includes('Aria is in Room A')) throw new Error(`expected Aria resolved to Room A:\n${out}`);
if (!out.includes('Cole is in the passage toward Room A')) throw new Error(`expected Cole snapped to nearest room (Room A):\n${out}`);
if (!/through to Room B:\s*\n\s*- Skulking Rat \(creature\) — undiscovered, hideDC 12/.test(out)) {
  throw new Error(`expected Room B's undiscovered contents to surface under Aria's adjacency listing:\n${out}`);
}
if (!out.includes('Tripwire (trap) in the passage toward Room A — undiscovered, hideDC 15')) {
  throw new Error(`expected corridor entity bucketed under nearest-room label in the full entity list:\n${out}`);
}

console.log('describeDungeonGroundTruth selfcheck: OK — no coordinate leakage, corridor positions resolve to nearest room, adjacency contents surface.');
