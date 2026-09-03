// Standalone invariant check for generateBuildingLayout — no test framework in this repo, so this
// is the one runnable check: `tsx src/dungeon/buildingLayout.selfcheck.ts` from packages/api.
// Asserts, over many randomized manifests: no room dropped, no overlaps, every room in bounds,
// every room reachable from the entrance.
import { generateBuildingLayout } from './buildingLayout.ts';
import type { DungeonManifest, ManifestRoom } from './manifest.ts';

function schoolManifest(): DungeonManifest {
  const rooms: ManifestRoom[] = [
    { name: 'Entrance', size: 'medium', role: 'entrance', connectsTo: ['Main Hallway'] },
    { name: 'Main Hallway', size: 'medium', isHallway: true, connectsTo: ['Entrance', 'Classroom A', 'Classroom B', 'Gym', 'Cafeteria', 'Back Hallway'] },
    { name: 'Classroom A', size: 'medium', connectsTo: ['Main Hallway'] },
    { name: 'Classroom B', size: 'medium', connectsTo: ['Main Hallway'] },
    { name: 'Gym', size: 'large', connectsTo: ['Main Hallway', 'Locker Room'] },
    { name: 'Locker Room', size: 'small', connectsTo: ['Gym'] },
    { name: 'Cafeteria', size: 'large', connectsTo: ['Main Hallway', 'Kitchen'] },
    { name: 'Kitchen', size: 'small', connectsTo: ['Cafeteria'] },
    { name: 'Back Hallway', size: 'small', isHallway: true, connectsTo: ['Main Hallway', 'Fire Exit', 'Janitor Closet'] },
    { name: 'Fire Exit', size: 'small', role: 'exit', connectsTo: ['Back Hallway'] },
    { name: 'Janitor Closet', size: 'small', connectsTo: ['Back Hallway'] },
    // no connectsTo at all — must still get placed, not dropped
    { name: 'Storage', size: 'small' },
    // dangling reference — must be dropped without crashing
    { name: 'Rooftop', size: 'small', connectsTo: ['Nonexistent Room'] },
  ];
  return { rooms, structureType: 'building', theme: 'medieval', questChain: [], illumination: 1, materials: [], props: [] };
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function reachableFrom(cells: number[][], sx: number, sy: number, width: number, height: number): Set<string> {
  const seen = new Set<string>();
  const stack: [number, number][] = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const key = `${x},${y}`;
    if (seen.has(key) || x < 0 || y < 0 || x >= width || y >= height || cells[y]?.[x] !== 1) continue;
    seen.add(key);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return seen;
}

const ITERATIONS = 50;
const manifest = schoolManifest();
const expectedNames = new Set(manifest.rooms.map(r => r.name)); // every room, including the dangling-ref one, must be placed via fallback

for (let i = 0; i < ITERATIONS; i++) {
  const { cells, rooms, doors } = generateBuildingLayout(manifest, { width: 50, height: 50 });

  // Every door rect must sit on carved floor, in bounds, and no two doors may share a cell —
  // a dedup failure (the undirected graph edge counted from both sides) would double up exactly
  // one of these.
  const doorCells = new Set<string>();
  for (const door of doors ?? []) {
    for (let dy = 0; dy < door.height; dy++) {
      for (let dx = 0; dx < door.width; dx++) {
        const x = door.x + dx, y = door.y + dy;
        if (x < 0 || y < 0 || x >= 50 || y >= 50 || cells[y]?.[x] !== 1) {
          throw new Error(`iteration ${i}: door at (${x},${y}) isn't carved floor`);
        }
        const key = `${x},${y}`;
        if (doorCells.has(key)) throw new Error(`iteration ${i}: two doors both claim (${x},${y})`);
        doorCells.add(key);
      }
    }
  }

  const gotNames = new Set(rooms.map(r => r.name));
  for (const name of expectedNames) {
    if (!gotNames.has(name)) throw new Error(`iteration ${i}: room "${name}" was dropped`);
  }

  for (let a = 0; a < rooms.length; a++) {
    const ra = rooms[a]!;
    if (ra.x < 0 || ra.y < 0 || ra.x + ra.width > 50 || ra.y + ra.height > 50) {
      throw new Error(`iteration ${i}: room "${ra.name}" out of bounds (${ra.x},${ra.y} ${ra.width}x${ra.height})`);
    }
    for (let b = a + 1; b < rooms.length; b++) {
      if (overlaps(ra, rooms[b]!)) throw new Error(`iteration ${i}: rooms "${ra.name}" and "${rooms[b]!.name}" overlap`);
    }
  }

  const entrance = rooms.find(r => r.role === 'entrance')!;
  const reached = reachableFrom(cells, entrance.x + Math.floor(entrance.width / 2), entrance.y + Math.floor(entrance.height / 2), 50, 50);
  for (const room of rooms) {
    let ok = false;
    for (let y = room.y; y < room.y + room.height && !ok; y++) {
      for (let x = room.x; x < room.x + room.width && !ok; x++) {
        if (reached.has(`${x},${y}`)) ok = true;
      }
    }
    if (!ok) throw new Error(`iteration ${i}: room "${room.name}" not reachable from entrance`);
  }
}

console.log(`buildingLayout selfcheck: ${ITERATIONS} iterations OK — no drops, no overlaps, all in bounds, all reachable.`);

// ---------------------------------------------------------------------------
// Multi-floor: two floor blocks stitched side by side, joined only by a stairs pair.
// ---------------------------------------------------------------------------

function townhouseManifest(): DungeonManifest {
  const rooms: ManifestRoom[] = [
    // floor 0 (field omitted on purpose for some rooms — omitted must mean floor 0)
    { name: 'Front Door', size: 'medium', role: 'entrance', connectsTo: ['Parlour'] },
    { name: 'Parlour', size: 'large', connectsTo: ['Front Door', 'Kitchen', 'Lower Stairs'] },
    { name: 'Kitchen', size: 'medium', floor: 0, connectsTo: ['Parlour'] },
    { name: 'Lower Stairs', size: 'small', floor: 0, isStairwell: true, stairsTo: 'Upper Stairs', connectsTo: ['Parlour'] },
    // floor 1
    { name: 'Upper Stairs', size: 'small', floor: 1, isStairwell: true, stairsTo: 'Lower Stairs', connectsTo: ['Landing'] },
    { name: 'Landing', size: 'medium', floor: 1, isHallway: true, connectsTo: ['Upper Stairs', 'Bedroom', 'Study'] },
    { name: 'Bedroom', size: 'large', floor: 1, connectsTo: ['Landing'] },
    { name: 'Study', size: 'medium', floor: 1, connectsTo: ['Landing'] },
  ];
  return { rooms, structureType: 'building', theme: 'medieval', questChain: [], illumination: 1, materials: [], props: [] };
}

const multi = townhouseManifest();
const upperNames = new Set(multi.rooms.filter(r => (r.floor ?? 0) === 1).map(r => r.name));

for (let i = 0; i < ITERATIONS; i++) {
  const { cells, rooms, stairs } = generateBuildingLayout(multi, { width: 50, height: 50 });
  const w = cells[0]!.length, h = cells.length;

  if (rooms.length !== multi.rooms.length) {
    throw new Error(`multi-floor iteration ${i}: placed ${rooms.length} rooms, expected ${multi.rooms.length}`);
  }

  for (const room of rooms) {
    if (room.x < 0 || room.y < 0 || room.x + room.width > w || room.y + room.height > h) {
      throw new Error(`multi-floor iteration ${i}: room "${room.name}" out of combined bounds (${room.x},${room.y} ${room.width}x${room.height}) on ${w}x${h}`);
    }
    if (room.isStairwell && (room.width !== 2 || room.height !== 2)) {
      throw new Error(`multi-floor iteration ${i}: stairwell "${room.name}" is ${room.width}x${room.height}, expected 2x2`);
    }
  }

  // The two floors must be completely isolated — no walkable path between them.
  const entrance = rooms.find(r => r.role === 'entrance')!;
  const reached = reachableFrom(cells, entrance.x + Math.floor(entrance.width / 2), entrance.y + Math.floor(entrance.height / 2), w, h);
  for (const room of rooms) {
    if (!upperNames.has(room.name)) continue;
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (reached.has(`${x},${y}`)) throw new Error(`multi-floor iteration ${i}: upper-floor room "${room.name}" is walkable from the ground-floor entrance`);
      }
    }
  }

  if (stairs?.length !== 2) throw new Error(`multi-floor iteration ${i}: expected 2 stairs entities, got ${stairs?.length ?? 0}`);
  const s0 = stairs[0]!, s1 = stairs[1]!;
  if (s0.type !== 'stairs' || s1.type !== 'stairs') throw new Error(`multi-floor iteration ${i}: stairs entities have the wrong type`);
  if (s0.linkTo !== s1.id || s1.linkTo !== s0.id) throw new Error(`multi-floor iteration ${i}: stairs linkTo isn't reciprocal`);
  for (const s of stairs) {
    const room = rooms.find(r => r.x === s.x && r.y === s.y && r.isStairwell);
    if (!room) throw new Error(`multi-floor iteration ${i}: stairs entity at (${s.x},${s.y}) doesn't sit on a stairwell room`);
  }
}

// manifest.ts only validates stairsTo one-directionally, so A may name B while B names nobody back.
// Pairing is edge-based, so that still yields exactly one pair.
const oneWay: DungeonManifest = {
  ...multi,
  rooms: multi.rooms.map(r => {
    if (r.name !== 'Upper Stairs') return r;
    const { stairsTo: _dropped, ...rest } = r; // exactOptionalPropertyTypes — omit the key, don't set undefined
    return rest;
  }),
};
const oneWayStairs = generateBuildingLayout(oneWay, { width: 50, height: 50 }).stairs;
if (oneWayStairs?.length !== 2) throw new Error(`one-directional stairsTo: expected 2 stairs entities, got ${oneWayStairs?.length ?? 0}`);

console.log(`buildingLayout multi-floor selfcheck: ${ITERATIONS} iterations OK — no drops, stairwells 2x2, floors isolated, stairs paired reciprocally.`);
