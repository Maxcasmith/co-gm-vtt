import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { AppConfig, DungeonMaterial, ExtendedTileMaterial } from 'shared';
import { DUNGEON_MATERIALS, EXTENDED_TILE_MATERIALS, DUNGEON_STYLE_PACKS, slugifyTheme } from 'shared';
import { TILESETS_DIR } from '../storage.ts';
import { generateTilesetAtlas } from '../providers/openai.ts';
import { buildTilesetPrompt, buildExtendedTilesetPrompt } from '../session-processor/imagePrompts.ts';
import { logError } from '../logger.ts';

export interface TileRect {
  material: DungeonMaterial;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TileRectResult {
  rects: TileRect[];
  warning?: string;
}

export interface ExtendedTileRect {
  material: ExtendedTileMaterial;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ExtendedTileRectResult {
  rects: ExtendedTileRect[];
  warning?: string;
}

// Generic despite the "material" field name (kept as-is rather than renamed across every existing
// call site) — reused as-is by api/dungeon/creaturePortraits.ts, where each M is a creature slug
// rather than a tile material.
export interface GridRect<M extends string> {
  material: M;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridRectResult<M extends string> {
  rects: GridRect<M>[];
  warning?: string;
}

// Pure — no I/O — so the crop math is unit-testable without a real image or network call. Tile
// size comes from the atlas's actual WIDTH only (never the size we asked for — the image API
// doesn't reliably return the requested size, and tiles must stay square), so height is derived
// and clamped against whatever's actually left rather than assumed — a defensive path for when
// the atlas isn't exactly `cols:rows`. `materials` must already be in atlas row-major order.
export function computeGridRects<M extends string>(width: number, height: number, cols: number, rows: number, materials: readonly M[]): GridRectResult<M> {
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

// ARCHIVED — supports generateTileset above, same backup status. DUNGEON_MATERIALS is already in
// atlas order: row 0 = dirt/grass/wood/stone, row 1 = brick/iron/sand/water.
export function computeTileRects(width: number, height: number): TileRectResult {
  return computeGridRects(width, height, 4, 2, DUNGEON_MATERIALS);
}

// The sole active crop path — everything (admin-triggered and automatic in-game generation) goes
// through this now. EXTENDED_TILE_MATERIALS is already in atlas order: rows 0-1 are the original
// 8, rows 2-3 are the 8 new ones (ice/lava/moss/mud/marble/gravel/ash/snow).
export function computeExtendedTileRects(width: number, height: number): ExtendedTileRectResult {
  return computeGridRects(width, height, 4, 4, EXTENDED_TILE_MATERIALS);
}

export function hasTilesetSupport(theme: string): boolean {
  const slug = slugifyTheme(theme);
  // DUNGEON_STYLE_PACKS entries (e.g. "high_fantasy") aren't pre-slugified themselves, so compare
  // slug-to-slug — a raw includes() would miss "high_fantasy" against its own slug "high-fantasy".
  if ((DUNGEON_STYLE_PACKS as readonly string[]).some(pack => slugifyTheme(pack) === slug)) return true;
  return existsSync(path.join(TILESETS_DIR, slug));
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

interface PipelineOpts<M extends string> {
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
  materials: readonly M[];
  sourceFolder: string; // 'source' for the standard 8-tile set, 'source_extended' for the 16-tile set — keeps them from colliding in the same theme dir
  onProgress: ((message: string) => void) | undefined;
}

// Shared by generateTileset and generateExtendedTileset below — same 5 steps (prompt, request,
// save source, resize to a fixed deterministic size, crop), differing only in prompt/material
// grid/atlas request size. Every step is console.log'd (so it shows up in server logs regardless
// of caller) and, if onProgress is given, forwarded for live UI feedback too.
async function runTilesetPipeline<M extends string>(opts: PipelineOpts<M>): Promise<void> {
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

  await Promise.all(rects.map(async rect => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const dir = path.join(TILESETS_DIR, slug, rect.material);
    await mkdir(dir, { recursive: true });
    const tile = await sharp(atlas).extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).jpeg({ quality: 90 }).toBuffer();
    await writeFile(path.join(dir, `${rect.material}_01.jpg`), tile);
  }));
  report(`Wrote tiles to storage/tilesets/${slug}/`);
  report(`Generated tileset in ${formatElapsed(Date.now() - startedAt)}.`);
}

// ARCHIVED — the original 8-material/2:1 pipeline. No longer called anywhere active (the whole
// app now uses generateExtendedTileset below, uniformly, regardless of model) — kept in place
// as a backup of the 2:1 prompt/crop approach in case it's revisited, not wired into any route
// or ensureTilesetSupport. buildTilesetPrompt, computeTileRects, TileRect/TileRectResult below
// are this backup's supporting pieces, same status.
//
// title becomes the folder/matching key (slugified); theme is the text substituted into the
// prompt — decoupled so a curated, richer prompt can still be found by a short dungeon-theme
// keyword.
export async function generateTileset(title: string, theme: string, apiKey: string, model: string, onProgress?: (message: string) => void): Promise<void> {
  await runTilesetPipeline({
    title, theme, apiKey, model,
    prompt: buildTilesetPrompt(theme),
    atlasSize: undefined,
    resizeWidth: 256, resizeHeight: 128,
    cols: 4, rows: 2,
    materials: DUNGEON_MATERIALS,
    sourceFolder: 'source',
    onProgress,
  });
}

// 16-material, 4x4-grid, 1:1 — the only tileset pipeline in active use (see generateTileset above
// for the archived 2:1 predecessor). Always requests a literal 1024x1024 atlas — the one size
// confirmed valid across every model this app supports — so there's no per-model size branching
// needed here at all.
export async function generateExtendedTileset(title: string, theme: string, apiKey: string, model: string, onProgress?: (message: string) => void): Promise<void> {
  await runTilesetPipeline({
    title, theme, apiKey, model,
    prompt: buildExtendedTilesetPrompt(theme),
    atlasSize: '1024x1024',
    resizeWidth: 512, resizeHeight: 512,
    cols: 4, rows: 4,
    materials: EXTENDED_TILE_MATERIALS,
    sourceFolder: 'source_extended',
    onProgress,
  });
}

// Called from generateDungeon() once a manifest's theme is known. Never throws — a failed or
// skipped generation just means the dungeon renders with the client's existing default-pack
// fallback (dungeonThemes.ts), same as today's behaviour for an unrecognised theme.
export async function ensureTilesetSupport(theme: string, config: AppConfig): Promise<void> {
  if (hasTilesetSupport(theme)) return;
  if (!config.image.generateTilesets) return;
  const apiKey = config.apiKeys.openai;
  if (!apiKey) return;
  try {
    await generateExtendedTileset(theme, theme, apiKey, config.image.model);
  } catch (err) {
    logError('dungeon/tilesets:ensureTilesetSupport', err);
  }
}
