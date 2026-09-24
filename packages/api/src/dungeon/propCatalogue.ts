import path from 'path';
import type { CampaignGenre, PropCatalogueEntry, PropCategory, PropCategoryMap, PropSpec } from 'shared';
import { WALL_MOUNTED_CATEGORIES, propSizeXY } from 'shared';
import { PROPS_DIR, readPropCatalogue, writePropCatalogue } from '../storage.ts';
import { logError } from '../logger.ts';

/**
 * Where a bucket's sprites live: props/<setting>/<tone>/<noun>/sprite_01.png.
 *
 * Bucketed rather than the flat props/<noun>/ the pre-catalogue pipeline used, because the whole
 * point of the catalogue is that one noun has DIFFERENT art per bucket — a `table` is plain oak in
 * fantasy/standard and splintered and blood-stained in modern/horror. A flat path cannot express
 * that, and it would also make the old three-quarter sprites silently resolve into new dungeons and
 * mix two art styles inside one room.
 *
 * Shared by the write side (props.ts), the catalogue entries below, and the URL the client is given,
 * so all three agree on the same location for the same sprite — same discipline slugifyTheme keeps
 * for tilesets.
 */
export function propDir(genre: CampaignGenre, noun: string): string {
  return path.join(PROPS_DIR, genre.setting, genre.tone, noun);
}

export function propSpriteUrl(genre: CampaignGenre, noun: string): string {
  return `/api/props/${genre.setting}/${genre.tone}/${noun}/sprite_01.png`;
}

/**
 * Splits a dungeon's prop types into the ones whose sprite already exists for this bucket and the
 * ones that still have to be drawn. Exported and pure for the same reason splitReusableMaterials is
 * (see tilesets.ts): this is the branch that silently costs money when it's wrong, and it must be
 * checkable without a real image generation — see propCatalogue.selfcheck.ts.
 *
 * Reuse is unconditional on an exact noun+category hit. There is deliberately no `reuse: false`
 * opt-out like materials have: a material's key is a freeform label the model invents per dungeon
 * ("wood" could reasonably mean two different floors), where a prop noun IS the object. If it wants
 * a different-looking table it names a different table.
 */
export function splitReusableProps(
  props: PropSpec[],
  catalogue: PropCategoryMap,
): { fresh: PropSpec[]; reused: PropSpec[] } {
  const fresh: PropSpec[] = [];
  const reused: PropSpec[] = [];
  for (const prop of props) {
    if (catalogue[prop.category]?.[prop.noun]) reused.push(prop);
    else fresh.push(prop);
  }
  return { fresh, reused };
}

/**
 * The prompt block naming which prop nouns already have art for this campaign's bucket, so the
 * dressing call reuses one instead of inventing a near-duplicate spelling nobody asked for. Direct
 * counterpart of genreTiles.ts's buildGenreTileBlock, and the reason it exists is the same: with no
 * such block the old pipeline produced `crate`, `wooden-crate`, `storage-crate` and
 * `blackwood-crate` as four separately-paid-for sprites of one object.
 *
 * `categories` narrows it to what the rooms actually asked for (a walk-in freezer gets `storage` and
 * `machinery`, never `bedding`). That filter is what keeps this bounded as the catalogue grows —
 * an empty list means no filter, which is correct for a caller that has no per-room categories.
 *
 * Returns '' when there's no genre, nothing in the bucket, or nothing in the requested categories,
 * leaving the calling prompt exactly as it reads without a catalogue.
 */
export function buildPropNounBlock(catalogue: PropCategoryMap, categories: PropCategory[]): string {
  const wanted = categories.length ? categories : (Object.keys(catalogue) as PropCategory[]);
  // Never offer wall-mounted art for reuse, even when a room asks for no categories and so sees the
  // whole bucket — the catalogue still holds signage drawn before it was excluded.
  const lines = [...new Set(wanted)].filter(c => !WALL_MOUNTED_CATEGORIES.includes(c))
    .map(category => {
      const nouns = Object.keys(catalogue[category] ?? {}).sort();
      return nouns.length ? `- ${category}: ${nouns.join(', ')}` : '';
    })
    .filter(Boolean);
  if (!lines.length) return '';

  return `\nThese props ALREADY HAVE ART for this setting and tone, grouped by category — drawing one again costs real money, so reuse them wherever they genuinely fit:\n${lines.join('\n')}\nTo reuse one, set "prop" to that exact spelling (verbatim, same hyphenation) and "category" to its category above. That alone reuses the sprite.\nInvent a new prop only for an object the list genuinely doesn't cover. A "storage-crate" when "crate" is already listed is the same object — reuse it. A "helm-console" when only "desk" exists is a different object — invent it. Don't force a bad match to save a generation; a wrong prop is worse than a new one.\n`;
}

/**
 * Records each prop sprite that was actually drawn, so the next dungeon in this bucket is offered it
 * by buildPropNounBlock. Mirrors tilesets.ts's recordGenreTileset, including its best-effort
 * contract: called only after the sprites are known good, and never allowed to fail the caller.
 *
 * Reused props only backfill missing metadata (an entry written before dimensions were recorded),
 * so a re-run never overwrites a description with a worse one.
 */
export async function recordPropSprites(genre: CampaignGenre, fresh: PropSpec[], reused: PropSpec[] = []): Promise<void> {
  try {
    const catalogue = await readPropCatalogue();
    const bucket: PropCategoryMap = { ...(catalogue[genre.setting]?.[genre.tone] ?? {}) };
    let changed = false;

    for (const prop of fresh) {
      const entry: PropCatalogueEntry = {
        path: propDir(genre, prop.noun),
        description: prop.description,
        sizeXY: prop.sizeXY,
      };
      bucket[prop.category] = { ...(bucket[prop.category] ?? {}), [prop.noun]: entry };
      changed = true;
    }

    for (const prop of reused) {
      const entry = bucket[prop.category]?.[prop.noun];
      if (!entry || (entry.description && propSizeXY(entry) !== undefined)) continue;
      bucket[prop.category] = {
        ...bucket[prop.category],
        [prop.noun]: {
          ...entry,
          description: entry.description ?? prop.description,
          sizeXY: propSizeXY(entry) ?? prop.sizeXY,
        },
      };
      changed = true;
    }

    if (!changed) return;
    await writePropCatalogue({
      ...catalogue,
      [genre.setting]: { ...(catalogue[genre.setting] ?? {}), [genre.tone]: bucket },
    });
  } catch (err) {
    logError('dungeon/propCatalogue:recordPropSprites', err);
  }
}

/** The bucket for one campaign's genre, or an empty one when the campaign predates the field. */
export async function readPropBucket(genre: CampaignGenre | undefined): Promise<PropCategoryMap> {
  if (!genre) return {};
  return (await readPropCatalogue())[genre.setting]?.[genre.tone] ?? {};
}
