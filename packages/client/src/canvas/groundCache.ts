import type { Dungeon, DungeonRoom } from 'shared';
import { texturesFor, getImage, FLOOR_FALLBACK_COLOR } from '../dungeonThemes.ts';
import { CELL } from './constants.ts';

export interface GroundCache {
  dungeonId: string;
  textureVersion: number;
  /** Which floor this bake covers — null for a single-floor dungeon (whole grid baked). See FloorSlice. */
  floorKey: number | null;
  /** Dungeon-column the canvas's x=0 corresponds to — 0 unless floorKey is set. */
  originX: number;
  canvas: HTMLCanvasElement;
}

export interface FloorSlice {
  floorKey: number | null;
  originX: number;
  width: number;
  rooms: DungeonRoom[];
}

const FLOOR_SLICE_PAD = 3; // cells of margin past the outermost room, to cover doorway/corridor overshoot at a floor block's edge

/**
 * Which floor-block of a multi-floor building (generateBuildingLayout, api/dungeon/buildingLayout.ts)
 * the ground bake should cover, based on the player's own column. Building layouts stitch every
 * floor into ONE combined grid/room-list side by side (dungeon.width sums every floor's width), so
 * baking the whole thing costs floor-count-times what a single floor used to — this narrows the
 * bake (and the corridor-material nearest-room search below) down to just the floor the player is
 * actually standing on. A single-floor dungeon (every room's `floor` the same, or none set at all)
 * takes the old whole-grid path unchanged.
 */
export function resolveFloorSlice(dungeon: Dungeon, playerGx: number | undefined): FloorSlice {
  const ranges = new Map<number, { minX: number; maxX: number }>();
  for (const room of dungeon.rooms) {
    const floor = room.floor ?? 0;
    const r = ranges.get(floor);
    if (r) { r.minX = Math.min(r.minX, room.x); r.maxX = Math.max(r.maxX, room.x + room.width); }
    else ranges.set(floor, { minX: room.x, maxX: room.x + room.width });
  }
  if (ranges.size <= 1) return { floorKey: null, originX: 0, width: dungeon.width, rooms: dungeon.rooms };

  let activeFloor: number | undefined;
  if (playerGx !== undefined) {
    for (const [floor, r] of ranges) {
      if (playerGx >= r.minX - FLOOR_SLICE_PAD && playerGx < r.maxX + FLOOR_SLICE_PAD) { activeFloor = floor; break; }
    }
  }
  if (activeFloor === undefined) activeFloor = ranges.has(0) ? 0 : [...ranges.keys()][0]!;

  const range = ranges.get(activeFloor)!;
  const originX = Math.max(0, range.minX - FLOOR_SLICE_PAD);
  const endX = Math.min(dungeon.width, range.maxX + FLOOR_SLICE_PAD);
  return {
    floorKey: activeFloor,
    originX,
    width: endX - originX,
    rooms: dungeon.rooms.filter(r => (r.floor ?? 0) === activeFloor),
  };
}

/**
 * Bakes the static part of the ground layer — floor fallback, per-room floor textures, grid
 * lines, entrance/exit overlays — into one offscreen canvas at a fixed CELL-px/cell scale (pan/
 * zoom-independent), so drawScene's per-frame cost drops from thousands of individual
 * fillRect/strokeRect/drawImage calls (one nested loop per layer, every dungeon cell) to a single
 * scaled drawImage. Hazard cells and entity markers stay dynamic (drawn by drawScene itself,
 * cheap at the small counts they actually run at) since they can change between bakes.
 *
 * Only covers `slice` (see resolveFloorSlice) — the whole dungeon grid for a single-floor dungeon,
 * or just the player's current floor-block for a multi-floor building. Rebuilt when the dungeon
 * changes, `textureVersion` advances (a texture that was still decoding at bake time has since
 * finished — see dungeonThemes.ts's getTextureLoadVersion), or the player crosses to another floor.
 */
