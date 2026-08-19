import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { AppConfig, DungeonEntity, PropSpec } from 'shared';
import { slugifyTheme } from 'shared';
import { PROPS_DIR } from '../storage.ts';
import { generateTilesetAtlas } from '../providers/openai.ts';
import { buildPropSpritePrompt } from '../session-processor/imagePrompts.ts';
import { computeGridRects } from './tilesets.ts';
import { logError } from '../logger.ts';

const GRID_SIZE = 6; // 36 cells — see the "6x6, capped at 32" call in props SCOPING
const REAL_CAP = 32; // batch size — the real-content limit; the remaining 4 cells always pad blank
const TILE_SIZE = 341;
const ATLAS_SIZE = GRID_SIZE * TILE_SIZE; // 2046 — evenly divisible by GRID_SIZE, avoids computeGridRects's off-ratio warning that 2048/6 (non-integer) would trigger every batch

// Chroma-key fallback for models with no real alpha-channel output (dall-e). Magenta — see
// buildPropSpritePrompt's background section, which instructs the model never to use this color
// on the object itself. Threshold is a generous euclidean RGB distance, wide enough to catch
// anti-aliased edge pixels without eating genuine near-magenta object colors.
const CHROMA_KEY: [number, number, number] = [255, 0, 255];
const CHROMA_THRESHOLD = 60;

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

interface PendingProp {
  slug: string;
  name: string;
  description: string;
}

async function stripChromaKey(tile: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i]! - CHROMA_KEY[0], dg = data[i + 1]! - CHROMA_KEY[1], db = data[i + 2]! - CHROMA_KEY[2];
    if (dr * dr + dg * dg + db * db < CHROMA_THRESHOLD * CHROMA_THRESHOLD) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// Fire-and-forget — called unawaited from generateDungeon(), never blocks dungeon generation.
// Sourced from the manifest's already-deduped PropSpec[] (real descriptions, first-seen order),
// not re-derived from dungeon.entities — an entity only carries a bare name, not the vivid visual
// description the manifest LLM wrote, so that has to come from the spec list. Skips anything
// already on disk (global reuse across every dungeon/campaign, same philosophy as
// creaturePortraits.ts), batches whatever's left into groups of 32.
export async function generatePropSprites(propSpecs: PropSpec[], config: AppConfig): Promise<void> {
  const needed: PendingProp[] = propSpecs
    .filter(spec => !hasPropSprite(spec.key))
    .map(spec => ({ slug: spec.key, name: titleCase(spec.key), description: spec.description }));

  const apiKey = config.apiKeys.openai;
  if (!apiKey || !needed.length) return;

  for (const batch of chunk(needed, REAL_CAP)) {
    try {
      await generateBatch(batch, apiKey, config.image.model);
    } catch (err) {
      logError('dungeon/props:generatePropSprites', err);
    }
  }
}

async function generateBatch(batch: PendingProp[], apiKey: string, model: string): Promise<void> {
  console.log(`[props] generating sprites for: ${batch.map(b => b.name).join(', ')}`);
  // Explicit allowlist, not a `gpt-image` prefix guess — confirmed live that gpt-image-2 actually
  // REJECTS background:'transparent' ("Transparent background is not supported for this model"),
  // despite being part of the same model family. Only gpt-image-1/1.5 are confirmed to accept it.
  const transparent = model === 'gpt-image-1' || model === 'gpt-image-1.5';
  const prompt = buildPropSpritePrompt(batch.map(b => ({ name: b.name, description: b.description })), transparent);

  console.log(`[props] requesting atlas from ${model}…`);
  // gpt-image-2 can return a true 2048x2048 atlas directly; every other model here is locked to a
  // fixed size enum topping out at 1024x1024 square (see providers/openai.ts's atlasSizeFor notes)
  // — those get force-resized up to ATLAS_SIZE below regardless, same pattern tilesets.ts uses.
  const requestSize = model === 'gpt-image-2' ? '2048x2048' : '1024x1024';
  const rawAtlas = await generateTilesetAtlas(prompt, apiKey, model, requestSize, transparent ? 'transparent' : undefined);

  // Persisted unmodified, before the resize below, same review purpose as tilesets.ts's
  // source_extended save. Props have no per-batch slug to nest under (global-by-name reuse, not
  // per-dungeon) so these just collect under a flat _source folder, one file per batch.
  const rawMeta = await sharp(rawAtlas).metadata();
  const sourceExt = rawMeta.format === 'png' ? 'png' : 'jpg';
  const sourceDir = path.join(PROPS_DIR, '_source');
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, `props_${Date.now()}.${sourceExt}`), rawAtlas);
  console.log('[props] saved source atlas for review.');

  const atlas = await sharp(rawAtlas).resize(ATLAS_SIZE, ATLAS_SIZE, { fit: 'fill' }).toBuffer();
  const { width, height } = await sharp(atlas).metadata();
  if (!width || !height) throw new Error('Prop atlas has no dimensions');

  // Pad to the full 36-slot grid with blank placeholders so computeGridRects's row/col math stays
  // correct regardless of batch size — same padding contract buildPropSpritePrompt expects. Blank
  // slots are never written to disk (sliced off below).
  const paddedSlugs = [
    ...batch.map(b => b.slug),
    ...Array.from({ length: GRID_SIZE * GRID_SIZE - batch.length }, (_, i) => `_blank_${batch.length + i + 1}`),
  ];
  const { rects, warning } = computeGridRects(width, height, GRID_SIZE, GRID_SIZE, paddedSlugs);
  if (warning) console.warn(`[props] ${warning}`);

  await Promise.all(rects.slice(0, batch.length).map(async rect => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const dir = path.join(PROPS_DIR, rect.material);
    await mkdir(dir, { recursive: true });
    const cropped = await sharp(atlas).extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).png().toBuffer();
    const final = transparent ? cropped : await stripChromaKey(cropped);
    await writeFile(path.join(dir, 'sprite_01.png'), final);
  }));
  console.log(`[props] wrote ${batch.length} sprites to storage/props/`);
}
