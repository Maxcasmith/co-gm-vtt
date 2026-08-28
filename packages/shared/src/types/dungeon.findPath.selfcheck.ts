// Standalone check for findPath's occupancy avoidance — no test framework in this repo, so this
// is the one runnable check: `tsx src/types/dungeon.findPath.selfcheck.ts` from packages/shared.
// Asserts: an occupied cell blocking the only straight route forces a detour instead of a dead
// end, the target cell is never blocked by `occupied` even when it's in the set, and omitting
// `occupied` entirely still behaves exactly like plain wall-only pathing.
import { findPath } from './dungeon.ts';

// 3-wide corridor, 3 rows tall — plenty of room to detour around a single blocked cell.
const cells = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
];

const straight = findPath(cells, 0, 1, 2, 1);
if (!straight || straight.length !== 2) {
  throw new Error(`expected a 2-step straight path with no occupancy, got ${JSON.stringify(straight)}`);
}

const occupied = new Set(['1,1']); // dead center, blocking the straight route
const detour = findPath(cells, 0, 1, 2, 1, occupied);
if (!detour) throw new Error('expected a detour around the occupied center cell, got null');
if (detour.some(step => `${step.gx},${step.gy}` === '1,1')) {
  throw new Error(`detour should never step onto an occupied cell, got ${JSON.stringify(detour)}`);
}

// The target cell itself is occupied (e.g. moving adjacent to an enemy standing there) — must
// still be reachable, `occupied` should never block the destination.
const toOccupiedTarget = findPath(cells, 0, 1, 2, 1, new Set(['2,1']));
if (!toOccupiedTarget) throw new Error('occupied should never block the target cell itself');

console.log('dungeon.findPath.selfcheck: all assertions passed');
