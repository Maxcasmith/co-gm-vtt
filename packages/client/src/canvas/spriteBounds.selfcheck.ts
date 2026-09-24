import assert from 'node:assert';
import { alphaBounds, containFit } from './spriteBounds.ts';

// 6x4 image, opaque block at x 2..3, y 1..2, plus one faint pixel that must not count.
const w = 6, h = 4;
const data = new Uint8ClampedArray(w * h * 4);
const set = (x: number, y: number, a: number) => { data[(y * w + x) * 4 + 3] = a; };
for (let y = 1; y <= 2; y++) for (let x = 2; x <= 3; x++) set(x, y, 255);
set(0, 0, 10);
assert.deepStrictEqual(alphaBounds(data, w, h), { sx: 2, sy: 1, sw: 2, sh: 2 }, 'trims to the opaque block, ignores faint edges');
assert.strictEqual(alphaBounds(new Uint8ClampedArray(w * h * 4), w, h), null, 'fully transparent has no bounds');

// A thin 1:4 counter fitted into a 1x3-cell box keeps its shape instead of being stretched.
const tall = containFit(80, 320, 100, 300);
assert.ok(Math.abs(tall.w / tall.h - 0.25) < 1e-9, 'aspect preserved');
assert.ok(tall.h <= 300 && tall.w <= 100, 'fits the box');
assert.strictEqual(tall.h, 300, 'fills the limiting axis');
// A wide object in a tall box is limited by width.
const wide = containFit(300, 100, 100, 300);
assert.strictEqual(wide.w, 100);

console.log('spriteBounds selfcheck passed');
