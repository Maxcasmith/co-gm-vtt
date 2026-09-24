import { randomUUID } from 'crypto';
import type { DungeonEntity, DungeonRoom } from 'shared';
import type { DoorState, DungeonManifest, ManifestRoom } from './manifest.ts';
import {
  SIZE_RANGE,
  carveCorridor,
  carveRect,
  randInt,
  repairConnectivity,
  separateAdjacentRooms,
  fixDiagonalPinches,
  type GeneratorResult,
  type DoorRect,
} from './generator.ts';

const DEFAULT_WIDTH = 50;
const DEFAULT_HEIGHT = 50;
const MARGIN = 1; // keep a border wall around the whole building
const MIN_OVERLAP = 2; // shared wall must be at least this long to fit a door
const FLOOR_GAP = 4; // solid-wall buffer between two floors' blocks on the combined canvas

interface Rect { x: number; y: number; w: number; h: number }

// Two rooms may never be closer than one cell — that cell IS the shared wall, and the doorway
// gets punched through it. pad 1 therefore permits exact-adjacency-with-a-wall, nothing tighter.
function collides(a: Rect, b: Rect, pad = 1): boolean {
  return a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
}

function fits(r: Rect, width: number, height: number): boolean {
  return r.x >= MARGIN && r.y >= MARGIN && r.x + r.w <= width - MARGIN && r.y + r.h <= height - MARGIN;
}

function free(r: Rect, placed: (Rect | undefined)[], width: number, height: number): boolean {
  return fits(r, width, height) && !placed.some(p => p && collides(r, p));
}

// Undirected adjacency, name -> set of names. The LLM often lists an edge from only one side.
function buildGraph(rooms: ManifestRoom[]): Map<string, Set<string>> {
  const byName = new Map(rooms.map(r => [r.name, r]));
  const graph = new Map(rooms.map(r => [r.name, new Set<string>()]));
  for (const room of rooms) {
    for (const other of room.connectsTo ?? []) {
      if (other === room.name || !byName.has(other)) continue; // dangling name — drop it
      graph.get(room.name)!.add(other);
      graph.get(other)!.add(room.name);
    }
  }
  return graph;
}

// Destination rooms are boxy; hallways are strips whose length scales with how much hangs off them.
function footprint(room: ManifestRoom, degree: number, horizontal: boolean, width: number, height: number): { w: number; h: number } {
  if (room.isStairwell) return { w: 2, h: 2 }; // a flight of stairs is a fixed 2x2, whatever "size" claims
  if (!room.isHallway) {
    const [lo, hi] = SIZE_RANGE[room.size];
    return { w: randInt(lo, hi), h: randInt(lo, hi) };
  }
  const thickness = randInt(2, 3);
  const maxLen = Math.min(width, height) - 2 * MARGIN - 4;
  const length = Math.max(8, Math.min(maxLen, degree * 6));
  return horizontal ? { w: length, h: thickness } : { w: thickness, h: length };
}

// Start positions along the parent's edge, best-aligned first, then sliding outward — every
// candidate keeps at least MIN_OVERLAP cells of shared wall so a door always fits.
function offsets(parentStart: number, parentLen: number, childLen: number): number[] {
  const centered = parentStart + Math.floor(parentLen / 2) - Math.floor(childLen / 2);
  const min = parentStart - childLen + MIN_OVERLAP;
  const max = parentStart + parentLen - MIN_OVERLAP;
  const out: number[] = [];
  for (let d = 0; d <= parentLen + childLen; d++) {
    for (const s of d === 0 ? [centered] : [centered - d, centered + d]) {
      if (s >= min && s <= max) out.push(s);
    }
  }
  return out;
}

