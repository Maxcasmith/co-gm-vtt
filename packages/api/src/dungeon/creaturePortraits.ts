import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { AppConfig, DungeonEntity } from 'shared';
import { slugifyTheme } from 'shared';
import { CREATURES_DIR } from '../storage.ts';
import { generateTilesetAtlas } from '../providers/openai.ts';
import { buildCreaturePortraitPrompt } from '../session-processor/imagePrompts.ts';
import { computeGridRects } from './tilesets.ts';
import { logError } from '../logger.ts';

const BATCH_SIZE = 16;

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
async function writeStatsIfMissing(slug: string, name: string, cr: number, creatureType: string | undefined): Promise<void> {
  const statsPath = path.join(CREATURES_DIR, slug, 'stats.json');
  if (existsSync(statsPath)) return;
  await mkdir(path.join(CREATURES_DIR, slug), { recursive: true });
  await writeFile(statsPath, JSON.stringify({ name, cr, creatureType }, null, 2), 'utf-8');
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
    statsWrites.push(writeStatsIfMissing(slug, entity.statBlock.name, entity.statBlock.cr, entity.statBlock.creatureType));
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

async function generateBatch(batch: PendingPortrait[], apiKey: string, model: string): Promise<void> {
  console.log(`[creaturePortraits] generating portraits for: ${batch.map(b => b.name).join(', ')}`);
  const prompt = buildCreaturePortraitPrompt(batch.map(b => ({ name: b.name, appearance: b.appearance, ...(b.isBoss ? { isBoss: true } : {}) })));

  console.log(`[creaturePortraits] requesting atlas from ${model}…`);
  const rawAtlas = await generateTilesetAtlas(prompt, apiKey, model, '1024x1024');

  const { width, height } = await sharp(rawAtlas).metadata();
  if (!width || !height) throw new Error('Portrait atlas has no dimensions');

  const slugs = batch.map(b => b.slug);
  const { rects, warning } = computeGridRects(width, height, 4, 4, slugs);
  if (warning) console.warn(`[creaturePortraits] ${warning}`);

  await Promise.all(rects.map(async rect => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const dir = path.join(CREATURES_DIR, rect.material);
    await mkdir(dir, { recursive: true });
    const tile = await sharp(rawAtlas).extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }).jpeg({ quality: 90 }).toBuffer();
    await writeFile(path.join(dir, 'portrait_01.jpg'), tile);
  }));
  console.log(`[creaturePortraits] wrote ${rects.length} portraits to storage/creatures/`);
}
