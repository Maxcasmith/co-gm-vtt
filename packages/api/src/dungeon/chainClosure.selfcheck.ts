// Pure check for chainClosure — `tsx src/dungeon/chainClosure.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import type { Dungeon } from 'shared';
import { chainClosure } from './index.ts';

// 30x5 open floor with a solid wall column at x=20 (rows 0-4) — nothing sees past it.
const cells = Array.from({ length: 5 }, () => Array.from({ length: 30 }, (_, x) => (x === 20 ? 0 : 1)));
const dungeon = { id: 'd', name: 'd', width: 30, height: 5, cells, rooms: [], entities: [] } as Dungeon;
const fight = [{ gx: 0, gy: 2 }];

// In range + sight: joins. Out of range: doesn't.
assert.deepEqual(chainClosure(dungeon, fight, { A: { gx: 7, gy: 2 }, B: { gx: 8, gy: 2 } }, 7).sort(), ['A', 'B']); // B chains off A
assert.deepEqual(chainClosure(dungeon, fight, { B: { gx: 8, gy: 2 } }, 7), []);

// Chains transitively in whatever order candidates are listed.
assert.deepEqual(chainClosure(dungeon, fight, { C: { gx: 14, gy: 2 }, A: { gx: 7, gy: 2 } }, 7), ['A', 'C']);

// In range but behind the wall: no sight line, no join (and it doesn't chain through the wall either).
assert.deepEqual(chainClosure(dungeon, [{ gx: 17, gy: 2 }], { D: { gx: 22, gy: 2 } }, 7), []);

console.log('chainClosure selfcheck OK');
