import { randomUUID } from 'crypto';
import type { DungeonRoom } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import type { DungeonManifest } from './manifest.ts';
import { generateGrid, carveCorridor, carveRect, randInt, SIZE_RANGE, type GeneratorResult } from './generator.ts';
import { logError } from '../logger.ts';

const WALL = '-';
const CORRIDOR = '.';

const SIZE_HINT: Record<'small' | 'medium' | 'large', string> = {
  small: 'a small room, a handful of cells across',
  medium: 'a medium room, a modest chamber',
  large: 'a large room, a sizable hall or chamber',
};

function buildGridPrompt(manifest: DungeonManifest, width: number, height: number): string {
  const legend = manifest.rooms.map(r =>
    `- ${r.key} = ${r.name}${r.role ? ` (${r.role})` : ''} — ${SIZE_HINT[r.size]}`
  ).join('\n');

  return `You are a dungeon architect. Draw a top-down floor plan as a character grid, exactly ${height} rows by ${width} columns.

Rooms to place (use ONLY these single-character keys for each room's own floor cells):
${legend}

Rules:
- '${WALL}' = solid rock, not walkable. This MUST be the large majority of the grid — at least 70% of all cells. A dungeon is mostly empty stone with rooms and corridors carved out of it, NOT a floor plan that fills the whole canvas edge to edge. Leave real empty space between rooms.
- '${CORRIDOR}' = a THIN connecting passage, 1-2 cells wide at most, winding through the empty '${WALL}' space between rooms — never a wide open area, never used to fill gaps in bulk
- Each room's letter fills its own floor area — rooms can be irregular, non-rectangular outlines that suit what the room actually is (a nave looks like a nave, a crypt can be an L-shape or a blocky cross), not just plain rectangles, and should be roughly the size implied by their hint above, not stretched to fill available space
- Straight lines and right angles only — every edge of every shape must be horizontal or vertical. Never step diagonally (no cell may touch another cell of the same room only at a corner) — each room cell must share a full edge, not just a corner, with its neighbors
- Leave at least one '${WALL}' cell between two different rooms wherever they'd otherwise touch directly — rooms never share a wall
- Every room must connect to the rest of the complex via '${CORRIDOR}' cells so the whole thing is reachable from the entrance
- EVERY row must be EXACTLY ${width} characters. Output EXACTLY ${height} rows.
- Return ONLY the grid, one row per line — no markdown fences, no explanation, no legend repeated, no blank lines.`;
}

// Row-pad/truncate to the target width, and cap/pad row count to the target height — the LLM's
// output is trusted for shape, never for exact dimensions.
function parseGridLines(raw: string, width: number, height: number): string[] {
  const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
  const rows = lines.slice(0, height).map(l => (l.length > width ? l.slice(0, width) : l.padEnd(width, WALL)));
  while (rows.length < height) rows.push(WALL.repeat(width));
  return rows;
}

interface Box { minX: number; maxX: number; minY: number; maxY: number }

function boundingBoxes(rows: string[]): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === WALL || ch === CORRIDOR) continue;
      const box = boxes.get(ch);
      if (!box) boxes.set(ch, { minX: x, maxX: x, minY: y, maxY: y });
      else {
        box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
      }
    }
  }
  return boxes;
}

// Nearest cell (by simple ring search) already in `reached`, searched outward from (x0, y0).
function nearestReached(reached: Set<string>, x0: number, y0: number, width: number, height: number): { x: number; y: number } | null {
  const key = (x: number, y: number) => `${x},${y}`;
  if (reached.has(key(x0, y0))) return { x: x0, y: y0 };
  const maxRadius = Math.max(width, height);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (reached.has(key(x, y))) return { x, y };
      }
    }
  }
  return null;
}

function floodFillFrom(cells: number[][], x0: number, y0: number, width: number, height: number): Set<string> {
  const key = (x: number, y: number) => `${x},${y}`;
  const seen = new Set<string>();
  if (cells[y0]?.[x0] !== 1) return seen;
  const stack = [[x0, y0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const k = key(x!, y!);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x! + dx!, ny = y! + dy!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (cells[ny]?.[nx] === 1 && !seen.has(key(nx, ny))) stack.push([nx, ny]);
    }
  }
  return seen;
}

