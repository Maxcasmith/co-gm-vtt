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
  return { rooms, structureType: 'building', theme: 'medieval', goals: [] };
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
  const { cells, rooms } = generateBuildingLayout(manifest, { width: 50, height: 50 });

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
