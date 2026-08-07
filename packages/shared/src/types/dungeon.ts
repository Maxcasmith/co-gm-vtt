import type { EnemyStatBlock } from "./combat.ts";

export const DUNGEON_MATERIALS = ["grass", "wood", "stone"] as const;
export type DungeonMaterial = (typeof DUNGEON_MATERIALS)[number];

export const DUNGEON_STYLE_PACKS = ["high_fantasy", "medieval", "dark"] as const;
export type DungeonStylePack = (typeof DUNGEON_STYLE_PACKS)[number];

export type DungeonStructureType = "building" | "organic";

export interface DungeonRoom {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role?: "entrance" | "exit";
  material?: DungeonMaterial;
  isHallway?: boolean;
  connectsTo?: string[];
  description?: string;
  visited?: boolean;
}

export interface DungeonEntity {
  id: string;
  type: "creature" | "loot" | "trap";
  x: number;
  y: number;
  name: string;
  discovered: boolean;
  hideDC?: number;
  statBlock?: EnemyStatBlock;
}

export interface Dungeon {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: number[][];
  rooms: DungeonRoom[];
  entities: DungeonEntity[];
  positions?: Record<string, { gx: number; gy: number }>;
  arena?: boolean;
  goals?: string[];
  theme?: DungeonStylePack;
  structureType?: DungeonStructureType;
}

// Bresenham line-of-sight — a wall cell (anything but floor, `1`) anywhere between viewer and
// target blocks the target. The wall cell itself stays visible: you can see the wall you're
// looking at, not through it.
export function hasLineOfSight(
  cells: number[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0,
    y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) break;
    if (cells[y]?.[x] !== 1) return false;
  }
  return true;
}

// Steps a target 5 ft at a time away from (push) or toward (pull) an origin point, stopping
// at the first wall cell or occupied cell rather than teleporting through obstacles. `occupied`
// is a set of "gx,gy" keys for every other token's cell (same string-set idiom used for
// reachable-cell highlighting client-side).
export function resolveForcedMovement(
  cells: number[][] | undefined,
  occupied: Set<string>,
  fromGx: number,
  fromGy: number,
  originGx: number,
  originGy: number,
  distanceFeet: number,
  mode: "push" | "pull",
): { gx: number; gy: number } {
  let gx = fromGx,
    gy = fromGy;
  const sign = mode === "push" ? 1 : -1;
  const stepX = Math.sign(fromGx - originGx) * sign;
  const stepY = Math.sign(fromGy - originGy) * sign;
  if (stepX === 0 && stepY === 0) return { gx, gy };
  const steps = Math.round(distanceFeet / 5);
  for (let i = 0; i < steps; i++) {
    const nx = gx + stepX,
      ny = gy + stepY;
    if (nx < 0 || ny < 0) break;
    if (cells && cells[ny]?.[nx] !== 1) break;
    if (occupied.has(`${nx},${ny}`)) break;
    gx = nx;
    gy = ny;
  }
  return { gx, gy };
}
