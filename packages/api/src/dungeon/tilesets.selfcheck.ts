// Standalone invariant check for computeGridRects — no test framework in this repo, so this is the
// one runnable check: `tsx src/dungeon/tilesets.selfcheck.ts` from packages/api. Asserts: exact-size
// atlases crop into full square rects in materials order; an atlas that isn't exactly the target
// grid ratio still produces non-overflowing rects instead of throwing. Materials are now a dynamic
// per-dungeon list (see dungeon/manifest.ts's collectDungeonMaterials), always padded to 16 before
// reaching this crop math (see dungeon/tilesets.ts's padMaterials) — so a plain 16-entry dummy
// array exercises the exact shape every real call site produces.
import { computeGridRects } from './tilesets.ts';

const MATERIALS = Array.from({ length: 16 }, (_, i) => `material-${i + 1}`);

function assertRects(width: number, height: number, label: string, expectWarning: boolean) {
  const { rects, warning } = computeGridRects(width, height, 4, 4, MATERIALS);
  if (rects.length !== MATERIALS.length) throw new Error(`${label}: expected ${MATERIALS.length} rects, got ${rects.length}`);
  if (expectWarning && !warning) throw new Error(`${label}: expected a warning, got none`);
  if (!expectWarning && warning) throw new Error(`${label}: expected no warning, got "${warning}"`);
  rects.forEach((r, i) => {
    if (r.material !== MATERIALS[i]) throw new Error(`${label}: rect ${i} material "${r.material}" !== expected "${MATERIALS[i]}"`);
    if (r.left < 0 || r.top < 0 || r.left + r.width > width || r.top + r.height > height) {
      throw new Error(`${label}: rect ${i} (${r.left},${r.top} ${r.width}x${r.height}) overflows atlas ${width}x${height}`);
    }
    if (r.width <= 0 || r.height <= 0) throw new Error(`${label}: rect ${i} has non-positive size ${r.width}x${r.height}`);
  });
}

// Exact target size (post-resize) — every rect must be a full 256x256, laid out 4 cols x 4 rows, no warning.
{
  const { rects } = computeGridRects(1024, 1024, 4, 4, MATERIALS);
  rects.forEach((r, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    if (r.width !== 256 || r.height !== 256) throw new Error(`exact: rect ${i} expected 256x256, got ${r.width}x${r.height}`);
    if (r.left !== col * 256 || r.top !== row * 256) throw new Error(`exact: rect ${i} expected offset (${col * 256},${row * 256}), got (${r.left},${r.top})`);
  });
}
assertRects(1024, 1024, 'exact', false);

// Off-ratio defensive case — a too-short atlas must still clamp row 4 rather than overflow.
assertRects(1024, 900, 'short atlas', true);

console.log('tilesets selfcheck: computeGridRects OK — exact and off-ratio cases all crop in bounds.');
