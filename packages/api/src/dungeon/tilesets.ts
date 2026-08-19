import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import sharp from 'sharp';
import type { AppConfig, DungeonMaterialSpec } from 'shared';
import { DUNGEON_STYLE_PACKS, slugifyTheme } from 'shared';
import { TILESETS_DIR } from '../storage.ts';
import { generateTilesetAtlas } from '../providers/openai.ts';
import { buildDynamicTilesetPrompt } from '../session-processor/imagePrompts.ts';
import { logError } from '../logger.ts';

export interface GridRect {
  material: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridRectResult {
  rects: GridRect[];
  warning?: string;
}

// Pure — no I/O — so the crop math is unit-testable without a real image or network call. Tile
// size comes from the atlas's actual WIDTH only (never the size we asked for — the image API
// doesn't reliably return the requested size, and tiles must stay square), so height is derived
// and clamped against whatever's actually left rather than assumed — a defensive path for when
// the atlas isn't exactly `cols:rows`. `materials` must already be in atlas row-major order.
export function computeGridRects(width: number, height: number, cols: number, rows: number, materials: readonly string[]): GridRectResult {
  const tileSize = Math.round(width / cols);
  const warning = height !== tileSize * rows
    ? `atlas is ${width}x${height}, expected height ${tileSize * rows} (tileSize ${tileSize} x${rows}) — cropping against actual size`
    : undefined;
  const rects = materials.map((material, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const top = row * tileSize;
    return {
      material,
      left: col * tileSize,
      top,
      width: tileSize,
      height: Math.max(0, Math.min(tileSize, height - top)),
    };
  });
  return warning ? { rects, warning } : { rects };
}

// Curated packs only — an existing generated tileset for a non-curated theme is now addressed by
// theme+materials hash (see ensureTilesetSupport), not by bare theme slug alone.
export function hasTilesetSupport(theme: string): boolean {
  const slug = slugifyTheme(theme);
  // DUNGEON_STYLE_PACKS entries (e.g. "high_fantasy") aren't pre-slugified themselves, so compare
  // slug-to-slug — a raw includes() would miss "high_fantasy" against its own slug "high-fantasy".
  return (DUNGEON_STYLE_PACKS as readonly string[]).some(pack => slugifyTheme(pack) === slug);
}

// Order-sensitive (not sorted) — the same material set in a different room-discovery order hashes
// differently and misses the cache. Acceptable: it only costs a redundant regeneration, never a
// correctness issue, and sorting would fight the "materials must stay in atlas row-major order"
// invariant computeGridRects relies on.
function hashMaterials(materials: DungeonMaterialSpec[]): string {
  const input = materials.map(m => `${m.key}:${m.description}`).join('|');
  return createHash('sha1').update(input).digest('hex').slice(0, 10);
}

// "1 hour 2 minutes 5 seconds" / "34 seconds" — no fractional seconds, no zero-value units
// (except when the whole thing rounds to 0s).
function formatElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (hours) parts.push(unit(hours, 'hour'));
  if (minutes) parts.push(unit(minutes, 'minute'));
  if (seconds || parts.length === 0) parts.push(unit(seconds, 'second'));
  return parts.join(' ');
}

interface PipelineOpts {
  title: string;
  theme: string;
  apiKey: string;
  model: string;
  prompt: string;
  atlasSize: string | undefined; // explicit override, or undefined to use the model's per-model default
  resizeWidth: number;
  resizeHeight: number;
  cols: number;
  rows: number;
  materials: readonly string[];
  sourceFolder: string; // 'source_extended' — kept distinct from the plain tile folders in the same theme dir
  onProgress: ((message: string) => void) | undefined;
}

