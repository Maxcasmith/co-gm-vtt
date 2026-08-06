import { randomUUID } from 'crypto';
import type { DungeonRoom } from 'shared';
import type { DungeonManifest } from './manifest.ts';

const DEFAULT_WIDTH = 50;
const DEFAULT_HEIGHT = 50;
const PAD = 2; // min gap between rooms so walls stay visible

export const SIZE_RANGE: Record<'small' | 'medium' | 'large', [number, number]> = {
  small: [4, 6],
  medium: [6, 9],
  large: [9, 13],
};

export interface GeneratorResult {
  cells: number[][];
  rooms: DungeonRoom[];
}

export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function carveRect(cells: number[][], x: number, y: number, w: number, h: number): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      cells[row]![col] = 1;
    }
  }
}

// 1-wide L-shaped corridor between two points — simple, guarantees connectivity without a pathfinder
export function carveCorridor(cells: number[][], x1: number, y1: number, x2: number, y2: number): void {
  const lo = (a: number, b: number) => Math.min(a, b);
  const hi = (a: number, b: number) => Math.max(a, b);
  for (let col = lo(x1, x2); col <= hi(x1, x2); col++) cells[y1]![col] = 1;
  for (let row = lo(y1, y2); row <= hi(y1, y2); row++) cells[row]![x2] = 1;
}

// Places each manifest room in reading order (row-packed, padded), then chains them together
// with straight corridors in list order. Trades topology variety for a guaranteed-connected,
// guaranteed-exact room list — the manifest, not the algorithm, decides what rooms exist.
export function generateGrid(manifest: DungeonManifest, opts?: { width?: number; height?: number }): GeneratorResult {
  const WIDTH = opts?.width ?? DEFAULT_WIDTH;
  const HEIGHT = opts?.height ?? DEFAULT_HEIGHT;
  const cells: number[][] = Array.from({ length: HEIGHT }, () => new Array<number>(WIDTH).fill(0));
  const rooms: DungeonRoom[] = [];
  const centers: { x: number; y: number }[] = [];

  let cursorX = PAD;
  let cursorY = PAD;
  let rowHeight = 0;

  for (const manifestRoom of manifest.rooms) {
    const [wMin, wMax] = SIZE_RANGE[manifestRoom.size];
    const [hMin, hMax] = SIZE_RANGE[manifestRoom.size];
    const w = randInt(wMin, wMax);
    const h = randInt(hMin, hMax);

    if (cursorX + w + PAD > WIDTH) {
      cursorX = PAD;
      cursorY += rowHeight + PAD;
      rowHeight = 0;
    }
    if (cursorY + h + PAD > HEIGHT) break; // out of grid — drop remaining rooms rather than overflow

    carveRect(cells, cursorX, cursorY, w, h);
    rooms.push({
      id: randomUUID(),
      name: manifestRoom.name,
      x: cursorX,
      y: cursorY,
      width: w,
      height: h,
      ...(manifestRoom.role ? { role: manifestRoom.role } : {}),
      ...(manifestRoom.material ? { material: manifestRoom.material } : {}),
    });
    centers.push({ x: cursorX + Math.floor(w / 2), y: cursorY + Math.floor(h / 2) });

    cursorX += w + PAD;
    rowHeight = Math.max(rowHeight, h);
  }

  for (let i = 0; i < centers.length - 1; i++) {
    carveCorridor(cells, centers[i]!.x, centers[i]!.y, centers[i + 1]!.x, centers[i + 1]!.y);
  }

  return { cells, rooms };
}

// ---------------------------------------------------------------------------
// Layout repair helpers — shared by every layout strategy (procedural, organic,
// building). Whatever draws the rooms, these make the result actually playable.
// ---------------------------------------------------------------------------

export function floodFillFrom(cells: number[][], x0: number, y0: number, width: number, height: number): Set<string> {
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

// Nearest cell (by simple ring search) already in `reached`, searched outward from (x0, y0).
export function nearestReached(reached: Set<string>, x0: number, y0: number, width: number, height: number): { x: number; y: number } | null {
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

function roomHasReachedCell(room: DungeonRoom, reached: Set<string>): boolean {
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (reached.has(`${x},${y}`)) return true;
    }
  }
  return false;
}

// Does every room have at least one floor cell reachable from the entrance?
function allRoomsReachable(cells: number[][], rooms: DungeonRoom[], entranceRoom: DungeonRoom, width: number, height: number): boolean {
  const ecx = entranceRoom.x + Math.floor(entranceRoom.width / 2);
  const ecy = entranceRoom.y + Math.floor(entranceRoom.height / 2);
  const reached = floodFillFrom(cells, ecx, ecy, width, height);
  if (!reached.size) return false;
  return rooms.every(room => roomHasReachedCell(room, reached));
}

// Guarantees every room is reachable from the entrance: any room the flood fill can't see gets a
// straight L-corridor cut from its center to the nearest already-reachable floor cell.
export function repairConnectivity(cells: number[][], rooms: DungeonRoom[], entranceRoom: DungeonRoom, width: number, height: number): void {
  const ecx = entranceRoom.x + Math.floor(entranceRoom.width / 2);
  const ecy = entranceRoom.y + Math.floor(entranceRoom.height / 2);
  let reached = floodFillFrom(cells, ecx, ecy, width, height);
  for (const room of rooms) {
    if (room.id === entranceRoom.id || roomHasReachedCell(room, reached)) continue;
    const rcx = room.x + Math.floor(room.width / 2);
    const rcy = room.y + Math.floor(room.height / 2);
    const nearest = nearestReached(reached, rcx, rcy, width, height);
    if (!nearest) continue;
    carveCorridor(cells, rcx, rcy, nearest.x, nearest.y);
    reached = floodFillFrom(cells, ecx, ecy, width, height);
  }
}

// Enforces "rooms never share a wall": wherever two different rooms' floor cells are directly
// adjacent (no gap between them), erode the cell belonging to whichever room sorts later — leaves
// exactly one wall cell of separation, eroding only one side so rooms don't shrink from both edges.
// Connectivity-aware: erodes one candidate at a time and reverts it if that erosion would cut a
// room off entirely, leaving a deliberate 1-cell doorway there instead of full separation.
// Runs LAST (after connectivity repair): a repair corridor can just as easily recreate a direct
// touch as the original layout can, so this has to see the truly final cell state to catch it.
// `keepTouching` opts a pair out entirely — building layouts use it so two rooms that are supposed
// to open onto each other keep their shared-wall doorway instead of being pried apart.
export function separateAdjacentRooms(
  cells: number[][],
  rooms: DungeonRoom[],
  entranceRoom: DungeonRoom | undefined,
  width: number,
  height: number,
  keepTouching?: (a: DungeonRoom, b: DungeonRoom) => boolean,
): void {
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
        if (mine <= other) continue;
        if (keepTouching?.(rooms[mine]!, rooms[other]!)) continue;
        candidates.push([x, y]);
        break;
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
export function fixDiagonalPinches(cells: number[][], width: number, height: number): void {
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = cells[y]![x]!, b = cells[y]![x + 1]!, c = cells[y + 1]![x]!, d = cells[y + 1]![x + 1]!;
      if (a === 1 && d === 1 && b === 0 && c === 0) { cells[y]![x + 1] = 1; cells[y + 1]![x] = 1; }
      else if (b === 1 && c === 1 && a === 0 && d === 0) { cells[y]![x] = 1; cells[y + 1]![x + 1] = 1; }
    }
  }
}
