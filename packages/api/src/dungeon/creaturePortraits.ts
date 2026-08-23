import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { AppConfig, DungeonEntity, EnemyStatBlock } from 'shared';
import { slugifyTheme } from 'shared';
import type { GridRect } from './tilesets.ts';
import { CREATURES_DIR } from '../storage.ts';
import { generateTilesetAtlas } from '../providers/openai.ts';
import { buildCreaturePortraitPrompt } from '../session-processor/imagePrompts.ts';
import { detectGridBoundaries } from './gridDetect.ts';
import { logError } from '../logger.ts';

const BATCH_SIZE = 16;
const GRID_SIZE = 4; // 16 cells, 4x4
const ATLAS_SIZE = 1024; // fixed size every raw atlas gets force-resized to before grid detection/cropping
const INSET_FRACTION = 0.02; // extra margin past the detected line, to clear its thickness/anti-aliasing

// Red key-color check passed into the shared detector (see gridDetect.ts/props.ts) — distinguishes
// buildCreaturePortraitPrompt's flat red background (kept in the final portrait, unlike props'
// magenta which gets chroma-keyed out) from real drawn portrait content.
const RED_KEY: [number, number, number] = [224, 20, 20];
const RED_THRESHOLD = 70;
function isRed(r: number, g: number, b: number): boolean {
  const dr = r - RED_KEY[0], dg = g - RED_KEY[1], db = b - RED_KEY[2];
  return dr * dr + dg * dg + db * db < RED_THRESHOLD * RED_THRESHOLD;
}

// Blank filler cells (padding an under-full batch out to 16, see buildCreaturePortraitPrompt) used
// to be solid black — indistinguishable from the thin black grid lines to detectGridBoundaries's
// darkness scan, which corrupted boundary detection for any batch under 16 real creatures (the
// common case). Now magenta: distinct from both the black grid lines and the red creature
// background, so a blank cell can never register as a line, and isBackgroundOrBlank below keeps it
// out of the "real content" count for the outer-border trim too.
const MAGENTA_KEY: [number, number, number] = [255, 0, 255];
const MAGENTA_THRESHOLD = 70;
function isMagenta(r: number, g: number, b: number): boolean {
  const dr = r - MAGENTA_KEY[0], dg = g - MAGENTA_KEY[1], db = b - MAGENTA_KEY[2];
  return dr * dr + dg * dg + db * db < MAGENTA_THRESHOLD * MAGENTA_THRESHOLD;
}
function isBackgroundOrBlank(r: number, g: number, b: number): boolean {
  return isRed(r, g, b) || isMagenta(r, g, b);
}

// slugifyTheme is a generic slugifier despite the name (see shared/types/dungeon.ts) — reused
// here for creature names so "Giant Fire Beetle" -> "giant-fire-beetle", same dedup/matching
// philosophy tilesets.ts uses for theme keywords.
function portraitSlug(name: string): string {
  return slugifyTheme(name);
}

function portraitUrl(slug: string): string {
  return `/api/creatures/${slug}/portrait_01.jpg`;
}

function hasPortrait(slug: string): boolean {
  return existsSync(path.join(CREATURES_DIR, slug, 'portrait_01.jpg'));
}

// Sidecar next to the portrait — the bestiary manifest reads storage/creatures/<slug>/stats.json
// the same way tilesets.ts reads directory names, so a creature only needs to appear here once.
// Only "printed stat block" fields survive here (not id/ownerId/conditions/portraitSrc, which are
// per-encounter runtime state) — first-seen wins, same global-reuse contract as the portrait itself,
// so a "Skeleton" from one dungeon's stat block is what every future encounter's bestiary entry shows.
async function writeStatsIfMissing(slug: string, statBlock: EnemyStatBlock): Promise<void> {
  const statsPath = path.join(CREATURES_DIR, slug, 'stats.json');
  if (existsSync(statsPath)) return;
  const { name, cr, creatureType, hp, ac, speed, stats, attacks, actions, appearance, role, damageResistances, damageVulnerabilities, damageImmunities } = statBlock;
  await mkdir(path.join(CREATURES_DIR, slug), { recursive: true });
  await writeFile(statsPath, JSON.stringify({ name, cr, creatureType, hp, ac, speed, stats, attacks, actions, appearance, role, damageResistances, damageVulnerabilities, damageImmunities }, null, 2), 'utf-8');
}