// Wall-sharing placement: child goes flush against one of the parent's four sides with exactly one
// cell of wall between them. Sides are tried starting from `startSide` so a hallway's rooms fan out
// around it instead of all piling onto its east face.
function placeAdjacent(parent: Rect, size: { w: number; h: number }, placed: (Rect | undefined)[], startSide: number, width: number, height: number): Rect | null {
  for (let i = 0; i < 4; i++) {
    const side = (startSide + i) % 4;
    const along = side === 0 || side === 2 ? offsets(parent.y, parent.h, size.h) : offsets(parent.x, parent.w, size.w);
    for (const s of along) {
      const rect: Rect =
        side === 0 ? { x: parent.x + parent.w + 1, y: s, ...size } // east
        : side === 1 ? { x: s, y: parent.y + parent.h + 1, ...size } // south
        : side === 2 ? { x: parent.x - size.w - 1, y: s, ...size } // west
        : { x: s, y: parent.y - size.h - 1, ...size }; // north
      if (free(rect, placed, width, height)) return rect;
    }
  }
  return null;
}

// Last resort for a room whose parent is boxed in (or that the manifest never connected to
// anything): nearest free slot to the parent, wired up with a corridor afterwards.
function placeAnywhere(size: { w: number; h: number }, placed: (Rect | undefined)[], near: Rect, width: number, height: number): Rect | null {
  const nx = near.x + near.w / 2, ny = near.y + near.h / 2;
  let best: Rect | null = null;
  let bestDist = Infinity;
  for (let y = MARGIN; y + size.h <= height - MARGIN; y++) {
    for (let x = MARGIN; x + size.w <= width - MARGIN; x++) {
      const rect = { x, y, ...size };
      const dist = Math.abs(x + size.w / 2 - nx) + Math.abs(y + size.h / 2 - ny);
      if (dist >= bestDist || !free(rect, placed, width, height)) continue;
      best = rect;
      bestDist = dist;
    }
  }
  return best;
}

// If a and b sit either side of a single wall line, punch a door-sized gap (up to maxLen cells)
// through it — returning the carved rect (for the caller to turn into a Door entity), or null if
// they don't actually share a wall.
function carveDoorway(cells: number[][], a: Rect, b: Rect, maxLen = 2): { x: number; y: number; width: number; height: number } | null {
  const span = (aStart: number, aLen: number, bStart: number, bLen: number) => {
    const from = Math.max(aStart, bStart);
    const to = Math.min(aStart + aLen, bStart + bLen);
    return to - from >= 1 ? { from, len: to - from } : null;
  };

  const vertical = b.x === a.x + a.w + 1 ? a.x + a.w : a.x === b.x + b.w + 1 ? b.x + b.w : null;
  if (vertical !== null) {
    const s = span(a.y, a.h, b.y, b.h);
    if (!s) return null;
    const doorLen = Math.min(maxLen, s.len);
    const y0 = s.from + Math.floor((s.len - doorLen) / 2);
    for (let y = y0; y < y0 + doorLen; y++) cells[y]![vertical] = 1;
    return { x: vertical, y: y0, width: 1, height: doorLen };
  }

  const horizontal = b.y === a.y + a.h + 1 ? a.y + a.h : a.y === b.y + b.h + 1 ? b.y + b.h : null;
  if (horizontal !== null) {
    const s = span(a.x, a.w, b.x, b.w);
    if (!s) return null;
    const doorLen = Math.min(maxLen, s.len);
    const x0 = s.from + Math.floor((s.len - doorLen) / 2);
    for (let x = x0; x < x0 + doorLen; x++) cells[horizontal]![x] = 1;
    return { x: x0, y: horizontal, width: doorLen, height: 1 };
  }

  return null;
}

/** Width of a 'none' connection — an open way through, not a door. */
const OPEN_WAY_CELLS = 4;

const center = (r: Rect) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

// A room-pair's door state/key, if either side of the edge declared one via ManifestRoom.doors
// (see manifest.ts's per-room "doors" schema, validated against real loot names there already —
// this just carries the already-validated name through, unresolved to a real id until placement).
// Only one side typically declares an edge, but if both do and disagree, the more restrictive
// state wins — a lock should never be silently loosened by the other room's laxer entry.
const RESTRICTIVENESS: Record<DoorState, number> = { none: -1, open: 0, closed: 1, locked: 2 };

