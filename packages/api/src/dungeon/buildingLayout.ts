import { randomUUID } from 'crypto';
import type { DungeonRoom } from 'shared';
import type { DungeonManifest, ManifestRoom } from './manifest.ts';
import {
  SIZE_RANGE,
  carveCorridor,
  carveRect,
  randInt,
  repairConnectivity,
  separateAdjacentRooms,
  fixDiagonalPinches,
  type GeneratorResult,
} from './generator.ts';

const DEFAULT_WIDTH = 50;
const DEFAULT_HEIGHT = 50;
const MARGIN = 1; // keep a border wall around the whole building
const MIN_OVERLAP = 2; // shared wall must be at least this long to fit a door

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

// If a and b sit either side of a single wall line, punch a 1-2 cell door through it.
function carveDoorway(cells: number[][], a: Rect, b: Rect): boolean {
  const span = (aStart: number, aLen: number, bStart: number, bLen: number) => {
    const from = Math.max(aStart, bStart);
    const to = Math.min(aStart + aLen, bStart + bLen);
    return to - from >= 1 ? { from, len: to - from } : null;
  };

  const vertical = b.x === a.x + a.w + 1 ? a.x + a.w : a.x === b.x + b.w + 1 ? b.x + b.w : null;
  if (vertical !== null) {
    const s = span(a.y, a.h, b.y, b.h);
    if (!s) return false;
    const doorLen = Math.min(2, s.len);
    const y0 = s.from + Math.floor((s.len - doorLen) / 2);
    for (let y = y0; y < y0 + doorLen; y++) cells[y]![vertical] = 1;
    return true;
  }

  const horizontal = b.y === a.y + a.h + 1 ? a.y + a.h : a.y === b.y + b.h + 1 ? b.y + b.h : null;
  if (horizontal !== null) {
    const s = span(a.x, a.w, b.x, b.w);
    if (!s) return false;
    const doorLen = Math.min(2, s.len);
    const x0 = s.from + Math.floor((s.len - doorLen) / 2);
    for (let x = x0; x < x0 + doorLen; x++) cells[horizontal]![x] = 1;
    return true;
  }

  return false;
}

const center = (r: Rect) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/**
 * Floor-plan layout for man-made structures. Walks the manifest's room adjacency graph breadth-first
 * from the entrance and packs each room flush against the parent that discovered it, so rooms that
 * are supposed to open onto each other actually share a wall — a school reads as a school, not a cave.
 */
export function generateBuildingLayout(manifest: DungeonManifest, opts?: { width?: number; height?: number }): GeneratorResult {
  const width = opts?.width ?? DEFAULT_WIDTH;
  const height = opts?.height ?? DEFAULT_HEIGHT;
  const cells: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0));

  const manifestRooms = manifest.rooms;
  if (!manifestRooms.length) return { cells, rooms: [] };

  const graph = buildGraph(manifestRooms);
  const indexOf = new Map(manifestRooms.map((r, i) => [r.name, i]));
  const rects: (Rect | undefined)[] = new Array(manifestRooms.length);
  const childCount = new Array<number>(manifestRooms.length).fill(0);
  const corridorTo: number[][] = []; // [child, parent] pairs that couldn't share a wall

  const startIndex = Math.max(0, manifestRooms.findIndex(r => r.role === 'entrance'));

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
      ...(manifestRoom.theme ? { theme: manifestRoom.theme } : {}),
      ...(manifestRoom.isHallway ? { isHallway: true } : {}),
      ...(connections.length ? { connectsTo: connections } : {}),
    });
  });

  // Every graph edge whose rooms ended up wall-to-wall becomes a door — including edges the BFS
  // tree didn't use, which is what gives a floor plan its loops.
  for (const [name, neighbors] of graph) {
    const a = rects[indexOf.get(name)!];
    if (!a) continue;
    for (const neighborName of neighbors) {
      const b = rects[indexOf.get(neighborName)!];
      if (b) carveDoorway(cells, a, b);
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

  return { cells, rooms };
}