// Does every room have at least one floor cell reachable from the entrance?
function allRoomsReachable(cells: number[][], rooms: DungeonRoom[], entranceRoom: DungeonRoom, width: number, height: number): boolean {
  const ecx = entranceRoom.x + Math.floor(entranceRoom.width / 2);
  const ecy = entranceRoom.y + Math.floor(entranceRoom.height / 2);
  const reached = floodFillFrom(cells, ecx, ecy, width, height);
  if (!reached.size) return false;
  return rooms.every(room => {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (reached.has(`${x},${y}`)) return true;
      }
    }
    return false;
  });
}

// Enforces "rooms never share a wall": wherever two different rooms' floor cells are directly
// adjacent (no gap between them), erode the cell belonging to whichever room sorts later — leaves
// exactly one wall cell of separation, eroding only one side so rooms don't shrink from both edges.
// Connectivity-aware: erodes one candidate at a time and reverts it if that erosion would cut a
// room off entirely, leaving a deliberate 1-cell doorway there instead of full separation.
// Runs LAST (after connectivity repair): a repair corridor can just as easily recreate a direct
// touch as the original LLM output can, so this has to see the truly final cell state to catch it.
function separateAdjacentRooms(cells: number[][], rooms: DungeonRoom[], entranceRoom: DungeonRoom | undefined, width: number, height: number): void {
  const ownerOf: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(-1));
  rooms.forEach((room, i) => {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (cells[y]?.[x] === 1) ownerOf[y]![x] = i;
      }
    }
  });

  const candidates: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mine = ownerOf[y]![x]!;
      if (mine === -1) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy!, nx = x + dx!;
        const other = ownerOf[ny]?.[nx];
        if (other === undefined || other === -1 || other === mine) continue;
        if (mine > other) { candidates.push([x, y]); break; }
      }
    }
  }

  for (const [x, y] of candidates) {
    if (!cells[y]) continue;
    cells[y]![x] = 0;
    if (entranceRoom && !allRoomsReachable(cells, rooms, entranceRoom, width, height)) {
      cells[y]![x] = 1; // this cell was load-bearing — leave it as a doorway instead
    }
  }
}

// Enforces "no diagonal-only connections": a 2x2 block where floor cells touch only at a corner
// (a checkerboard pinch) reads as broken on the map and lets movement cut through a wall corner.
// Fills the pinch into a solid 2x2 so the connection is a real shared edge, not a corner.
function fixDiagonalPinches(cells: number[][], width: number, height: number): void {
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = cells[y]![x]!, b = cells[y]![x + 1]!, c = cells[y + 1]![x]!, d = cells[y + 1]![x + 1]!;
      if (a === 1 && d === 1 && b === 0 && c === 0) { cells[y]![x + 1] = 1; cells[y + 1]![x] = 1; }
      else if (b === 1 && c === 1 && a === 0 && d === 0) { cells[y]![x] = 1; cells[y + 1]![x + 1] = 1; }
    }
  }
}

// Drops a small rectangular room (today's algorithmic style) into the first open area found —
// used only when the LLM never drew a room's key at all, so nothing gets silently lost.
function patchMissingRoom(cells: number[][], width: number, height: number, size: 'small' | 'medium' | 'large'): { x: number; y: number; width: number; height: number } | null {
  const [wMin, wMax] = SIZE_RANGE[size];
  const w = randInt(wMin, wMax);
  const h = randInt(wMin, wMax);
  for (let y = 1; y + h < height - 1; y += 2) {
    for (let x = 1; x + w < width - 1; x += 2) {
      let clear = true;
      for (let ry = y; ry < y + h && clear; ry++) {
        for (let rx = x; rx < x + w; rx++) {
          if (cells[ry]?.[rx] === 1) { clear = false; break; }
        }
      }
      if (clear) { carveRect(cells, x, y, w, h); return { x, y, width: w, height: h }; }
    }
  }
  return null;
}

