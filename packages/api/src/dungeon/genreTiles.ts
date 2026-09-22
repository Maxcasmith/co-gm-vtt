import type { AppConfig, CampaignGenre, GenreSetting, GenreTone } from 'shared';
import { GENRE_SETTINGS, GENRE_TONES, DEFAULT_CAMPAIGN_GENRE } from 'shared';
import { readGenreTileMap } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { buildGenreClassificationPrompt } from '../prompts.ts';
import { parseLlmJson } from '../utils/llmJson.ts';
import { logDebug, logError } from '../logger.ts';

/** Pure so the validation is checkable without an LLM (see genreTiles.selfcheck.ts): anything
 * outside the fixed sets falls back to the default rather than inventing a new tile bucket. */
export function parseGenreClassification(raw: string): { genre: CampaignGenre; fitNote?: string } {
  try {
    const parsed = parseLlmJson<{ setting?: string; tone?: string; fit?: string; fitNote?: string }>(raw);
    const setting = (GENRE_SETTINGS as readonly string[]).includes(parsed.setting ?? '') ? parsed.setting as GenreSetting : DEFAULT_CAMPAIGN_GENRE.setting;
    const tone = (GENRE_TONES as readonly string[]).includes(parsed.tone ?? '') ? parsed.tone as GenreTone : DEFAULT_CAMPAIGN_GENRE.tone;
    const fitNote = parsed.fit === 'poor' ? parsed.fitNote?.trim() || 'no note given' : undefined;
    return { genre: { setting, tone }, ...(fitNote ? { fitNote } : {}) };
  } catch {
    return { genre: DEFAULT_CAMPAIGN_GENRE };
  }
}

/** Never throws — a failed call lands on the default genre, which only costs some tile reuse. */
export async function classifyCampaignGenre(tags: string[], config: AppConfig): Promise<CampaignGenre> {
  // Saved configs never pick up newly added features, so fall back to the dungeon-generation
  // provider every install that can create a campaign already has.
  const feature = hasFeatureProvider(config, 'genreClassification') ? 'genreClassification' : 'dungeonGeneration';
  try {
    const raw = await getFeatureProvider(config, feature).complete(buildGenreClassificationPrompt(tags));
    const { genre, fitNote } = parseGenreClassification(raw);
    if (fitNote) logDebug(`genre classification poor fit for [${tags.join(', ')}] -> ${genre.setting}/${genre.tone}: ${fitNote}`);
    return genre;
  } catch (err) {
    logError('dungeon/genreTiles:classifyCampaignGenre', err);
    return DEFAULT_CAMPAIGN_GENRE;
  }
}

/**
 * The prompt block that shows a model which floor materials already have art for this campaign's
 * setting and tone, so it can reuse one instead of having a fresh tileset drawn. Shared by both
 * map-authoring calls — dungeon/manifest.ts's fetchManifest and the arena terrain in
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
  const entries = Object.entries((await readGenreTileMap())[genre.setting]?.[genre.tone] ?? {});
  if (!entries.length) return '';

  const listed = entries.map(([category, keys]) =>
    `- ${category}:\n${Object.entries(keys ?? {}).map(([key, e]) => `  - ${key}${e.description ? ` — ${e.description}` : ''}`).join('\n')}`,
  ).join('\n');
  return `\nThis campaign is ${genre.setting} with a ${genre.tone} tone. These specific floor materials ALREADY HAVE ART for it, grouped by category — drawing them again costs real money, so reuse them wherever they genuinely fit. When a category has several variants, pick the one whose look fits this ${genre.tone} tone and the specific room:\n${listed}\nTo reuse one, set "material" to that exact key (verbatim, same spelling/hyphenation) and "materialCategory" to its category above — that alone reuses its art, no flag needed. Write "materialDescription" anyway, describing that material's actual look.\nFor anything the list doesn't cover, invent a new "material" key and describe it. A cobblestone street when only "wood" and "iron" exist is a genuinely new material; a "grey flagstone" floor when "cracked-stone" already exists is not, reuse that instead. Don't force a bad match just to save a generation — a wrong floor is worse than a new one.\nOnly set "materialReuse": false when you deliberately want DIFFERENT art under a key that is already listed above (e.g. a pristine "wood" floor where the listed "wood" is rotted); prefer a distinct new key for that.\n`;
}
