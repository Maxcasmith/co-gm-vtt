import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { AppConfig, DungeonEntity, PropSpec } from 'shared';
import { slugifyTheme } from 'shared';
import { PROPS_DIR } from '../storage.ts';
import { generateTilesetAtlas } from '../providers/openai.ts';
import { buildPropSpritePrompt } from '../session-processor/imagePrompts.ts';
import type { GridRect } from './tilesets.ts';
import { detectGridBoundaries } from './gridDetect.ts';
import { logError } from '../logger.ts';

const GRID_SIZE = 6; // 36 cells — see the "6x6, capped at 32" call in props SCOPING
const REAL_CAP = 32; // batch size — the real-content limit; the remaining 4 cells always pad blank
const TILE_SIZE = 341;
const ATLAS_SIZE = GRID_SIZE * TILE_SIZE; // 2046 — the fixed size every raw atlas gets force-resized to before grid detection/cropping, regardless of what the model actually returned
const INSET_FRACTION = 0.02; // extra margin past the detected line, to clear its thickness/anti-aliasing

const CHROMA_KEY: [number, number, number] = [255, 0, 255];
const CHROMA_THRESHOLD = 70;
// Soft band above CHROMA_THRESHOLD where alpha ramps 0→255 instead of snapping straight to opaque —
// a hard cutoff left a ring of still-fully-opaque, still magenta-tinted anti-aliased edge pixels
// (the "outline" artifact), since those pixels sit just outside the threshold sphere but still carry
// real magenta spill from the source image's own edge anti-aliasing.
const CHROMA_FEATHER = 50;

function propSlug(name: string): string {
  return slugifyTheme(name);
}

function propUrl(slug: string): string {
  return `/api/props/${slug}/sprite_01.png`;
}

function hasPropSprite(slug: string): boolean {
  return existsSync(path.join(PROPS_DIR, slug, 'sprite_01.png'));
}