// Synchronous, deterministic — sets every creature entity's portraitSrc to where its portrait
// lives (or will live), regardless of whether the file exists yet. Called before generateDungeon()
// returns, so the dungeon shipped to the client always has a src to try; generateCreaturePortraits
// below is what actually gets a file to exist at that path, in the background. Same name always
// resolves to the same slug/path — that's the cross-dungeon/cross-campaign dedup.
export function assignPortraitSrcs(entities: DungeonEntity[]): void {
  for (const entity of entities) {
    if (entity.type !== 'creature' || !entity.statBlock) continue;
    entity.statBlock.portraitSrc = portraitUrl(portraitSlug(entity.statBlock.name));
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface PendingPortrait {
  slug: string;
  name: string;
  appearance: string;
  isBoss: boolean | undefined;
}

// Fire-and-forget — called unawaited from generateDungeon(), never blocks dungeon generation
// (unlike tilesets/props, which the dungeon now waits on — see dungeon/index.ts). Takes the raw
// entity list rather than a built Dungeon so it can fire before the Dungeon record exists, letting
// its atlas request overlap with the tileset/prop ones instead of queueing behind them. Dedupes by
// creature name (global across every dungeon/campaign — a "Skeleton" generated once is reused
// everywhere, same reuse philosophy as tilesets.ts), skips anything already on disk, batches
// whatever's left into groups of 16, and reuses the exact atlas-request/resize/crop shape
// tilesets.ts uses for tile textures (generateTilesetAtlas, computeGridRects).
export async function generateCreaturePortraits(entities: DungeonEntity[], config: AppConfig): Promise<void> {
  const statsWrites: Promise<void>[] = [];
  const seen = new Set<string>();
  const needed: PendingPortrait[] = [];
  for (const entity of entities) {
    if (entity.type !== 'creature' || !entity.statBlock) continue;
    const slug = portraitSlug(entity.statBlock.name);
    statsWrites.push(writeStatsIfMissing(slug, entity.statBlock));
    if (!entity.statBlock.appearance || seen.has(slug) || hasPortrait(slug)) continue;
    seen.add(slug);
    needed.push({ slug, name: entity.statBlock.name, appearance: entity.statBlock.appearance, isBoss: entity.statBlock.isBoss });
  }
  await Promise.all(statsWrites);

  const apiKey = config.apiKeys.openai;
  if (!apiKey || !needed.length) return;

  for (const batch of chunk(needed, BATCH_SIZE)) {
    try {
      await generateBatch(batch, apiKey, config.image.model);
    } catch (err) {
      logError('dungeon/creaturePortraits:generateCreaturePortraits', err);
    }
  }
}

const MAX_ATLAS_ATTEMPTS = 3;

async function generateBatch(batch: PendingPortrait[], apiKey: string, model: string): Promise<void> {
  console.log(`[creaturePortraits] generating portraits for: ${batch.map(b => b.name).join(', ')}`);
  const prompt = buildCreaturePortraitPrompt(batch.map(b => ({ name: b.name, appearance: b.appearance, ...(b.isBoss ? { isBoss: true } : {}) })));

  // A detected grid shape that doesn't match the requested GRID_SIZE x GRID_SIZE isn't just cosmetic
  // — cropping against it maps batch[i] to detected-column-i, which silently grabs the wrong region
  // (confirmed live: a mismatched 6x1 detection produced a "Herald" portrait that was actually two
  // OTHER creatures spliced together across a real divider). Root cause for under-full batches:
  // buildCreaturePortraitPrompt used to pad unused cells with solid-BLACK "blank square" placeholders
  // (to keep the real cells' grid consistent) — indistinguishable from the thin black dividing lines
  // to detectGridBoundaries's darkness scan, corrupting the boundary math wherever blanks were. Fixed
  // at the source: blanks are now magenta (see isBackgroundOrBlank below), so they never read as
  // dark. This reject-and-retry stays as a second line of defense against whatever the model draws
  // wrong on its own — never crop against a shape we didn't ask for.
  let atlas: Buffer | undefined, rows: number[] | undefined, cols: number[] | undefined;
  for (let attempt = 1; attempt <= MAX_ATLAS_ATTEMPTS; attempt++) {
    console.log(`[creaturePortraits] requesting atlas from ${model}… (attempt ${attempt}/${MAX_ATLAS_ATTEMPTS})`);
    const rawAtlas = await generateTilesetAtlas(prompt, apiKey, model, '1024x1024');

    // Persisted unmodified, before the resize/crop below — same review purpose as props.ts's _source
    // save. Not exposed through any route or the bestiary manifest (routes/creatures.ts skips this
    // directory): this is just an on-disk copy to inspect later, not a feature.
    const rawMeta = await sharp(rawAtlas).metadata();
    const sourceExt = rawMeta.format === 'png' ? 'png' : 'jpg';
    const sourceDir = path.join(CREATURES_DIR, '_source');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, `portraits_${Date.now()}.${sourceExt}`), rawAtlas);

    // Force-resized to a fixed size before detection/cropping, same as props.ts — the model doesn't
    // always return exactly the requested size, but the grid must still be evenly 4x4 for tileSize math.
    const candidateAtlas = await sharp(rawAtlas).resize(ATLAS_SIZE, ATLAS_SIZE, { fit: 'fill' }).toBuffer();
    const { width, height } = await sharp(candidateAtlas).metadata();
    if (!width || !height) throw new Error('Portrait atlas has no dimensions');

    // buildCreaturePortraitPrompt asks the model to draw a thin black line on every internal cell
    // boundary — a visual fence keeping busts from bleeding into the row below. Crop between whatever
    // lines actually got drawn (same detectGridBoundaries pipeline props.ts uses), never a naive even
    // division — a bust drawn slightly oversized bleeds across the row boundary otherwise, cutting two
    // different creatures' heads in half into the same cell.
    const boundaries = await detectGridBoundaries(candidateAtlas, width, height, isBackgroundOrBlank);
    const actualCols = boundaries.cols.length - 1, actualRows = boundaries.rows.length - 1;
    if (actualCols === GRID_SIZE && actualRows === GRID_SIZE) {
      atlas = candidateAtlas; rows = boundaries.rows; cols = boundaries.cols;
      break;
    }
    console.warn(`[creaturePortraits] attempt ${attempt}: detected a ${actualCols}x${actualRows} grid, not the requested ${GRID_SIZE}x${GRID_SIZE} — discarding and ${attempt < MAX_ATLAS_ATTEMPTS ? 're-requesting' : 'giving up'}`);
  }
  if (!atlas || !rows || !cols) {
    console.error(`[creaturePortraits] gave up on batch [${batch.map(b => b.name).join(', ')}] after ${MAX_ATLAS_ATTEMPTS} attempts — no portraits written, will retry whenever this creature is next needed`);
    return;
  }

  // GRID_SIZE x GRID_SIZE is guaranteed at this point (the loop above only breaks on an exact match),
  // so batch[i] maps onto the real, requested grid — no dynamic actualCols/actualRows guessing needed.
  const rects: GridRect[] = [];
  batch.forEach((b, i) => {
    const r = Math.floor(i / GRID_SIZE), c = i % GRID_SIZE;
    rects.push({ material: b.slug, left: cols[c]!, top: rows[r]!, width: cols[c + 1]! - cols[c]!, height: rows[r + 1]! - rows[r]! });
  });

  await Promise.all(rects.map(async rect => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const dir = path.join(CREATURES_DIR, rect.material);
    await mkdir(dir, { recursive: true });
    const insetX = Math.round(rect.width * INSET_FRACTION);
    const insetY = Math.round(rect.height * INSET_FRACTION);
    const tile = await sharp(atlas).extract({
      left: rect.left + insetX,
      top: rect.top + insetY,
      width: rect.width - insetX * 2,
      height: rect.height - insetY * 2,
    }).jpeg({ quality: 90 }).toBuffer();
    await writeFile(path.join(dir, 'portrait_01.jpg'), tile);
  }));
  console.log(`[creaturePortraits] wrote ${rects.length} portraits to storage/creatures/`);
}
