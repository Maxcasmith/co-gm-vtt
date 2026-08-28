import type { Dungeon } from 'shared';
import { texturesFor, getImage, FLOOR_FALLBACK_COLOR } from '../dungeonThemes.ts';
import { CELL } from './constants.ts';

export interface GroundCache {
  dungeonId: string;
  textureVersion: number;
  canvas: HTMLCanvasElement;
}

/**
 * Bakes the static part of the ground layer — floor fallback, per-room floor textures, grid
 * lines, entrance/exit overlays — into one offscreen canvas at a fixed CELL-px/cell scale (pan/
 * zoom-independent), so drawScene's per-frame cost drops from thousands of individual
 * fillRect/strokeRect/drawImage calls (one nested loop per layer, every dungeon cell) to a single
 * scaled drawImage. Hazard cells and entity markers stay dynamic (drawn by drawScene itself,
 * cheap at the small counts they actually run at) since they can change between bakes.
 *
 * Rebuilt only when the dungeon changes or `textureVersion` advances (a texture that was still
 * decoding at bake time has since finished — see dungeonThemes.ts's getTextureLoadVersion).
 */
export function buildGroundCache(dungeon: Dungeon, variantPicks: Map<string, number>, textureVersion: number): GroundCache {
  const canvas = document.createElement('canvas');
  canvas.width = dungeon.width * CELL;
  canvas.height = dungeon.height * CELL;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = FLOOR_FALLBACK_COLOR;
  for (let row = 0; row < dungeon.height; row++) {
    for (let col = 0; col < dungeon.width; col++) {
      if (dungeon.cells[row]?.[col] === 1) {
        ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
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
    if (img.complete) ctx.drawImage(img, col * CELL, row * CELL, CELL, CELL);
  }

  // Which room (if any) owns each floor cell — same bounding-box convention renderDungeonAscii
  // uses server-side, kept local here since rooms can overlap in theory and last-drawn should win
  // the same way the ascii legend's ownerOf does.
  const ownerOf: number[][] = Array.from({ length: dungeon.height }, () => new Array<number>(dungeon.width).fill(-1));
  dungeon.rooms.forEach((room, i) => {
    for (let row = room.y; row < room.y + room.height; row++) {
      for (let col = room.x; col < room.x + room.width; col++) {
        if (dungeon.cells[row]?.[col] === 1) ownerOf[row]![col] = i;
      }
    }
  });

  for (const room of dungeon.rooms) {
    for (let row = room.y; row < room.y + room.height; row++) {
      for (let col = room.x; col < room.x + room.width; col++) {
        if (dungeon.cells[row]?.[col] !== 1) continue;
        paintCell(row, col, room.material);
      }
    }
  }

  // Connector corridors — raw floor cells outside every room's bounding box (see resolveRoom's
  // doc in dungeon/index.ts) — borrow whichever room's material is nearest instead of sitting on
  // the flat fallback color forever. "Nearest" is squared distance to the room's rectangle, not
  // its center, so a long room reaches its adjoining corridor the same way a small one does.
  if (dungeon.rooms.length) {
    for (let row = 0; row < dungeon.height; row++) {
      for (let col = 0; col < dungeon.width; col++) {
        if (dungeon.cells[row]?.[col] !== 1 || ownerOf[row]![col] !== -1) continue;
        let nearest = dungeon.rooms[0]!;
        let bestDist = Infinity;
        for (const room of dungeon.rooms) {
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
    for (let col = 0; col < dungeon.width; col++) {
      if (dungeon.cells[row]?.[col] === 1) {
        ctx.strokeRect(col * CELL + 0.5, row * CELL + 0.5, CELL - 1, CELL - 1);
      }
    }
  }

  return { dungeonId: dungeon.id, textureVersion, canvas };
}
