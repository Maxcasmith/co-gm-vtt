import { createHash } from 'crypto';
import path from 'path';
import sharp from 'sharp';
import type { AppConfig, DungeonMaterialSpec, CampaignGenre, GenreCategoryMap } from 'shared';
import { DUNGEON_STYLE_PACKS, slugifyTheme } from 'shared';
import { TILESETS_DIR, readGenreTileMap, writeGenreTileMap } from '../storage.ts';
import { getMediaStore } from '../storage/index.ts';
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

// The generated tileset's own folder name, and what Dungeon.tilesetSlug and the genre tile map
// both address art by. MUST already be slugified: runTilesetPipeline slugifies again when writing
// the folder, and /api/tilesets rejects any slug that isn't its own slugification — so a separator
// that doesn't survive slugifyTheme (the old '--') wrote art to one folder, addressed another, and
// 404'd every tile of it. Exported so that invariant is checkable (see tilesets.selfcheck.ts).
export function tilesetSlugFor(themeSlug: string, materials: DungeonMaterialSpec[]): string {
  return `${themeSlug}-${hashMaterials(materials)}`;
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
  await getMediaStore().put(path.join(sourceDir, `${opts.sourceFolder}_01.${sourceExt}`), rawAtlas);
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
    const n = (counts.get(rect.material) ?? 0) + 1;
    counts.set(rect.material, n);
    const tile = await sharp(atlas).extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).jpeg({ quality: 90 }).toBuffer();
    await getMediaStore().put(path.join(dir, `${rect.material}_${String(n).padStart(2, '0')}.jpg`), tile);
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

// Records each distinct material this tileset actually generated, under its category, keyed by
// its own freeform key (e.g. modern.horror.tile["bloodstained-tile"] = { path, description }) — so
// a later dungeon of the same setting/tone can be shown the SPECIFIC existing variants with what
// they look like (see dungeon/genreTiles.ts), not just which categories exist. Reused materials
// only backfill a missing description (legacy entries had none). Best-effort: called after the
// tileset is already known good, never allowed to fail the caller.
async function recordGenreTileset(genre: CampaignGenre, fresh: DungeonMaterialSpec[], tilesetSlug: string | undefined, reused: DungeonMaterialSpec[] = []): Promise<void> {
  try {
    const map = await readGenreTileMap();
    const bucket: GenreCategoryMap = { ...(map[genre.setting]?.[genre.tone] ?? {}) };
    let changed = false;
    if (tilesetSlug) {
      for (const m of fresh) {
        bucket[m.category] = { ...(bucket[m.category] ?? {}), [m.key]: { path: path.join(TILESETS_DIR, tilesetSlug, m.key), description: m.description } };
        changed = true;
      }
    }
    for (const m of reused) {
      const entry = bucket[m.category]?.[m.key];
      if (!entry || entry.description) continue;
      bucket[m.category] = { ...bucket[m.category], [m.key]: { ...entry, description: m.description } };
      changed = true;
    }
    if (!changed) return;
    await writeGenreTileMap({ ...map, [genre.setting]: { ...(map[genre.setting] ?? {}), [genre.tone]: bucket } });
  } catch (err) {
    logError('dungeon/tilesets:recordGenreTileset', err);
  }
}

// A genre tile map value is always "<TILESETS_DIR>/<slug>/<materialKey>" (see recordGenreTileset),
// and the client addresses art by slug + material key rather than by path (see dungeonThemes.ts),
// so this pulls the slug back out. Anything not in that exact shape is treated as unusable rather
// than guessed at — a bad entry costs one redundant generation, never a missing texture.
function slugFromGenreMapPath(mapPath: string): string | undefined {
  const parts = mapPath.split('/');
  return parts.length === 3 && parts[0] === TILESETS_DIR ? parts[1] : undefined;
}

export interface TilesetResolution {
  /** Goes on Dungeon.tilesetSlug — where this dungeon's own freshly generated art lives. */
  tilesetSlug: string;
  /** Goes on Dungeon.materialSources — only the materials taken from some OTHER tileset. */
  materialSources?: Record<string, string>;
}