// The single tileset pipeline — prompt, request atlas, save source, resize to a fixed
// deterministic size, crop. Every step is console.log'd (so it shows up in server logs regardless
// of caller) and, if onProgress is given, forwarded for live UI feedback too.
async function runTilesetPipeline(opts: PipelineOpts): Promise<void> {
  const slug = slugifyTheme(opts.title);
  const startedAt = Date.now();
  function report(message: string) {
    console.log(`[tilesets] ${message}`);
    opts.onProgress?.(message);
  }

  report(`Building prompt for theme "${opts.theme}"…`);

  report(`Requesting atlas from ${opts.model}…`);
  const rawAtlas = await generateTilesetAtlas(opts.prompt, opts.apiKey, opts.model, opts.atlasSize);

  const rawMeta = await sharp(rawAtlas).metadata();
  report(`Atlas received (${rawMeta.width}x${rawMeta.height})`);

  // Persisted unmodified, before the resize below, so the raw AI output can be reviewed later —
  // lives in its own folder so it rides the same theme/material/file route and manifest listing
  // every other tile uses, with no extra plumbing.
  const sourceExt = rawMeta.format === 'png' ? 'png' : 'jpg';
  const sourceDir = path.join(TILESETS_DIR, slug, opts.sourceFolder);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, `${opts.sourceFolder}_01.${sourceExt}`), rawAtlas);
  report('Saved source atlas for review.');

  // Whatever size the model actually returned, force it down to a fixed size before cropping —
  // 'fill' squashes to the exact target rather than cropping, so the material grid always stays
  // intact even when the source wasn't the exact grid ratio. This makes the crop math
  // deterministic instead of relying on the model happening to return a clean-ratio image.
  const tileSize = Math.round(opts.resizeWidth / opts.cols);
  report(`Resizing atlas to ${opts.resizeWidth}x${opts.resizeHeight} (${tileSize}x${tileSize} tiles)…`);
  const atlas = await sharp(rawAtlas).resize(opts.resizeWidth, opts.resizeHeight, { fit: 'fill' }).toBuffer();

  const { width, height } = await sharp(atlas).metadata();
  if (!width || !height) throw new Error('Resized atlas has no dimensions');

  const { rects, warning } = computeGridRects(width, height, opts.cols, opts.rows, opts.materials);
  if (warning) report(`Warning: ${warning}`);
  report(`Cropping into ${rects.length} tiles (tile size ${Math.round(width / opts.cols)}px)…`);

  // Padded slots repeat a real material key (see padMaterials) rather than a blank sentinel, so
  // every rect is a real tile to persist — just under the same folder as its original, incrementing
  // the filename suffix per repeat. Counts build up in atlas row-major order since the increment
  // happens synchronously before each iteration's own await, so concurrent writes never race it.
  const counts = new Map<string, number>();
  await Promise.all(rects.map(async rect => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const dir = path.join(TILESETS_DIR, slug, rect.material);
    await mkdir(dir, { recursive: true });
    const n = (counts.get(rect.material) ?? 0) + 1;
    counts.set(rect.material, n);
    const tile = await sharp(atlas).extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).jpeg({ quality: 90 }).toBuffer();
    await writeFile(path.join(dir, `${rect.material}_${String(n).padStart(2, '0')}.jpg`), tile);
  }));
  report(`Wrote tiles to storage/tilesets/${slug}/`);
  report(`Generated tileset in ${formatElapsed(Date.now() - startedAt)}.`);
}

// A padded slot beyond the real material count re-uses an earlier material (cycling round-robin)
// rather than a blank sentinel — buildDynamicTilesetPrompt asks the model for a seamlessly
// compatible variant of the original, and the pipeline writes it as `<key>_02.jpg`, `_03.jpg`, etc
// in that material's own folder. Keeps the crop grid a fixed 4x4 while turning otherwise-wasted
// slots into extra variety instead of throwaway black squares.
export interface PaddedMaterial extends DungeonMaterialSpec {
  variantOf?: number; // 1-based slot number of the original this is a variant of, if padded
}
function padMaterials(materials: DungeonMaterialSpec[]): PaddedMaterial[] {
  if (materials.length >= 16) return materials.slice(0, 16);
  const padded: PaddedMaterial[] = materials.map(m => ({ ...m }));
  for (let i = padded.length; i < 16; i++) {
    const originalIndex = i % materials.length;
    padded.push({ ...materials[originalIndex]!, variantOf: originalIndex + 1 });
  }
  return padded;
}

// 4x4-grid, 1:1, materials driven by whatever this dungeon's rooms actually asked for (see
// dungeon/manifest.ts's collectDungeonMaterials). Always requests a literal 1024x1024 atlas — the
// one size confirmed valid across every model this app supports — so there's no per-model size
// branching needed here at all. `title` is the already-resolved folder key (see
// ensureTilesetSupport) — slugifyTheme is idempotent on it so no special-casing is needed.
export async function generateExtendedTileset(title: string, theme: string, materials: DungeonMaterialSpec[], apiKey: string, model: string, onProgress?: (message: string) => void): Promise<void> {
  const padded = padMaterials(materials);
  await runTilesetPipeline({
    title, theme, apiKey, model,
    prompt: buildDynamicTilesetPrompt(theme, padded),
    atlasSize: '1024x1024',
    resizeWidth: 512, resizeHeight: 512,
    cols: 4, rows: 4,
    materials: padded.map(m => m.key),
    sourceFolder: 'source_extended',
    onProgress,
  });
}

// Called from generateDungeon() once a manifest's theme and materials are known. Never throws —
// a failed or skipped generation just means the dungeon renders with the client's existing
// default-pack fallback (dungeonThemes.ts), same as today's behaviour for an unrecognised theme.
// Returns the folder key the caller should stamp onto Dungeon.tilesetSlug — a bare theme slug for
// curated packs or a skip/failure, or theme-slug--<materials-hash> once a matching (possibly
// freshly generated) dynamic tileset exists on disk.
export async function ensureTilesetSupport(theme: string, materials: DungeonMaterialSpec[], config: AppConfig): Promise<string> {
  const slug = slugifyTheme(theme);
  if (hasTilesetSupport(theme)) return slug;
  if (!materials.length) return slug;

  const tilesetSlug = `${slug}--${hashMaterials(materials)}`;
  if (existsSync(path.join(TILESETS_DIR, tilesetSlug))) return tilesetSlug;
  if (!config.image.generateTilesets) return slug;
  const apiKey = config.apiKeys.openai;
  if (!apiKey) return slug;
  try {
    await generateExtendedTileset(tilesetSlug, theme, materials, apiKey, config.image.model);
    return tilesetSlug;
  } catch (err) {
    logError('dungeon/tilesets:ensureTilesetSupport', err);
    return slug;
  }
}
