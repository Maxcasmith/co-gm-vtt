import { jsonrepair } from 'jsonrepair';
import { getConfig } from '../storage.ts';
import { getFeatureProvider, retry, type StoryProviderAdapter } from '../providers/index.ts';
import { buildExtractionPrompt } from './prompts.ts';
import {
  saveCompendiumEntity, saveCompendiumRaw, saveCompendiumMeta,
  loadCompendiumMeta, countCompendiumEntities, reconcileLocationInhabitants,
} from './storage.ts';
import { logError } from '../logger.ts';

export class ExtractionPausedError extends Error {}

// Cooperative pause signal: set by the /pause route, checked between sections
// in the runPipeline loop below (mid-section generation can't be interrupted cleanly).
const pauseRequests = new Set<string>();

export function requestPause(slug: string): void {
  pauseRequests.add(slug);
}

interface ExtractedEntity {
  type: string;
  slug: string;
  content: string;
}

// Split on top-level # or ## headings; each chunk keeps its heading as context.
// # matters too — appendices (e.g. "# Appendix B: Death House") use it instead of ##,
// and without splitting there their intro paragraph silently glues onto whatever
// chunk preceded them.
// Chunks under 200 chars are skipped (chapter title pages, blank sections).
export function chunkByHeading(markdown: string): string[] {
  const parts = markdown.split(/(?=\n#{1,2} )/);
  return parts.map(p => p.trim()).filter(p => p.length >= 200);
}

async function extractEntities(chunk: string, adapter: StoryProviderAdapter, onToken: (token: string) => void): Promise<ExtractedEntity[]> {
  const raw = await adapter.stream(buildExtractionPrompt(chunk), onToken);

  // Strip any accidental markdown fences the model may have added
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  // Markdown content (Vistani lore, dice notation, etc.) often contains a bare backslash
  // that isn't a valid JSON escape (e.g. "\d" is not "\\d") — double any backslash not
  // already starting a recognized escape sequence before jsonrepair/JSON.parse see it.
  const escaped = cleaned.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  // jsonrepair recovers from the malformed JSON weaker/faster models occasionally produce
  // (trailing commas, unclosed brackets, unescaped newlines) — same tool already used
  // for LLM JSON elsewhere in this app (routes/campaigns.ts).
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonrepair(escaped)) as unknown;
  } catch (err) {
    // Log the actual text that failed — a position number alone isn't enough to diagnose
    // which escape/format variant broke this time.
    logError('compendium/parser:extractEntities:unparseable', new Error(`${(err as Error).message}\n---RAW---\n${escaped}`));
    throw err;
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (e): e is ExtractedEntity =>
      typeof e === 'object' && e !== null &&
      typeof (e as Record<string, unknown>).type === 'string' &&
      typeof (e as Record<string, unknown>).slug === 'string' &&
      typeof (e as Record<string, unknown>).content === 'string',
  );
}

export async function runPipeline(
  slug: string,
  name: string,
  source: string,
  markdown: string,
  onProgress: (msg: string) => void,
  onToken: (token: string) => void = () => {},
  startChunk = 0,
): Promise<void> {
  const config = await getConfig();
  const adapter = getFeatureProvider(config, 'compendium');

  const existingMeta = await loadCompendiumMeta(slug);
  const createdAt = existingMeta?.createdAt ?? new Date().toISOString();

  await saveCompendiumRaw(slug, markdown);
  onProgress('Splitting adventure into sections…');

  const chunks = chunkByHeading(markdown);
  onProgress(`Found ${chunks.length} sections to process`);

  // Track which slugs have already been appended this run — each recurring entity appends at most once.
  const appendedOnce = new Set<string>();

  for (let i = startChunk; i < chunks.length; i++) {
    if (pauseRequests.has(slug)) {
      pauseRequests.delete(slug);
      const entityCount = await countCompendiumEntities(slug);
      await saveCompendiumMeta(slug, {
        slug, name, source, createdAt, entityCount,
        status: 'draft', resumeFromChunk: i,
      });
      onProgress(`Paused by user at section ${i + 1}/${chunks.length}`);
      throw new ExtractionPausedError('Paused by user');
    }

    const heading = chunks[i]!.split('\n')[0]?.replace(/^#+\s*/, '') ?? `Section ${i + 1}`;
    onProgress(`Extracting: ${heading} (${i + 1}/${chunks.length})`);

    let entities;
    try {
      // Retries here re-generate the whole response, not just re-parse it — a fresh
      // attempt is often just valid JSON, since these failures are usually one-off
      // formatting slips (bad escape, truncation) rather than a persistent problem.
      entities = await retry(() => extractEntities(chunks[i]!, adapter, onToken), `compendium/parser:extractEntities:${heading}`);
    } catch (err) {
      const entityCount = await countCompendiumEntities(slug);
      await saveCompendiumMeta(slug, {
        slug, name, source, createdAt, entityCount,
        status: 'draft', resumeFromChunk: i,
      });
      logError('compendium/parser:runPipeline:paused', err);
      onProgress(`Paused at section ${i + 1}/${chunks.length} — ${(err as Error).message}`);
      throw new ExtractionPausedError((err as Error).message);
    }

    for (const entity of entities) {
      await saveCompendiumEntity(slug, entity.type, entity.slug, entity.content, appendedOnce);
    }

    if (entities.length > 0) {
      onProgress(`  → ${entities.length} ${entities.length === 1 ? 'entity' : 'entities'} extracted`);
    }
  }

  onProgress('Cross-linking entities…');
  await reconcileLocationInhabitants(slug);

  const entityCount = await countCompendiumEntities(slug);
  await saveCompendiumMeta(slug, {
    slug, name, source, createdAt, entityCount,
    status: 'complete', resumeFromChunk: chunks.length,
  });

  onProgress(
    `Done — ${entityCount.npc} NPCs, ${entityCount.creature} creatures, ` +
    `${entityCount.faction} factions, ${entityCount.location} locations`,
  );
}