export async function generateOrganicGrid(
  manifest: DungeonManifest,
  adapter: StoryProviderAdapter,
  opts?: { width?: number; height?: number },
  onToken: (t: string) => void = () => {},
): Promise<GeneratorResult> {
  const width = opts?.width ?? 50;
  const height = opts?.height ?? 50;

  try {
    const raw = await adapter.stream(buildGridPrompt(manifest, width, height), onToken);
    const rows = parseGridLines(raw, width, height);
    const boxes = boundingBoxes(rows);

    const cells: number[][] = rows.map(row => row.split('').map(ch => (ch === WALL ? 0 : 1)));

    // Sanity check: a real dungeon is mostly solid rock. If the model ignored the wall-ratio
    // instruction and tiled the whole canvas with floor/corridor, this isn't a usable layout —
    // fall back rather than ship a single undifferentiated square.
    const floorCells = cells.reduce((sum, row) => sum + row.filter(c => c === 1).length, 0);
    const floorRatio = floorCells / (width * height);
    if (floorRatio > 0.6) {
      console.warn(`[dungeon] organic grid came back ${(floorRatio * 100).toFixed(0)}% floor — rejecting, falling back to procedural layout`);
      return generateGrid(manifest, opts);
    }

    const rooms: DungeonRoom[] = [];
    for (const manifestRoom of manifest.rooms) {
      const box = manifestRoom.key ? boxes.get(manifestRoom.key) : undefined;
      if (box) {
        rooms.push({
          id: randomUUID(),
          name: manifestRoom.name,
          x: box.minX, y: box.minY,
          width: box.maxX - box.minX + 1,
          height: box.maxY - box.minY + 1,
          ...(manifestRoom.role ? { role: manifestRoom.role } : {}),
          ...(manifestRoom.theme ? { theme: manifestRoom.theme } : {}),
        });
      } else {
        console.warn(`[dungeon] organic grid never drew room "${manifestRoom.name}" — patching one in`);
        const patched = patchMissingRoom(cells, width, height, manifestRoom.size);
        if (patched) rooms.push({ id: randomUUID(), name: manifestRoom.name, ...patched, ...(manifestRoom.role ? { role: manifestRoom.role } : {}), ...(manifestRoom.theme ? { theme: manifestRoom.theme } : {}) });
      }
    }

    // Guarantee every room is reachable from the entrance, regardless of what the LLM connected.
    const entranceRoom = rooms.find(r => r.role === 'entrance') ?? rooms[0];
    if (entranceRoom) {
      const ecx = entranceRoom.x + Math.floor(entranceRoom.width / 2);
      const ecy = entranceRoom.y + Math.floor(entranceRoom.height / 2);
      let reached = floodFillFrom(cells, ecx, ecy, width, height);
      const roomHasFloorReached = (room: DungeonRoom) => {
        for (let y = room.y; y < room.y + room.height; y++) {
          for (let x = room.x; x < room.x + room.width; x++) {
            if (reached.has(`${x},${y}`)) return true;
          }
        }
        return false;
      };
      for (const room of rooms) {
        if (room.id === entranceRoom.id || roomHasFloorReached(room)) continue;
        const rcx = room.x + Math.floor(room.width / 2);
        const rcy = room.y + Math.floor(room.height / 2);
        const nearest = nearestReached(reached, rcx, rcy, width, height);
        if (nearest) {
          carveCorridor(cells, rcx, rcy, nearest.x, nearest.y);
          reached = floodFillFrom(cells, ecx, ecy, width, height);
        }
      }
    }

    separateAdjacentRooms(cells, rooms, entranceRoom, width, height);
    fixDiagonalPinches(cells, width, height);

    return { cells, rooms };
  } catch (err) {
    logError('dungeon/organicGrid:generateOrganicGrid', err);
    return generateGrid(manifest, opts);
  }
}
