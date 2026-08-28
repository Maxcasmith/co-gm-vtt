import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type { AppConfig, Character, CharacterStoryboard, ScenarioStoryboard, StoryboardQueuePayload } from 'shared';
import { CAMPAIGNS_DIR, getConfig, writeCharacterImage, writeCampaignImage, getCharacterStoryboard, getScenarioStoryboard, listCharacters } from '../storage.ts';
import { generateTilesetAtlas, describeImage } from '../providers/openai.ts';
import { getFeatureProvider } from '../providers/index.ts';
import { buildStoryboardPrompt, buildStoryboardBeatsPrompt, buildScenarioStoryboardPrompt, buildScenarioStoryboardBeatsPrompt } from '../session-processor/imagePrompts.ts';
import type { StoryboardSubject, StoryboardBeat, ScenarioStoryboardSubject } from '../session-processor/imagePrompts.ts';
import { logError } from '../logger.ts';

const COLS = 3;
const ROWS = 3;
export const SLIDE_COUNT = COLS * ROWS;

// Explicit 16:9 atlas, requested outright rather than left to atlasSizeFor(model)'s per-model
// default (the extended tileset/prop/creature pipelines all skip that default too, for the same
// reason: a size never confirmed to suit THIS grid shouldn't be assumed). Old bug (confirmed live,
// "stretched, bad quality" slides): no explicit size was requested at all, so it silently fell back
// to e.g. 1152x576 (2:1) for gpt-image-2, the prompt never told the model any pixel dimensions
// either, and the crop math then force-stretched (fit:'fill') whatever came back onto an unrelated
// hardcoded 3072x864 target — double distortion, model composing blind AND getting squashed after.
// Now the requested size, the prompt's stated dimensions, and the crop math are all the same numbers.
const ATLAS_W = 3840, ATLAS_H = 2160; // exact 16:9 overall (4K)
const TILE_W = ATLAS_W / COLS, TILE_H = ATLAS_H / ROWS; // 1280 x 720 — exact 16:9 per cell too

function slideUrl(campaignId: string, charId: string, n: number): string {
  return `/api/campaigns/${campaignId}/party/${charId}/storyboard/${n}`;
}

function scenarioSlideUrl(campaignId: string, n: number): string {
  return `/api/campaigns/${campaignId}/scenario-storyboard/${n}`;
}