function lockFor(roomA: ManifestRoom, roomB: ManifestRoom): { doorState: DoorState; keyName?: string; lockpickDC?: number } | null {
  const fromA = roomA.doors?.find(d => d.toRoom === roomB.name);
  const fromB = roomB.doors?.find(d => d.toRoom === roomA.name);
  const candidates = [fromA, fromB].filter((d): d is NonNullable<typeof d> => !!d);
  if (!candidates.length) return null;
  const winner = candidates.reduce((best, cur) =>
    RESTRICTIVENESS[cur.state ?? 'closed'] > RESTRICTIVENESS[best.state ?? 'closed'] ? cur : best);
  return {
    doorState: winner.state ?? 'closed',
    ...(winner.keyName ? { keyName: winner.keyName } : {}),
    ...(winner.lockpickDC ? { lockpickDC: winner.lockpickDC } : {}),
  };
}

/**
 * Floor-plan layout for ONE floor of a man-made structure. Walks that floor's room adjacency graph
 * breadth-first from the entrance and packs each room flush against the parent that discovered it,
 * so rooms that are supposed to open onto each other actually share a wall — a school reads as a
 * school, not a cave. Multi-floor stitching is generateBuildingLayout's job, below.
 */
function layoutOneFloor(manifestRooms: ManifestRoom[], opts?: { width?: number; height?: number }): GeneratorResult {
  const width = opts?.width ?? DEFAULT_WIDTH;
  const height = opts?.height ?? DEFAULT_HEIGHT;
  const cells: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0));

  if (!manifestRooms.length) return { cells, rooms: [] };

  const graph = buildGraph(manifestRooms);
  const indexOf = new Map(manifestRooms.map((r, i) => [r.name, i]));
  const rects: (Rect | undefined)[] = new Array(manifestRooms.length);
  const childCount = new Array<number>(manifestRooms.length).fill(0);
  const corridorTo: number[][] = []; // [child, parent] pairs that couldn't share a wall

  // Only the ground floor tends to have an entrance; an upper floor's anchor is its stairwell.
  const startIndex = Math.max(0, [
    manifestRooms.findIndex(r => r.role === 'entrance'),
    manifestRooms.findIndex(r => r.isStairwell),
  ].find(i => i >= 0) ?? 0);

  const sizeFor = (i: number, horizontal: boolean) =>
    footprint(manifestRooms[i]!, graph.get(manifestRooms[i]!.name)!.size, horizontal, width, height);

  // Entrance anchors the plan at the middle of the canvas so the building can grow any direction.
  const first = sizeFor(startIndex, true);
  rects[startIndex] = {
    x: Math.floor((width - first.w) / 2),
    y: Math.floor((height - first.h) / 2),
    ...first,
  };

  const place = (i: number, parentIndex: number): void => {
    const parent = rects[parentIndex]!;
    // A hallway hanging off a wide parent wants to run the other way, so rooms line both its faces.
    const preferHorizontal = parent.w <= parent.h;
    const size = sizeFor(i, preferHorizontal);
    const alt = sizeFor(i, !preferHorizontal);
    const startSide = (childCount[parentIndex] ?? 0) % 4;
    childCount[parentIndex] = (childCount[parentIndex] ?? 0) + 1;

    const rect =
      placeAdjacent(parent, size, rects, startSide, width, height) ??
      (manifestRooms[i]!.isHallway ? placeAdjacent(parent, alt, rects, startSide, width, height) : null);
    if (rect) {
      rects[i] = rect;
      return;
    }

    const loose = placeAnywhere(size, rects, parent, width, height) ?? placeAnywhere({ w: 3, h: 3 }, rects, parent, width, height);
    if (!loose) {
      console.warn(`[dungeon] building layout had no room left for "${manifestRooms[i]!.name}"`);
      return;
    }
    rects[i] = loose;
    corridorTo.push([i, parentIndex]);
  };

  // BFS from the entrance; then repeat for anything the graph never reached (a room the LLM left
  // with no connectsTo at all still gets a home, hung off the entrance).
  const queue: number[] = [startIndex];
  for (let seed = 0; seed < manifestRooms.length; seed++) {
    if (!queue.length) {
      if (rects[seed]) continue;
      place(seed, startIndex);
      if (!rects[seed]) continue;
      corridorTo.push([seed, startIndex]);
      queue.push(seed);
    }
    while (queue.length) {
      const current = queue.shift()!;
      for (const neighborName of graph.get(manifestRooms[current]!.name)!) {
        const n = indexOf.get(neighborName)!;
        if (rects[n]) continue;
        place(n, current);
        if (rects[n]) queue.push(n);
      }
    }
  }

  const rooms: DungeonRoom[] = [];
  manifestRooms.forEach((manifestRoom, i) => {
    const rect = rects[i];
    if (!rect) return;
    carveRect(cells, rect.x, rect.y, rect.w, rect.h);
    const connections = [...graph.get(manifestRoom.name)!];
    rooms.push({
      id: randomUUID(),
      name: manifestRoom.name,
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      ...(manifestRoom.role ? { role: manifestRoom.role } : {}),
      ...(manifestRoom.material ? { material: manifestRoom.material } : {}),
      ...(manifestRoom.isHallway ? { isHallway: true } : {}),
      ...(manifestRoom.floor ? { floor: manifestRoom.floor } : {}),
      ...(manifestRoom.isStairwell ? { isStairwell: true } : {}),
      ...(connections.length ? { connectsTo: connections } : {}),
      ...(manifestRoom.description && manifestRoom.role !== 'entrance' ? { description: manifestRoom.description } : {}),
      ...(manifestRoom.dressing?.length ? { dressing: manifestRoom.dressing } : {}),
      ...(manifestRoom.hiddenDressing?.length ? { hiddenDressing: manifestRoom.hiddenDressing.map(d => ({ ...d, discovered: false })) } : {}),
    });
  });

  // Every graph edge whose rooms ended up wall-to-wall becomes a door — including edges the BFS
  // tree didn't use, which is what gives a floor plan its loops. `graph` is undirected but stores
  // both directions of each edge, so carveDoorway(a,b) and carveDoorway(b,a) would otherwise both
  // fire for the same wall — carvedPairs keeps that down to one Door entity per edge.
  const doors: DoorRect[] = [];
  const carvedPairs = new Set<string>();
  for (const [name, neighbors] of graph) {
    const a = rects[indexOf.get(name)!];
    if (!a) continue;
    for (const neighborName of neighbors) {
      const pairKey = [name, neighborName].sort().join('|');
      if (carvedPairs.has(pairKey)) continue;
      carvedPairs.add(pairKey);
      const b = rects[indexOf.get(neighborName)!];
      if (!b) continue;
      const lock = lockFor(manifestRooms[indexOf.get(name)!]!, manifestRooms[indexOf.get(neighborName)!]!);
      // 'none' is an open way through with no Door entity — carved wider, since nothing has to
      // swing in it and a street meeting a parking lot through a door-width gap reads as a wall.
      const door = carveDoorway(cells, a, b, lock?.doorState === 'none' ? OPEN_WAY_CELLS : 2);
      if (!door || lock?.doorState === 'none') continue;
      doors.push(lock ? { ...door, ...lock, doorState: lock.doorState } : door);
    }
  }

  for (const [child, parent] of corridorTo) {
    const from = center(rects[child!]!), to = center(rects[parent!]!);
    carveCorridor(cells, from.x, from.y, to.x, to.y);
  }

  const entranceRoom = rooms.find(r => r.role === 'entrance') ?? rooms[0];
  if (entranceRoom) {
    repairConnectivity(cells, rooms, entranceRoom, width, height);
    // Rooms that open onto each other are MEANT to touch — only pry apart accidental neighbours.
    const connected = (a: DungeonRoom, b: DungeonRoom) => !!graph.get(a.name)?.has(b.name);
    separateAdjacentRooms(cells, rooms, entranceRoom, width, height, connected);
  }
  fixDiagonalPinches(cells, width, height);

  return { cells, rooms, doors };
}

