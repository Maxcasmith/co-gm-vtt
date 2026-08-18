// Standalone invariant check for computeTileRects/computeExtendedTileRects — no test framework in
// this repo, so this is the one runnable check: `tsx src/dungeon/tilesets.selfcheck.ts` from
// packages/api. Asserts: exact-size atlases crop into full square rects in material order; an
// atlas that isn't exactly the target grid ratio still produces non-overflowing rects instead of
// throwing.
import { computeTileRects, computeExtendedTileRects } from './tilesets.ts';
import { DUNGEON_MATERIALS, EXTENDED_TILE_MATERIALS } from 'shared';

type Compute = (width: number, height: number) => { rects: { material: string; left: number; top: number; width: number; height: number }[]; warning?: string };

function assertRects(compute: Compute, materials: readonly string[], width: number, height: number, label: string, expectWarning: boolean) {
  const { rects, warning } = compute(width, height);
  if (rects.length !== materials.length) throw new Error(`${label}: expected ${materials.length} rects, got ${rects.length}`);
  if (expectWarning && !warning) throw new Error(`${label}: expected a warning, got none`);
  if (!expectWarning && warning) throw new Error(`${label}: expected no warning, got "${warning}"`);
  rects.forEach((r, i) => {
    if (r.material !== materials[i]) throw new Error(`${label}: rect ${i} material "${r.material}" !== expected "${materials[i]}"`);
    if (r.left < 0 || r.top < 0 || r.left + r.width > width || r.top + r.height > height) {
      throw new Error(`${label}: rect ${i} (${r.left},${r.top} ${r.width}x${r.height}) overflows atlas ${width}x${height}`);
    }
    if (r.width <= 0 || r.height <= 0) throw new Error(`${label}: rect ${i} has non-positive size ${r.width}x${r.height}`);
  });
}

// ── standard 8-material, 4x2 grid ──────────────────────────────────────────

// Exact target size — every rect must be a full 512x512, laid out 4 cols x 2 rows, no warning.
{
  const { rects } = computeTileRects(2048, 1024);
  rects.forEach((r, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    if (r.width !== 512 || r.height !== 512) throw new Error(`exact: rect ${i} expected 512x512, got ${r.width}x${r.height}`);
    if (r.left !== col * 512 || r.top !== row * 512) throw new Error(`exact: rect ${i} expected offset (${col * 512},${row * 512}), got (${r.left},${r.top})`);
  });
}
assertRects(computeTileRects, DUNGEON_MATERIALS, 2048, 1024, 'exact', false);

// gpt-image-1's actual widescreen size — not 2:1 (1536x1024, ratio 1.5:1), plenty tall enough
// for both rows, just a smaller tileSize than the 2048-wide target. Still off-ratio -> warns.
assertRects(computeTileRects, DUNGEON_MATERIALS, 1536, 1024, 'gpt-image-1 size', true);

// dall-e-2 has no widescreen option at all — comes back perfectly square. Off-ratio -> warns.
assertRects(computeTileRects, DUNGEON_MATERIALS, 1024, 1024, 'square (dall-e-2)', true);

// Shorter than 2x tileSize (model returned a genuinely off-ratio image) — row 2 must clamp to
// whatever height is actually left, not overflow or throw. Off-ratio -> warns.
assertRects(computeTileRects, DUNGEON_MATERIALS, 2048, 900, 'short atlas', true);

console.log('tilesets selfcheck: computeTileRects OK — exact, gpt-image-1, and square-atlas cases all crop in bounds.');

// ── extended 16-material, 4x4 grid ─────────────────────────────────────────

// Exact target size (post-resize) — every rect must be a full 256x256, laid out 4 cols x 4 rows, no warning.
{
  const { rects } = computeExtendedTileRects(1024, 1024);
  rects.forEach((r, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    if (r.width !== 256 || r.height !== 256) throw new Error(`extended-exact: rect ${i} expected 256x256, got ${r.width}x${r.height}`);
    if (r.left !== col * 256 || r.top !== row * 256) throw new Error(`extended-exact: rect ${i} expected offset (${col * 256},${row * 256}), got (${r.left},${r.top})`);
  });
}
assertRects(computeExtendedTileRects, EXTENDED_TILE_MATERIALS, 1024, 1024, 'extended-exact', false);

// Off-ratio defensive case — a too-short atlas must still clamp row 4 rather than overflow.
assertRects(computeExtendedTileRects, EXTENDED_TILE_MATERIALS, 1024, 900, 'extended-short atlas', true);

console.log('tilesets selfcheck: computeExtendedTileRects OK — exact and off-ratio cases all crop in bounds.');
