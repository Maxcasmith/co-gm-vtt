// Standalone check for gridDetect — no test framework in this repo, so this is the one runnable
// check: `tsx src/dungeon/gridDetect.selfcheck.ts` from packages/api.
// Asserts: a clean single divider produces one well-separated boundary, and two dark bands close
// together (simulating a creature's dark hair/cloak crossing the darkness threshold at two nearby
// columns — the bug that cropped deep-spawn/drowned-socialite portraits down to 7px/13px slivers)
// get merged into one boundary instead of carving a sliver cell between them.
import sharp from 'sharp';
import { detectGridBoundaries } from './gridDetect.ts';

const WIDTH = 200, HEIGHT = 60;
const noKeyColor = () => false;

async function buildAtlas(darkCols: number[]): Promise<{ atlas: Buffer; width: number; height: number }> {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      const dark = darkCols.includes(x);
      data[i] = dark ? 0 : 128;
      data[i + 1] = dark ? 0 : 128;
      data[i + 2] = dark ? 0 : 128;
      data[i + 3] = 255;
    }
  }
  const atlas = await sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer();
  return { atlas, width: WIDTH, height: HEIGHT };
}

function minGap(cols: number[]): number {
  let min = Infinity;
  for (let i = 1; i < cols.length; i++) min = Math.min(min, cols[i]! - cols[i - 1]!);
  return min;
}

// ── clean single divider ────────────────────────────────────────────────────────
{
  const { atlas, width, height } = await buildAtlas([99, 100]);
  const { cols } = await detectGridBoundaries(atlas, width, height, noKeyColor);
  if (cols.length !== 3) throw new Error(`expected 3 boundaries (border, one divider, border), got: ${cols}`);
  if (Math.abs(cols[1]! - 99.5) > 2) throw new Error(`divider boundary off: ${cols}`);
}

// ── two close dark bands must merge, not carve a sliver ────────────────────────
{
  const { atlas, width, height } = await buildAtlas([94, 95, 100, 101]);
  const { cols } = await detectGridBoundaries(atlas, width, height, noKeyColor);
  const gap = minGap(cols);
  if (gap < 20) throw new Error(`close bands produced a sliver boundary instead of merging: ${cols} (min gap ${gap})`);
}

console.log('gridDetect selfcheck: OK — clean dividers crop normally, close dark bands merge instead of carving sliver cells.');
