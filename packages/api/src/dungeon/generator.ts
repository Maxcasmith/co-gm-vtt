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
      ...(manifestRoom.theme ? { theme: manifestRoom.theme } : {}),
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
