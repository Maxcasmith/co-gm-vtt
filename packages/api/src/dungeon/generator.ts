import { Map as RotMap } from 'rot-js';
import { randomUUID } from 'crypto';
import type { DungeonRoom } from 'shared';
import type { DungeonManifest } from './manifest.ts';

const WIDTH = 50;
const HEIGHT = 50;

export interface GeneratorResult {
  cells: number[][];
  rooms: DungeonRoom[];
}

export function generateGrid(manifest: DungeonManifest | null): GeneratorResult {
  const digger = new RotMap.Digger(WIDTH, HEIGHT, {
    roomWidth: [4, 10] as [number, number],
    roomHeight: [4, 8] as [number, number],
    corridorLength: [2, 6] as [number, number],
    dugPercentage: 0.4,
    timeLimit: 1000,
  });

  // rot-js callback: value 0 = floor, 1 = wall. We invert to: 1 = walkable, 0 = wall.
  const cells: number[][] = Array.from({ length: HEIGHT }, () => new Array<number>(WIDTH).fill(0));
  digger.create((x, y, value) => {
    cells[y]![x] = value === 0 ? 1 : 0;
  });

  const rotRooms = digger.getRooms();

  // Sort ascending by area — smallest rooms map to small manifest entries, largest to large
  const sorted = [...rotRooms].sort((a, b) => {
    const areaA = (a.getRight() - a.getLeft()) * (a.getBottom() - a.getTop());
    const areaB = (b.getRight() - b.getLeft()) * (b.getBottom() - b.getTop());
    return areaA - areaB;
  });

  const manifestRooms = manifest?.rooms ?? [];

  const rooms: DungeonRoom[] = sorted.map((room, i) => ({
    id: randomUUID(),
    name: manifestRooms[i]?.name ?? `Room ${i + 1}`,
    x: room.getLeft(),
    y: room.getTop(),
    width: room.getRight() - room.getLeft() + 1,
    height: room.getBottom() - room.getTop() + 1,
  }));

  return { cells, rooms };
}