export function parseStoryboardBeats(raw: string, count: number): StoryboardBeat[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned) as unknown;
  const valid = Array.isArray(parsed) && parsed.length === count && parsed.every(
    (b): b is StoryboardBeat => !!b && typeof b === 'object' && typeof (b as StoryboardBeat).visual === 'string' && typeof (b as StoryboardBeat).narration === 'string',
  );
  if (!valid) {
    throw new Error(`expected ${count} {visual, narration} beat objects, got ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return parsed as StoryboardBeat[];
}

async function describeAppearance(subject: StoryboardSubject, portraitBuffer: Buffer | null, apiKey: string): Promise<string> {
  const fallback = [subject.species, subject.class].filter(Boolean).join(' ') || 'an adventurer';
  if (!portraitBuffer) return fallback;
  try {
    return await describeImage(portraitBuffer.toString('base64'), apiKey);
  } catch (err) {
    logError('dungeon/storyboard:describeAppearance', err);
    return fallback;
  }
}

export interface StoryboardSlideResult {
  buffer: Buffer;
  caption: string;
}

export interface StoryboardPipelineResult {
  slides: StoryboardSlideResult[];
  // Unmodified model output, before the force-resize/crop below — same review purpose as
  // props.ts/creaturePortraits.ts's _source save. The caller decides whether/where to persist it
  // (the admin test sandbox does, for review; the real per-character path doesn't need to).
  rawAtlas: Buffer;
}

function logStep(label: string, body: string): void {
  console.log(`[storyboard] ${label}:\n${body}`);
}

// The reusable core: portrait appearance → ONE beats-extraction call (backstory condensed into
// exactly SLIDE_COUNT distinct visual/narration pairs) → image atlas built from those same beats →
// slice into 8 cells at the fixed TILE_W x TILE_H computed above. Beats extraction must finish
// before the image call, since the image prompt is built from its output — no longer run in
// parallel with a separate caption call the way this used to work. That separate call (each
// independently condensing the same raw backstory) is exactly what caused redundant slides and
// captions that described something other than what the panel actually showed: two independent
// reads of the same source material landing on different beats. One read, split once, shared by
// both the image prompt and the captions, fixes both. Shared by the real character-creation path
// and the admin "storyboard test" sandbox — the only difference between them is where the
// resulting buffers get written, which is the caller's job.
export async function runStoryboardPipeline(
  subject: StoryboardSubject,
  portraitBuffer: Buffer | null,
  config: AppConfig,
  onProgress?: (message: string) => void,
): Promise<StoryboardPipelineResult> {
  const apiKey = config.apiKeys.openai;
  if (!apiKey) throw new Error('No OpenAI API key configured');

  const backstory = subject.backstory ?? '';
  logStep(`backstory input for "${subject.name}" (${backstory.length} chars)`, backstory.slice(0, 2400));

  onProgress?.('Describing portrait appearance…');
  const appearanceDescription = await describeAppearance(subject, portraitBuffer, apiKey);
  logStep('appearance description', appearanceDescription);

  onProgress?.('Extracting key story beats…');
  const beatsRaw = await getFeatureProvider(config, 'storyboardCaptions').complete(buildStoryboardBeatsPrompt(subject, SLIDE_COUNT));
  const beats = parseStoryboardBeats(beatsRaw, SLIDE_COUNT);
  logStep('beats extracted', beats.map((b, i) => `  ${i + 1}. visual: ${b.visual}\n     narration: ${b.narration}`).join('\n'));

  const imagePrompt = buildStoryboardPrompt(subject, appearanceDescription, beats.map(b => b.visual), COLS, ROWS, ATLAS_W, ATLAS_H, TILE_W, TILE_H);
  logStep('image prompt sent', imagePrompt);

  onProgress?.(`Requesting storyboard atlas from ${config.image.model}…`);
  const rawAtlas = await generateTilesetAtlas(imagePrompt, apiKey, config.image.model, `${ATLAS_W}x${ATLAS_H}`);
  const rawMeta = await sharp(rawAtlas).metadata();
  logStep('atlas received', `${rawMeta.width}x${rawMeta.height} (${rawMeta.format})`);

  onProgress?.('Cropping atlas into slides…');
  // Force-resized to the exact requested size before cropping — same "whatever size the model
  // actually returned, resize to a deterministic target" step every atlas pipeline uses, since the
  // API doesn't reliably return the exact requested pixel count. Same idea as tilesets.ts's
  // computeGridRects, but not that function itself — it hard-assumes square tiles (derives one
  // tileSize from width alone and reuses it for height), which is correct for texture tiles but
  // would silently crop these 768x864 panels down to 768x768, losing the bottom of every one. Once
  // resized to the atlas size we explicitly requested above, dimensions are exact and cols/rows
  // divide evenly (3072/4, 1728/2) — no clamping or mismatch is possible here to warn about.
  const atlas = await sharp(rawAtlas).resize(ATLAS_W, ATLAS_H, { fit: 'fill' }).toBuffer();

  const slides = await Promise.all(beats.map(async (beat, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const buffer = await sharp(atlas)
      .extract({ left: col * TILE_W, top: row * TILE_H, width: TILE_W, height: TILE_H })
      .jpeg()
      .toBuffer();
    return { buffer, caption: beat.narration };
  }));

  logStep('final captions', slides.map((s, i) => `  ${i + 1}. ${s.caption}`).join('\n'));

  return { slides, rawAtlas };
}

// Fire-and-forget, called right after character creation — same contract as syncCharacterToWorldLore:
// runs after the response is already sent, gated on the settings toggle, never throws out to the caller.
export async function generateCharacterStoryboard(campaignId: string, character: Character): Promise<void> {
  try {
    const config = await getConfig();
    if (!config.image.generateStoryboard) return;
    if (!config.apiKeys.openai || !character.backstory?.trim()) return;

    const portraitBuffer = await readFile(path.join(CAMPAIGNS_DIR, character.portraitPath)).catch(() => null);
    const { slides: results } = await runStoryboardPipeline(character, portraitBuffer, config);

    const slides = await Promise.all(results.map(async ({ buffer, caption }, i) => {
      const n = i + 1;
      await writeCharacterImage(campaignId, character.id, `storyboard_slide_${n}.jpg`, buffer);
      return { url: slideUrl(campaignId, character.id, n), caption };
    }));

    const manifest: CharacterStoryboard = { characterId: character.id, slides, generatedAt: new Date().toISOString() };
    await writeCharacterImage(campaignId, character.id, 'storyboard.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  } catch (err) {
    logError('dungeon/storyboard:generateCharacterStoryboard', err);
  }
}

// Ordered oldest-created-first, so the opening-session slideshow plays characters in the order
// their players joined the campaign. Only characters with a fully generated storyboard are
// included — one still generating (or never generated) is silently skipped, not blocked on.
// The scenario entry (dungeon-crawl worlds only), when present, always plays first — it's the
// cold open for the situation itself, before any one character's own backstory.
export async function getStoryboardQueue(campaignId: string): Promise<StoryboardQueuePayload> {
  const characters = await listCharacters(campaignId);
  characters.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const [scenario, characterEntries] = await Promise.all([
    getScenarioStoryboard(campaignId),
    Promise.all(characters.map(async character => {
      const storyboard = await getCharacterStoryboard(campaignId, character.id);
      if (!storyboard || storyboard.slides.length !== SLIDE_COUNT) return null;
      return { characterId: character.id, characterName: character.name, slides: storyboard.slides };
    })),
  ]);

  const entries = characterEntries.filter((e): e is NonNullable<typeof e> => e !== null);
  if (scenario && scenario.slides.length === SLIDE_COUNT) {
    entries.unshift({ characterId: 'scenario', characterName: '', slides: scenario.slides });
  }

  return { entries };
}

// Scenario equivalent of runStoryboardPipeline — same beats-then-image two-pass pipeline and the
// same crop math, but no portrait/appearance-description step: there's no character to describe,
// the party doesn't exist yet. See buildScenarioStoryboardBeatsPrompt/buildScenarioStoryboardPrompt
// for the "never draw the party" rule this pipeline depends on to stay safe to run before any
// character has been created.
export async function runScenarioStoryboardPipeline(
  subject: ScenarioStoryboardSubject,
  config: AppConfig,
  onProgress?: (message: string) => void,
): Promise<StoryboardPipelineResult> {
  const apiKey = config.apiKeys.openai;
  if (!apiKey) throw new Error('No OpenAI API key configured');

  logStep(`synopsis input for "${subject.title}" (${subject.synopsis.length} chars)`, subject.synopsis.slice(0, 2400));

  onProgress?.('Extracting key scenario beats…');
  const beatsRaw = await getFeatureProvider(config, 'storyboardCaptions').complete(buildScenarioStoryboardBeatsPrompt(subject, SLIDE_COUNT));
  const beats = parseStoryboardBeats(beatsRaw, SLIDE_COUNT);
  logStep('beats extracted', beats.map((b, i) => `  ${i + 1}. visual: ${b.visual}\n     narration: ${b.narration}`).join('\n'));

  const imagePrompt = buildScenarioStoryboardPrompt(subject, beats.map(b => b.visual), COLS, ROWS, ATLAS_W, ATLAS_H, TILE_W, TILE_H);
  logStep('image prompt sent', imagePrompt);

  onProgress?.(`Requesting scenario storyboard atlas from ${config.image.model}…`);
  const rawAtlas = await generateTilesetAtlas(imagePrompt, apiKey, config.image.model, `${ATLAS_W}x${ATLAS_H}`);
  const rawMeta = await sharp(rawAtlas).metadata();
  logStep('atlas received', `${rawMeta.width}x${rawMeta.height} (${rawMeta.format})`);

  onProgress?.('Cropping atlas into slides…');
  const atlas = await sharp(rawAtlas).resize(ATLAS_W, ATLAS_H, { fit: 'fill' }).toBuffer();

  const slides = await Promise.all(beats.map(async (beat, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const buffer = await sharp(atlas)
      .extract({ left: col * TILE_W, top: row * TILE_H, width: TILE_W, height: TILE_H })
      .jpeg()
      .toBuffer();
    return { buffer, caption: beat.narration };
  }));

  logStep('final captions', slides.map((s, i) => `  ${i + 1}. ${s.caption}`).join('\n'));

  return { slides, rawAtlas };
}

// Kicked off in parallel with the dungeon manifest at campaign-creation time (see routes/campaigns.ts's
// dungeon-crawl branch) — never throws out to the caller, so the route can `await` this directly as
// its "is the checklist item done" signal without needing its own try/catch around it.
export async function generateScenarioStoryboard(campaignId: string, title: string, synopsis: string, config: AppConfig): Promise<void> {
  try {
    if (!config.image.generateStoryboard || !config.apiKeys.openai) return;

    const { slides: results } = await runScenarioStoryboardPipeline({ title, synopsis }, config);

    const slides = await Promise.all(results.map(async ({ buffer, caption }, i) => {
      const n = i + 1;
      await writeCampaignImage(campaignId, `scenario-storyboard_slide_${n}.jpg`, buffer);
      return { url: scenarioSlideUrl(campaignId, n), caption };
    }));

    const manifest: ScenarioStoryboard = { slides, generatedAt: new Date().toISOString() };
    await writeCampaignImage(campaignId, 'scenario-storyboard.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  } catch (err) {
    logError('dungeon/storyboard:generateScenarioStoryboard', err);
  }
}
