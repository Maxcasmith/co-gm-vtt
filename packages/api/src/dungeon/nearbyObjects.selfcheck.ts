// Standalone check for nearbyObjects — no test framework in this repo, so this is the one
// runnable check: `tsx src/dungeon/nearbyObjects.selfcheck.ts` from packages/api.
// Asserts: an object within radius is returned with its real position, one outside radius isn't,
// a followed object (Floating Disk) and an undiscovered object are both excluded even in range.
import { nearbyObjects } from './index.ts';
import type { Dungeon } from 'shared';

const dungeon: Dungeon = {
  id: 'fixture', name: 'Fixture', width: 40, height: 40,
  cells: Array.from({ length: 40 }, () => new Array(40).fill(1)),
  rooms: [],
  entities: [
    { id: 'barrel-1', type: 'object', x: 10, y: 10, name: 'Barrel', discovered: true },
    { id: 'chest-1', type: 'object', x: 30, y: 30, name: 'Chest', discovered: true },
    { id: 'disk-1', type: 'object', x: 10, y: 11, name: 'Floating Disk', discovered: true, followsId: 'wizard' },
    { id: 'hidden-1', type: 'object', x: 10, y: 9, name: 'Hidden Cache', discovered: false },
  ],
};

const found = nearbyObjects(dungeon, 10, 12, 15); // radius 15ft = 3 cells

if (!found.some(o => o.id === 'barrel-1')) throw new Error('expected the in-range Barrel to be found');
if (found.some(o => o.id === 'chest-1')) throw new Error('the far-away Chest should not be in range');
if (found.some(o => o.id === 'disk-1')) throw new Error('a followed object should never be returned');
if (found.some(o => o.id === 'hidden-1')) throw new Error('an undiscovered object should never be returned');

const barrel = found.find(o => o.id === 'barrel-1')!;
if (barrel.gx !== 10 || barrel.gy !== 10) throw new Error(`expected the barrel's real position, got ${JSON.stringify(barrel)}`);

console.log('nearbyObjects.selfcheck: all assertions passed');
