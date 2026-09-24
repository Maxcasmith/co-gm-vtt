// Check for prop zone placement and footprint collision — no test framework in this repo, so this
// is the one runnable check: `npx tsx src/dungeon/placer.zones.selfcheck.ts` from packages/api.
// Pure, no storage or network: placeRoomProps is exported precisely so the geometry that decides
// whether a furnished room reads as a real place can be checked without an LLM or an image call.
import type { DungeonRoom, PropSpec, RoomProp } from 'shared';
import { placeRoomProps } from './placer.ts';
import { propTargetFor } from './propDressing.ts';

// An 8x8 room of solid floor at (1,1), ringed by wall — so "against a wall" is a real, checkable
// property rather than an artifact of the grid's edge.
const SIZE = 10;
const cells: number[][] = Array.from({ length: SIZE }, (_, y) =>
  Array.from({ length: SIZE }, (_, x) => (x >= 1 && x <= 8 && y >= 1 && y <= 8 ? 1 : 0)));

const room: DungeonRoom = { id: 'r1', name: 'Diner', x: 1, y: 1, width: 8, height: 8 };

const spec = (over: Partial<PropSpec> & Pick<PropSpec, 'noun'>): PropSpec =>
  ({ category: 'surface', description: over.noun, sizeXY: [1, 1], ...over });

const specs = new Map<string, PropSpec>([
  ['booth', spec({ noun: 'booth', category: 'seating' })],
  ['long-table', spec({ noun: 'long-table', sizeXY: [1, 3] })],
  ['stool', spec({ noun: 'stool', category: 'seating', sizeXY: [1, 1] })],
]);

const place = (requests: RoomProp[]) => placeRoomProps(room, requests, specs, new Set<string>(), cells);

// Is this cell orthogonally adjacent to a non-floor cell?
const againstWall = (x: number, y: number) =>
  cells[y]?.[x - 1] !== 1 || cells[y]?.[x + 1] !== 1 || cells[y - 1]?.[x] !== 1 || cells[y + 1]?.[x] !== 1;

function main() {
  // Feet to cells at the standard 5ft square — a 2ft stool still occupies a cell, a 15ft table
  // occupies three. This is the conversion that stops everything being a square blob.

  // Non-square footprints survive the trip — the whole point of authoring real dimensions.
  const table = place([{ noun: 'long-table', count: 1, zone: 'centre' }])[0];
  if (table?.width !== 1 || table?.height !== 3) throw new Error(`a 5x15ft table must be 1x3 cells, got ${table?.width}x${table?.height}`);

  // 'wall' props actually touch a wall. This is the fix for furniture floating mid-floor, and it
  // cannot be verified from the model's output — only from the carved cells.
  const walls = place([{ noun: 'booth', count: 6, zone: 'wall' }]);
  if (walls.length !== 6) throw new Error(`expected 6 booths, got ${walls.length}`);
  for (const booth of walls) {
    if (!againstWall(booth.x, booth.y)) throw new Error(`a wall-zone prop landed at ${booth.x},${booth.y} with no adjacent wall`);
  }

  // 'centre' props sit in the middle, not against the edge — an altar or a machine is the thing a
  // room is built around.
  const centre = place([{ noun: 'booth', count: 1, zone: 'centre' }])[0]!;
  if (againstWall(centre.x, centre.y)) throw new Error('a centre-zone prop must not hug a wall');

  // Footprints never overlap. The pre-density placer tracked only the anchor cell, which was
  // survivable at 1-4 props per room and is not at 25.
  const dense = place([{ noun: 'long-table', count: 4, zone: 'floor' }, { noun: 'stool', count: 12, zone: 'floor' }]);
  const claimed = new Set<string>();
  for (const e of dense) {
    for (let dy = 0; dy < (e.height ?? 1); dy++) {
      for (let dx = 0; dx < (e.width ?? 1); dx++) {
        const cell = `${e.x + dx},${e.y + dy}`;
        if (claimed.has(cell)) throw new Error(`two props overlap at ${cell}`);
        claimed.add(cell);
      }
    }
  }

  // Everything stays on real floor, inside the room — a prop half-buried in a wall reads as a bug
  // to a player, not as clutter.
  for (const e of dense) {
    for (let dy = 0; dy < (e.height ?? 1); dy++) {
      for (let dx = 0; dx < (e.width ?? 1); dx++) {
        if (cells[e.y + dy]?.[e.x + dx] !== 1) throw new Error(`a prop covers a non-floor cell at ${e.x + dx},${e.y + dy}`);
      }
    }
  }

  // A room that ran out of floor drops the overflow rather than stacking or shrinking it: 64 floor
  // cells cannot hold 200 props, and the ones that fit are the correct outcome.
  const overflow = place([{ noun: 'booth', count: 200, zone: 'floor' }]);
  if (overflow.length === 0) throw new Error('an over-full request must still place what fits');
  if (overflow.length > 64) throw new Error(`placed ${overflow.length} props in a 64-cell room`);

  // Props already occupying cells are respected — creatures, loot and traps are placed first, and
  // furniture must not land on top of the content the room exists for.
  const taken = new Set<string>();
  for (let y = 1; y <= 8; y++) for (let x = 1; x <= 7; x++) taken.add(`${x},${y}`);
  const squeezed = placeRoomProps(room, [{ noun: 'booth', count: 20, zone: 'floor' }], specs, taken, cells);
  if (squeezed.some(e => e.x !== 8)) throw new Error('a prop landed on an already-occupied cell');

  // Density comes from real carved floor area, not the manifest's size label. A 13x13 room lands
  // near 28 props; the old prompt asked for 1-4 regardless of size, which is the two-booth diner.
  const big: DungeonRoom = { id: 'r2', name: 'Hall', x: 0, y: 0, width: 13, height: 13 };
  const solid: number[][] = Array.from({ length: 13 }, () => new Array<number>(13).fill(1));
  const target = propTargetFor(big, solid);
  if (target < 20 || target > 35) throw new Error(`a 13x13 room should target roughly 28 props, got ${target}`);
  if (propTargetFor(room, cells) < 8) throw new Error('an 8x8 room should still target a furnished-looking count');

  console.log('placer zones selfcheck passed');
}

main();
