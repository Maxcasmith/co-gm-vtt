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

  for (const room of dungeon.rooms) {
    const variants = texturesFor(dungeon.tilesetSlug ?? dungeon.theme, room.material, dungeon.structureType);
    if (!variants.length) continue;
    for (let row = room.y; row < room.y + room.height; row++) {
      for (let col = room.x; col < room.x + room.width; col++) {
        if (dungeon.cells[row]?.[col] !== 1) continue;
        const key = `${row},${col}`;
        let variantIdx = variantPicks.get(key);
        if (variantIdx === undefined || variantIdx >= variants.length) {
          variantIdx = Math.floor(Math.random() * variants.length);
          variantPicks.set(key, variantIdx);
        }
        const img = getImage(variants[variantIdx]!);
        if (img.complete) {
          ctx.drawImage(img, col * CELL, row * CELL, CELL, CELL);
        }
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