function titleCase(s: string): string {
  return s.replace(/-+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Synchronous/deterministic — every decorative prop entity gets a spriteSrc before generateDungeon
// returns, regardless of whether the file exists yet, same contract as assignPortraitSrcs. `object`
// entities WITH followsId are Tenser's Floating Disk (spell-placed, no sprite) — never touched here.
export function assignPropSpriteSrcs(entities: DungeonEntity[]): void {
  for (const entity of entities) {
    if (entity.type !== 'object' || entity.followsId) continue;
    entity.spriteSrc = propUrl(propSlug(entity.name));
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface PendingProp {
  slug: string;
  name: string;
  description: string;
}

async function stripChromaKey(tile: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const alpha = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const dr = data[i]! - CHROMA_KEY[0], dg = data[i + 1]! - CHROMA_KEY[1], db = data[i + 2]! - CHROMA_KEY[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < CHROMA_THRESHOLD) {
      data[i + 3] = 0;
    } else if (dist < CHROMA_THRESHOLD + CHROMA_FEATHER) {
      const t = (dist - CHROMA_THRESHOLD) / CHROMA_FEATHER;
      data[i + 3] = Math.round(data[i + 3]! * t);
      // Despill: magenta = high R and B, low G. Pull R/B down toward G in proportion to how close
      // this pixel still is to the key color, so the residual tint fades out with the alpha instead
      // of staying at full magenta saturation right up to the cutoff.
      const g = data[i + 1]!;
      data[i] = Math.round(g + (data[i]! - g) * t);
      data[i + 2] = Math.round(g + (data[i + 2]! - g) * t);
    }
    alpha[p] = data[i + 3]!;
  }
  // Erode the opaque silhouette by one pixel: any pixel next to a more-transparent neighbor drops to
  // that neighbor's alpha. Cleans up the thin ring of still-opaque, still magenta-tinted pixels that
  // survive the feather above — typically shadow-gradient or heavy anti-aliasing pixels sitting
  // ambiguously between the object's own color and the key color. Reads from the pre-erosion `alpha`
  // snapshot so neighbors don't cascade within the same pass.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let min = alpha[p]!;
      if (x > 0) min = Math.min(min, alpha[p - 1]!);
      if (x < width - 1) min = Math.min(min, alpha[p + 1]!);
      if (y > 0) min = Math.min(min, alpha[p - width]!);
      if (y < height - 1) min = Math.min(min, alpha[p + width]!);
      data[p * 4 + 3] = min;
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// Shared by the real generation pipeline and the admin "preview this source atlas" tool — same
// inset-past-the-detected-line crop, same chroma-key-or-not decision, so a preview is a faithful
// picture of what production actually does with these coordinates, not a lookalike approximation.
async function cropCell(atlas: Buffer, rect: GridRect, transparent: boolean): Promise<Buffer> {
  const insetX = Math.round(rect.width * INSET_FRACTION);
  const insetY = Math.round(rect.height * INSET_FRACTION);
  const cropped = await sharp(atlas).extract({
    left: rect.left + insetX,
    top: rect.top + insetY,
    width: rect.width - insetX * 2,
    height: rect.height - insetY * 2,
  }).png().toBuffer();
  return transparent ? cropped : stripChromaKey(cropped);
}

// Magenta key-color check passed into the shared detector (see gridDetect.ts) — distinguishes the
// flat chroma-key background from real drawn object content.
function isMagenta(r: number, g: number, b: number): boolean {
  const dr = r - CHROMA_KEY[0], dg = g - CHROMA_KEY[1], db = b - CHROMA_KEY[2];
  return dr * dr + dg * dg + db * db < CHROMA_THRESHOLD * CHROMA_THRESHOLD;
}

// Admin "preview this source atlas" tool — runs the exact same detect/crop pipeline as real
// generation against an already-saved source atlas, with no AI call and no names/slugs involved
// (every _source file already cost real money once; this lets prompt/crop tweaks get tested for
// free against it afterward). Returns every detected cell as a small PNG buffer, row-major.
// Transparent-vs-magenta is auto-detected from the source file itself (real generation knows this
// from which model/config produced it, but a saved file carries no such metadata): an alpha channel
// with any fully-transparent pixel means it's a real-alpha source, otherwise it's treated as magenta.
export async function previewGridCells(sourceBuffer: Buffer): Promise<Buffer[]> {
  const stats = await sharp(sourceBuffer).stats();
  const alphaChannel = stats.channels[3];
  const transparent = alphaChannel !== undefined && alphaChannel.min === 0;

  const atlas = await sharp(sourceBuffer).resize(ATLAS_SIZE, ATLAS_SIZE, { fit: 'fill' }).toBuffer();
  const { width, height } = await sharp(atlas).metadata();
  if (!width || !height) throw new Error('Source atlas has no dimensions');

  const { rows, cols } = await detectGridBoundaries(atlas, width, height, isMagenta);
  const actualCols = cols.length - 1, actualRows = rows.length - 1;

  const cells: Buffer[] = [];
  for (let r = 0; r < actualRows; r++) {
    for (let c = 0; c < actualCols; c++) {
      const rect: GridRect = { material: '', left: cols[c]!, top: rows[r]!, width: cols[c + 1]! - cols[c]!, height: rows[r + 1]! - rows[r]! };
      if (rect.width <= 0 || rect.height <= 0) continue;
      const cropped = await cropCell(atlas, rect, transparent);
      // Preview only — shrink to keep the response light, actual crop fidelity isn't affected.
      cells.push(await sharp(cropped).resize(200, 200, { fit: 'inside' }).png().toBuffer());
    }
  }
  return cells;
}

// Fire-and-forget — called unawaited from generateDungeon(), never blocks dungeon generation.
// Sourced from the manifest's already-deduped PropSpec[] (real descriptions, first-seen order),
// not re-derived from dungeon.entities — an entity only carries a bare name, not the vivid visual
// description the manifest LLM wrote, so that has to come from the spec list. Skips anything
// already on disk (global reuse across every dungeon/campaign, same philosophy as
// creaturePortraits.ts), batches whatever's left into groups of 32.
export async function generatePropSprites(propSpecs: PropSpec[], config: AppConfig): Promise<void> {
  if (!config.image.generatePropImages) return;

  const needed: PendingProp[] = propSpecs
    .filter(spec => !hasPropSprite(spec.key))
    .map(spec => ({ slug: spec.key, name: titleCase(spec.key), description: spec.description }));

  const apiKey = config.apiKeys.openai;
  if (!apiKey || !needed.length) return;

  for (const batch of chunk(needed, REAL_CAP)) {
    try {
      await generatePropSpriteBatch(batch, apiKey, config.image.model);
    } catch (err) {
      logError('dungeon/props:generatePropSprites', err);
    }
  }
}

// Exported directly (rather than only through generatePropSprites' skip-if-exists/chunking wrapper)
// for the admin "test the prompt" flow — trying prompt tweaks against a hand-picked batch of real
// prop names without needing to spend money generating an entire dungeon to trigger it. Always
// overwrites sprite_01.png for every slug in `batch`, existing or not — the caller decides scope.
export async function generatePropSpriteBatch(batch: PendingProp[], apiKey: string, model: string, onProgress?: (message: string) => void): Promise<void> {
  function report(message: string) {
    console.log(`[props] ${message}`);
    onProgress?.(message);
  }
  report(`generating sprites for: ${batch.map(b => b.name).join(', ')}`);
  // Explicit allowlist, not a `gpt-image` prefix guess — dall-e models have no real alpha-channel
  // option at all. gpt-image-2 was previously excluded after a live rejection ("Transparent
  // background is not supported for this model"), but OpenAI's images.generate docs confirm
  // gpt-image-2 supports background:'transparent' (in preview) provided output_format is explicitly
  // 'png'/'webp' — that param was missing from the request (see providers/openai.ts), which is the
  // more likely cause of that rejection than a hard model restriction. Re-included here on that
  // basis; flag as unverified until a live gpt-image-2 run is confirmed to actually return alpha.
  const transparent = model === 'gpt-image-1' || model === 'gpt-image-1.5' || model === 'gpt-image-2';
  // gpt-image-2 can return a true 2048x2048 atlas directly; every other model here is locked to a
  // fixed size enum topping out at 1024x1024 square (see providers/openai.ts's atlasSizeFor notes)
  // — those get force-resized up to ATLAS_SIZE below regardless, same pattern tilesets.ts uses.
  const requestSize = model === 'gpt-image-2' ? '2048x2048' : '1024x1024';
  // The prompt must describe whichever size is actually being requested this call — it used to
  // hardcode 2048, which was simply false for the 1024 branch and fed the model a wrong canvas
  // size to lay its grid out against.
  const prompt = buildPropSpritePrompt(batch.map(b => ({ name: b.name, description: b.description })), transparent, parseInt(requestSize, 10));

  report(`requesting atlas from ${model}…`);
  const rawAtlas = await generateTilesetAtlas(prompt, apiKey, model, requestSize, transparent ? 'transparent' : undefined);

  // Persisted unmodified, before the resize below, same review purpose as tilesets.ts's
  // source_extended save. Props have no per-batch slug to nest under (global-by-name reuse, not
  // per-dungeon) so these just collect under a flat _source folder, one file per batch.
  const rawMeta = await sharp(rawAtlas).metadata();
  const sourceExt = rawMeta.format === 'png' ? 'png' : 'jpg';
  const sourceDir = path.join(PROPS_DIR, '_source');
  await mkdir(sourceDir, { recursive: true });
  const sourceFile = `props_${Date.now()}.${sourceExt}`;
  await writeFile(path.join(sourceDir, sourceFile), rawAtlas);
  report(`saved source atlas for review: /api/props/_source/${sourceFile}`);

  const atlas = await sharp(rawAtlas).resize(ATLAS_SIZE, ATLAS_SIZE, { fit: 'fill' }).toBuffer();
  const { width, height } = await sharp(atlas).metadata();
  if (!width || !height) throw new Error('Prop atlas has no dimensions');

  const { rows, cols } = await detectGridBoundaries(atlas, width, height, isMagenta);
  const actualCols = cols.length - 1, actualRows = rows.length - 1;
  if (actualCols !== GRID_SIZE || actualRows !== GRID_SIZE) {
    report(`warning: detected a ${actualCols}x${actualRows} grid, not the requested ${GRID_SIZE}x${GRID_SIZE} — cropping against what was actually drawn`);
  }

  const rects: GridRect[] = [];
  batch.forEach((b, i) => {
    const r = Math.floor(i / actualCols), c = i % actualCols;
    if (r >= actualRows) {
      report(`warning: no ${r + 1}th row in the detected grid — skipping "${b.name}", it will need a re-run`);
      return;
    }
    rects.push({ material: b.slug, left: cols[c]!, top: rows[r]!, width: cols[c + 1]! - cols[c]!, height: rows[r + 1]! - rows[r]! });
  });

  await Promise.all(rects.map(async rect => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const dir = path.join(PROPS_DIR, rect.material);
    await mkdir(dir, { recursive: true });
    const final = await cropCell(atlas, rect, transparent);
    await writeFile(path.join(dir, 'sprite_01.png'), final);
  }));
  console.log(`[props] wrote ${batch.length} sprites to storage/props/`);
}
