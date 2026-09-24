import assert from 'node:assert';
import type { DungeonRoom, PropSpec } from 'shared';
import { buildLegend, findThresholds, parseLayout, renderRoomMask, rotationFor } from './roomLayout.ts';

/** 6x5 room at (1,1) with a corridor cell poking out of its right wall at y=3. */
function fixture(): { room: DungeonRoom; cells: number[][] } {
  const cells: number[][] = Array.from({ length: 10 }, () => Array.from({ length: 12 }, () => 0));
  for (let y = 1; y < 6; y++) for (let x = 1; x < 7; x++) cells[y]![x] = 1;
  cells[3]![7] = 1; // corridor leaving the room
  const room = { id: 'r1', name: 'Test', x: 1, y: 1, width: 6, height: 5 } as DungeonRoom;
  return { room, cells };
}

const specs: PropSpec[] = [
  { noun: 'counter', category: 'surface', description: 'a counter', sizeXY: [3, 1] },
  { noun: 'stool', category: 'seating', description: 'a stool', sizeXY: [1, 1] },
];
const legend = buildLegend(specs); // A = counter, B = stool

const { room, cells } = fixture();
const thresholds = findThresholds(room, cells);

// The corridor mouth (6,3) and the cell inward of it (5,3) are both reserved.
assert.ok(thresholds.has('6,3'), 'corridor mouth is a threshold');
assert.ok(thresholds.has('5,3'), 'cell inward of the mouth is a threshold');
assert.ok(!thresholds.has('3,3'), 'mid-room floor is not a threshold');

const mask = renderRoomMask(room, cells, thresholds, new Set(['1,1']));
assert.strictEqual(mask.rows.length, 5);
assert.ok(mask.rows.every(r => r.length === 6), 'every mask row is room width');
assert.strictEqual(mask.rows[0]![0], '.', 'blocked cell renders as void');
assert.strictEqual(mask.rows[2]![5], '+', 'threshold renders as +');

// A good reply: a 4-cell counter on row 1, two stools under it on row 2. Kept off row 0, whose ends
// are corners (see the corner test below).
const good = parseLayout(
  {
    furniture: ['00|._____', '01|_AAAA_', '02|_B_B++', '03|______', '04|______'],
    facing: ['00|._____', '01|_vvvv_', '02|_^_^++', '03|______', '04|______'],
  },
  room, mask, legend,
);
assert.strictEqual(good.rejected.length, 0, `no rejections, got ${JSON.stringify(good.rejected)}`);
const counter = good.props.find(p => p.noun === 'counter')!;
assert.strictEqual(counter.width, 4, 'a 4-char run is one object 4 cells wide');
assert.strictEqual(counter.height, 1);
assert.strictEqual(counter.x, 2, 'absolute x = room.x + column');
assert.strictEqual(counter.y, 2);
assert.strictEqual(counter.facing, 'v');
assert.strictEqual(good.props.filter(p => p.noun === 'stool').length, 2, 'two separate stools, not one run');
assert.ok(good.props.every(p => p.facing !== undefined));

// A vertical run is one object too.
const vertical = parseLayout(
  {
    furniture: ['00|._____', '01|__A___', '02|__A_++', '03|__A___', '04|______'],
    facing: ['00|._____', '01|__>___', '02|__>_++', '03|__>___', '04|______'],
  },
  room, mask, legend,
);
assert.strictEqual(vertical.props.length, 1, 'three stacked cells are one object');
assert.strictEqual(vertical.props[0]!.height, 3);
assert.strictEqual(vertical.props[0]!.width, 1);

// Every way a row gets thrown away, and the fact that it stays local to that row.
const bad = parseLayout(
  {
    furniture: [
      '00|_B_B_',        // one character short
      '01|_B_B__',       // control: a good row
      '02|_B__++',       // good, and leaves both threshold cells alone
      '03|_B_Z__',       // unknown legend character
      '04|_____B',       // control: a good row
    ],
    facing: ['00|_____', '01|______', '02|______', '03|______', '04|______'],
  },
  room, mask, legend,
);
const rows = bad.rejected.map(r => r.row);
assert.ok(rows.includes(0), 'short row rejected');
assert.ok(rows.includes(3), 'unknown character rejected');
assert.ok(!rows.includes(2) && !rows.includes(4), 'good rows survive a bad neighbour');
assert.ok(bad.props.length > 0, 'a partially bad reply still furnishes the room');

// Drawing over the mask's own void / doorway is refused.
const trespass = parseLayout(
  {
    furniture: ['00|BAAAA_', '01|______', '02|_____B', '03|______', '04|______'],
    facing: ['00|------', '01|______', '02|______', '03|______', '04|______'],
  },
  room, mask, legend,
);
assert.ok(trespass.rejected.some(r => r.row === 0 && /wall/.test(r.reason)), 'painting a wall cell is refused');
assert.ok(trespass.rejected.some(r => r.row === 2 && /doorway/.test(r.reason)), 'painting a doorway is refused');

// A misnumbered row is treated as missing rather than silently shifting the room.
const shifted = parseLayout(
  { furniture: ['00|_B____', '02|_B____', '02|_B___+', '03|______', '04|______'], facing: [] },
  room, mask, legend,
);
assert.ok(shifted.rejected.some(r => r.row === 1), 'row numbered 02 in slot 1 is rejected');