/**
 * Floor-plan layout for man-made structures. Each distinct ManifestRoom.floor gets its own complete
 * layout pass (repair/separate/pinch-fix all run per floor, never on the combined grid — running them
 * after stitching would carve a corridor straight through the wall buffer and undo the isolation),
 * then the blocks are laid out left-to-right in one horizontal strip separated by FLOOR_GAP cells of
 * solid wall. Floors connect only through the paired 'stairs' entities returned alongside.
 *
 * A single-floor manifest — i.e. every manifest that predates floors — takes the fast path and comes
 * back from layoutOneFloor completely untouched.
 */
export function generateBuildingLayout(manifest: DungeonManifest, opts?: { width?: number; height?: number }): GeneratorResult {
  const byFloor = new Map<number, ManifestRoom[]>();
  for (const room of manifest.rooms) {
    const floor = room.floor ?? 0;
    const bucket = byFloor.get(floor);
    if (bucket) bucket.push(room);
    else byFloor.set(floor, [room]);
  }

  if (byFloor.size <= 1) return layoutOneFloor(manifest.rooms, opts);

  const blocks = [...byFloor.entries()].sort((a, b) => a[0] - b[0]).map(([, rooms]) => layoutOneFloor(rooms, opts));

  // Top-aligned strip: shorter floors just leave wall cells below them.
  const height = Math.max(...blocks.map(b => b.cells.length));
  const width = blocks.reduce((sum, b) => sum + (b.cells[0]?.length ?? 0), 0) + FLOOR_GAP * (blocks.length - 1);
  const cells: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0));

  const rooms: DungeonRoom[] = [];
  const doors: DoorRect[] = [];
  let originX = 0;
  for (const block of blocks) {
    block.cells.forEach((row, y) => row.forEach((cell, x) => { if (cell) cells[y]![originX + x] = cell; }));
    for (const room of block.rooms) rooms.push({ ...room, x: room.x + originX });
    for (const door of block.doors ?? []) doors.push({ ...door, x: door.x + originX });
    originX += (block.cells[0]?.length ?? 0) + FLOOR_GAP;
  }

  // Stair pairing is edge-based, not reciprocal-declaration-based: manifest.ts only guarantees that a
  // declared stairsTo points at a real isStairwell room, so A may name B while B names nobody.
  // Dedupe by sorted name pair, same as the door edges above.
  const placedByName = new Map(rooms.map(r => [r.name, r]));
  const pairs = new Map<string, [string, string]>();
  for (const room of manifest.rooms) {
    if (!room.isStairwell || !room.stairsTo) continue;
    pairs.set([room.name, room.stairsTo].sort().join('|'), [room.name, room.stairsTo]);
  }

  const stairs: DungeonEntity[] = [];
  for (const [nameA, nameB] of pairs.values()) {
    const a = placedByName.get(nameA), b = placedByName.get(nameB);
    if (!a || !b) continue; // a room the layout had no space for — skip rather than emit a half-pair
    const idA = randomUUID(), idB = randomUUID();
    stairs.push(
      { id: idA, type: 'stairs', x: a.x, y: a.y, width: 2, height: 2, name: 'Stairs', discovered: true, linkTo: idB },
      { id: idB, type: 'stairs', x: b.x, y: b.y, width: 2, height: 2, name: 'Stairs', discovered: true, linkTo: idA },
    );
  }

  return { cells, rooms, doors, stairs };
}
