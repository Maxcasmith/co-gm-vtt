import type { CampaignGenre } from 'shared';
import { readGenreTileMap } from '../storage.ts';

/**
 * The prompt block that shows a model which floor materials already have art for this campaign's
 * genre, so it can reuse one instead of having a fresh tileset drawn. Shared by both map-authoring
 * calls — dungeon/manifest.ts's fetchManifest and the arena terrain in
 * session-processor/imagePrompts.ts's generateEncounterEnemies — so the reuse instructions can
 * never drift apart between the two.
 *
 * Returns '' when there's no genre (campaigns predating the field) or nothing generated for it
 * yet, which leaves the calling prompt exactly as it was before the genre tile map existed.
 *
 * The model's answer is never trusted on its own: ensureTilesetSupport only honours a `reuse` flag
 * whose key actually resolves in the map, so a hallucinated one just costs a normal generation.
 */
export async function buildGenreTileBlock(genre: CampaignGenre | undefined): Promise<string> {
  if (!genre) return '';
  const entries = Object.entries((await readGenreTileMap())[genre] ?? {});
  if (!entries.length) return '';

  const listed = entries.map(([category, keys]) => `- ${category}: ${Object.keys(keys ?? {}).join(', ')}`).join('\n');
  return `\nThis campaign's genre is "${genre}". These specific floor materials ALREADY HAVE ART for it, grouped by category — drawing them again costs real money, so reuse them wherever they genuinely fit:\n${listed}\nTo reuse one, set "material" to that exact key (verbatim, same spelling/hyphenation), "materialCategory" to its category above, and "materialReuse": true. Write "materialDescription" anyway (it's ignored for reused art, but keep it accurate).\nOnly invent a new "material" key — with "materialReuse": false — when none of the above are actually close enough. A cobblestone street when only "wood" and "iron" exist is a genuinely new material; a "grey flagstone" floor when "cracked-stone" already exists is not, reuse it. Don't force a bad match just to save a generation, and never set "materialReuse": true for a key that isn't listed above.\n`;
}