// Rule 7: a directional object in a corner is dropped; a non-directional one there is kept.
const cornered = parseLayout(
  {
    furniture: ['00|._____', '01|______', '02|____++', '03|______', '04|B____B'],
    facing: ['00|._____', '01|______', '02|____++', '03|______', '04|v____-'],
  },
  room, mask, legend,
);
assert.strictEqual(cornered.props.length, 1, 'only the non-directional corner object survives');
assert.strictEqual(cornered.props[0]!.x, room.x + 5, 'the survivor is the facing "-" one');
assert.ok(cornered.rejected.some(r => /corner/.test(r.reason)), 'the drop is reported');

console.log('roomLayout selfcheck passed');

// A run is split into units of the object's own size, not taken as one giant object. Regression
// from the first live prototype run, where four booths along a wall parsed as one 20ft booth.
const bigRoom = { id: 'r2', name: 'Big', x: 0, y: 0, width: 12, height: 3 } as DungeonRoom;
const bigCells: number[][] = Array.from({ length: 3 }, () => Array.from({ length: 12 }, () => 1));
const bigMask = renderRoomMask(bigRoom, bigCells, new Set(), new Set());
const runSpecs: PropSpec[] = [
  { noun: 'diner-booth', category: 'seating', description: 'booth', sizeXY: [1, 1] },
  { noun: 'service-counter', category: 'surface', description: 'counter', sizeXY: [1, 3] },
  { noun: 'counter-stool', category: 'seating', description: 'stool', sizeXY: [1, 1] },
];
const runLegend = buildLegend(runSpecs); // A = booth, B = counter, C = stool
const runs = parseLayout(
  { furniture: ['00|AAAA________', '01|BBB_________', '02|CCC_________'], facing: [] },
  bigRoom, bigMask, runLegend,
);
const booths = runs.props.filter(p => p.noun === 'diner-booth');
assert.strictEqual(booths.length, 4, `5ft booth is 1 cell, so "AAAA" is 4 booths, got ${booths.length}`);
assert.ok(booths.every(p => p.width === 1), 'each booth is one cell wide');
assert.deepStrictEqual(booths.map(p => p.x), [0, 1, 2, 3], 'booths sit in adjacent cells');
const counters = runs.props.filter(p => p.noun === 'service-counter');
assert.strictEqual(counters.length, 1, '12ft counter is 2 cells, so 3 drawn cells is one counter drawn slightly long, not a counter plus an offcut');
assert.strictEqual(counters[0]!.width, 3);
assert.strictEqual(runs.props.filter(p => p.noun === 'counter-stool').length, 3, '1.5ft stool is 1 cell, so "CCC" is 3 stools');

console.log('roomLayout run-splitting selfcheck passed');

// Rotation: facing maps clockwise from the canonical 'v', and the drawn footprint wins a disagreement.
assert.strictEqual(rotationFor('v', 1, 2, [1, 2]), 0, 'canonical facing, upright footprint: unrotated');
assert.strictEqual(rotationFor('^', 1, 2, [1, 2]), 180);
assert.strictEqual(rotationFor('<', 2, 1, [1, 2]), 90, 'facing left, lying sideways');
assert.strictEqual(rotationFor('>', 2, 1, [1, 2]), 270);
assert.strictEqual(rotationFor('v', 2, 1, [1, 2]), 90, 'drawn sideways but arrow says down: footprint wins, quarter turn');
assert.strictEqual(rotationFor('>', 1, 2, [1, 2]), 0, 'drawn upright but arrow says sideways: footprint wins, straightened');
assert.strictEqual(rotationFor('>', 1, 1, [1, 1]), 270, 'square objects take the arrow as given');
assert.strictEqual(rotationFor('-', 1, 1, [1, 1]), 0);
const turned = parseLayout(
  { furniture: ['00|____________', '01|_AAA________', '02|____________'], facing: ['00|____________', '01|_<<<________', '02|____________'] },
  bigRoom, bigMask, runLegend,
);
assert.strictEqual(turned.props[0]!.rotation, 90, 'a [1,3] counter drawn 3 across facing left is quarter-turned');
console.log('roomLayout rotation selfcheck passed');

// Vehicles and machinery stand free of the walls, so the corner rule doesn't apply to them.
const lotSpecs: PropSpec[] = [
  { noun: 'sedan', category: 'vehicle', description: 'car', sizeXY: [1, 1] },
  { noun: 'crate', category: 'container', description: 'crate', sizeXY: [1, 1] },
];
const lot = parseLayout(
  {
    furniture: ['00|._____', '01|______', '02|____++', '03|______', '04|A____B'],
    facing: ['00|._____', '01|______', '02|____++', '03|______', '04|^____v'],
  },
  room, mask, buildLegend(lotSpecs),
);
assert.ok(lot.props.some(p => p.noun === 'sedan'), 'a vehicle in a corner is kept');
assert.ok(!lot.props.some(p => p.noun === 'crate'), 'a directional non-exempt object in a corner is still dropped');
console.log('roomLayout corner-exemption selfcheck passed');
