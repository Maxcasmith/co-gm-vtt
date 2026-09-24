/**
 * Prop sprites are drawn inside a square atlas cell, and how much of that square the object fills
 * varies per sprite — a counter might be a thin strip down the middle, a car nearly the whole cell.
 * Stretching the full square to a footprint applies the object's shape twice (once in the art, once
 * in the stretch), which is what turned a 1x3 counter into a stick. So the renderer works from the
 * object's visible content instead: trimmed to its opaque pixels, then fitted into the footprint at
 * its own aspect ratio, never distorted.
 */

export interface SpriteBounds {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Faint anti-aliasing and soft shadow edges below this alpha don't count as the object. */
const ALPHA_THRESHOLD = 24;

/** Opaque bounding box of RGBA pixel data. Pure, so it's checkable without a browser. */
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number): SpriteBounds | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
}

const cache = new WeakMap<HTMLImageElement, SpriteBounds>();

/**
 * Visible-content bounds for a loaded sprite, computed once per image. Falls back to the whole
 * image if its pixels can't be read (served without CORS headers taints the canvas) or it's fully
 * transparent — that just reproduces the old draw-the-whole-square behaviour for that one sprite.
 */
export function spriteBounds(img: HTMLImageElement): SpriteBounds {
  const hit = cache.get(img);
  if (hit) return hit;
  const full = { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
  let bounds = full;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      bounds = alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height) ?? full;
    }
  } catch {
    bounds = full;
  }
  cache.set(img, bounds);
  return bounds;
}

/** Largest w x h with the content's aspect ratio that fits inside boxW x boxH. */
export function containFit(contentW: number, contentH: number, boxW: number, boxH: number): { w: number; h: number } {
  const scale = Math.min(boxW / contentW, boxH / contentH);
  return { w: contentW * scale, h: contentH * scale };
}