/**
 * Splits a map's materials into the ones whose art already exists for this genre (returned as
 * materialSources, pointing at the tileset they live in) and the ones that still have to be drawn.
 * Exported and pure so this one branch — the whole point of the genre tile map, and the one that
 * silently costs money or silently loses a texture when it's wrong — is checkable without a real
 * image generation (see tilesets.reuse.selfcheck.ts).
 *
 * Reuse is the DEFAULT, not something the model has to ask for: a material whose key AND category
 * already exist in this campaign's bucket is that material, so it's reused unless the model
 * explicitly sets `reuse: false` to force a different look under the same name. Relying on the
 * model to opt in meant a forgotten flag silently paid for art that already existed.
 */
export function splitReusableMaterials(
  materials: DungeonMaterialSpec[],
  genreMap: GenreCategoryMap,
): { fresh: DungeonMaterialSpec[]; materialSources: Record<string, string> } {
  const materialSources: Record<string, string> = {};
  const fresh: DungeonMaterialSpec[] = [];
  for (const m of materials) {
    const existing = m.reuse === false ? undefined : genreMap[m.category]?.[m.key]?.path;
    const sourceSlug = existing ? slugFromGenreMapPath(existing) : undefined;
    if (sourceSlug) materialSources[m.key] = sourceSlug;
    else fresh.push(m);
  }
  return { fresh, materialSources };
}

// Called once a manifest's theme and materials are known. Never throws — a failed or skipped
// generation just means the dungeon renders with the client's existing default-pack fallback
// (dungeonThemes.ts), same as today's behaviour for an unrecognised theme.
//
// Materials the manifest LLM marked `reuse` AND that actually resolve in this genre's tile map are
// not drawn again: they're returned as materialSources entries pointing at the tileset they already
// live in, and only the remainder is sent to the image model. A dungeon whose materials are all
// reused costs zero image generations. `genre` is optional (undefined on campaigns predating the
// field), and without it nothing is reused or recorded — identical behaviour to before the map
// existed.
export async function ensureTilesetSupport(theme: string, materials: DungeonMaterialSpec[], config: AppConfig, genre?: CampaignGenre): Promise<TilesetResolution> {
  const slug = slugifyTheme(theme);
  if (hasTilesetSupport(theme)) return { tilesetSlug: slug };
  if (!materials.length) return { tilesetSlug: slug };

  const genreMap = genre ? (await readGenreTileMap())[genre.setting]?.[genre.tone] ?? {} : {};
  const { fresh, materialSources } = splitReusableMaterials(materials, genreMap);
  const sources = Object.keys(materialSources).length ? { materialSources } : {};
  const reused = materials.filter(m => m.key in materialSources);
  // Everything this dungeon needs already exists somewhere — nothing to draw, only descriptions to backfill.
  if (!fresh.length) {
    if (genre) await recordGenreTileset(genre, [], undefined, reused);
    return { tilesetSlug: slug, ...sources };
  }

  const tilesetSlug = tilesetSlugFor(slug, fresh);
  if ((await getMediaStore().list(path.join(TILESETS_DIR, tilesetSlug))).length > 0) {
    if (genre) await recordGenreTileset(genre, fresh, tilesetSlug, reused);
    return { tilesetSlug, ...sources };
  }
  if (!config.image.generateTilesets) return { tilesetSlug: slug, ...sources };
  const apiKey = config.apiKeys.openai;
  if (!apiKey) return { tilesetSlug: slug, ...sources };
  try {
    await generateExtendedTileset(tilesetSlug, theme, fresh, apiKey, config.image.model);
    if (genre) await recordGenreTileset(genre, fresh, tilesetSlug, reused);
    return { tilesetSlug, ...sources };
  } catch (err) {
    logError('dungeon/tilesets:ensureTilesetSupport', err);
    return { tilesetSlug: slug, ...sources };
  }
}
