import type { EnemyStatBlock } from "./combat.ts";
import type { EffectSpec } from "./spells.ts";
import type { AbilityKey } from "./character.ts";

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

/**
 * A trap's effect, shared by AI-authored dungeon traps and combat-placed ones (Snare). Reuses
 * the same EffectSpec shape a spell's onHit uses — damage, condition, whatever — rather than
 * inventing a parallel schema. Omitted `save` = auto-hits, no roll (a pressure plate, not a
 * dodgeable blast).
 */
export interface TrapEffect {
  save?: { ability: AbilityKey; dc: number; halfOnSave: boolean };
  effects: EffectSpec[];
  /** Chebyshev distance (feet) from the trap's cell that triggers it. Omitted/0 = exact-cell only. */
  radiusFt?: number;
}

export interface DungeonEntity {
  id: string;
  type: "creature" | "loot" | "trap" | "object";
  x: number;
  y: number;
  name: string;
  discovered: boolean;
  hideDC?: number;
  statBlock?: EnemyStatBlock;
  /** type === 'trap' only. Missing = falls back to a generic default (see checkTrapAt). */
  trap?: TrapEffect;
  /**
   * type === 'trap' only, party-placed traps (Snare) — the caster's name. Set = the party
   * always sees this trap on the map (toClientDungeon skips the `discovered` gate for it),
   * same as knowing where you left your own bear trap. Unset (AI-authored dungeon traps) keeps
   * the normal hidden-until-Perception-finds-it behaviour.
   */
  placedBy?: string;
  /**
   * type === 'object' only (Tenser's Floating Disk) — the participant id this object trails.
   * Snaps to that participant's cell whenever token:move puts them more than `leashFt` away
   * (no terrain-aware path-following, just an instant catch-up — a real disk would thread
   * around obstacles, this doesn't model that); vanishes if they get more than 100ft away in
   * one jump (RAW's "can't keep up" clause).
   */
  followsId?: string;
  /** type === 'object' with followsId only — how far the followed participant can roam before it snaps to catch up. */
  leashFt?: number;
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
  /**
   * Temporary movement-cost overlay (Entangle/Grease's Difficult Terrain) — separate from `cells`
   * since it's a spell effect layered on top of the permanent map, not a change to the map
   * itself, and needs to expire and clear independently. `multiplier` (2 for standard Difficult
   * Terrain) is applied client-side as extra feet-per-cell when a walked path crosses one of
   * these cells — see Canvas.tsx's drag-cost calculation. `expiresOnRound` is checked lazily
   * (pruned wherever a new round starts, see pruneExpiredHazardCells in runtime.ts) rather than
   * driving a dedicated StateEngine hook, since a hazard belongs to the map, not to a participant.
   */
  hazardCells?: {
    gx: number; gy: number;
    multiplier?: number | undefined; obscures?: boolean | undefined; expiresOnRound?: number | undefined;
    /** How this cell is drawn (Canvas.tsx's drawHazardCell) — omitted entirely for a hazard with no visual (none exist today, but the mechanic doesn't require one). */
    style?: 'vines' | 'smudge' | undefined;
    color?: string | undefined;
  }[];
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

// Same Bresenham walk as hasLineOfSight, but checking Heavily Obscured cells (Fog Cloud) instead
// of walls, and — unlike a wall — the far endpoint itself counts too: a target standing inside
// the cloud is obscured to the viewer even with clear ground the whole way there.
export function crossesObscuredArea(
  obscuredCells: { gx: number; gy: number }[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  if (!obscuredCells.length) return false;
  const obscured = new Set(obscuredCells.map(c => `${c.gx},${c.gy}`));
  if (obscured.has(`${x1},${y1}`)) return true;
  const dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0,
    y = y0;
  while (x !== x1 || y !== y1) {
    if (obscured.has(`${x},${y}`)) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return false;
}

// Wall-aware shortest route (8-directional, uniform per-step cost — same cost model as
// bfsReachable/resolveForcedMovement) from start to target. BFS explores the full connected
// region before giving up, so it never reports "stuck" on a route that a longer detour would
// clear — only a genuinely walled-off target returns null. Returns the steps from start to
// target (excluding start), or null if the target is off-grid, on a wall, or unreachable.
export function findPath(
  cells: number[][],
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
): { gx: number; gy: number }[] | null {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) return null;
  if (cells[targetY]?.[targetX] !== 1) return null;
  if (startX === targetX && startY === targetY) return [];

  const key = (x: number, y: number) => `${x},${y}`;
  const startKey = key(startX, startY);
  const targetKey = key(targetX, targetY);
  const parent = new Map<string, string>();
  const visited = new Set<string>([startKey]);
  const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i]!;
    if (key(x, y) === targetKey) break;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || ny >= height || nx >= width) continue;
        if (cells[ny]?.[nx] !== 1) continue;
        const k = key(nx, ny);
        if (visited.has(k)) continue;
        visited.add(k);
        parent.set(k, key(x, y));
        queue.push({ x: nx, y: ny });
      }
    }
  }
  if (!visited.has(targetKey)) return null;

  const path: { gx: number; gy: number }[] = [];
  for (let cur = targetKey; cur !== startKey; cur = parent.get(cur)!) {
    const [x, y] = cur.split(',').map(Number) as [number, number];
    path.push({ gx: x, gy: y });
  }
  return path.reverse();
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