export function buildGroundCache(dungeon: Dungeon, variantPicks: Map<string, number>, textureVersion: number, slice: FloorSlice): GroundCache {
  const { originX, width, rooms } = slice;
  const canvas = document.createElement('canvas');
  canvas.width = width * CELL;
  canvas.height = dungeon.height * CELL;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = FLOOR_FALLBACK_COLOR;
  for (let row = 0; row < dungeon.height; row++) {
    for (let col = originX; col < originX + width; col++) {
      if (dungeon.cells[row]?.[col] === 1) {
        ctx.fillRect((col - originX) * CELL, row * CELL, CELL, CELL);
      }
    }
  }

  function paintCell(row: number, col: number, material: string | undefined): void {
    const variants = texturesFor(dungeon.tilesetSlug ?? dungeon.theme, material, dungeon.structureType);
    if (!variants.length) return;
    const key = `${row},${col}`;
    let variantIdx = variantPicks.get(key);
    if (variantIdx === undefined || variantIdx >= variants.length) {
      variantIdx = Math.floor(Math.random() * variants.length);
      variantPicks.set(key, variantIdx);
    }
    const img = getImage(variants[variantIdx]!);
    if (img.complete) ctx.drawImage(img, (col - originX) * CELL, row * CELL, CELL, CELL);
  }

  // Which room (if any) owns each floor cell — same bounding-box convention renderDungeonAscii
  // uses server-side, kept local here since rooms can overlap in theory and last-drawn should win
  // the same way the ascii legend's ownerOf does. Local-column indexed (col - originX), scoped to
  // just this floor's rooms.
  const ownerOf: number[][] = Array.from({ length: dungeon.height }, () => new Array<number>(width).fill(-1));
  rooms.forEach((room, i) => {
    for (let row = room.y; row < room.y + room.height; row++) {
      for (let col = room.x; col < room.x + room.width; col++) {
        if (col < originX || col >= originX + width) continue;
        if (dungeon.cells[row]?.[col] === 1) ownerOf[row]![col - originX] = i;
      }
    }
  });

  for (const room of rooms) {
    for (let row = room.y; row < room.y + room.height; row++) {
      for (let col = room.x; col < room.x + room.width; col++) {
        if (col < originX || col >= originX + width) continue;
        if (dungeon.cells[row]?.[col] !== 1) continue;
        paintCell(row, col, room.material);
      }
    }
  }

  // Connector corridors — raw floor cells outside every room's bounding box (see resolveRoom's
  // doc in dungeon/index.ts) — borrow whichever room's material is nearest instead of sitting on
  // the flat fallback color forever. "Nearest" is squared distance to the room's rectangle, not
  // its center, so a long room reaches its adjoining corridor the same way a small one does.
  // Scoped to `rooms` (this floor only) — a multi-floor building's floors sit far apart on the
  // combined grid, so searching every OTHER floor's rooms too would be pure wasted distance checks.
  if (rooms.length) {
    for (let row = 0; row < dungeon.height; row++) {
      for (let col = originX; col < originX + width; col++) {
        if (dungeon.cells[row]?.[col] !== 1 || ownerOf[row]![col - originX] !== -1) continue;
        let nearest = rooms[0]!;
        let bestDist = Infinity;
        for (const room of rooms) {
          const dx = Math.max(room.x - col, 0, col - (room.x + room.width - 1));
          const dy = Math.max(room.y - row, 0, row - (room.y + room.height - 1));
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) { bestDist = dist; nearest = room; }
        }
        paintCell(row, col, nearest.material);
      }
    }
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let row = 0; row < dungeon.height; row++) {
    for (let col = originX; col < originX + width; col++) {
      if (dungeon.cells[row]?.[col] === 1) {
        ctx.strokeRect((col - originX) * CELL + 0.5, row * CELL + 0.5, CELL - 1, CELL - 1);
      }
    }
  }

  return { dungeonId: dungeon.id, textureVersion, floorKey: slice.floorKey, originX, canvas };
}
