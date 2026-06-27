import { getConfig } from '../storage.ts';
import { getTierApiKey, buildAdapter } from '../providers/index.ts';
import { buildExtractionPrompt } from './prompts.ts';
import { saveCompendiumEntity, saveCompendiumRaw, saveCompendiumMeta, countCompendiumEntities } from './storage.ts';

interface ExtractedEntity {
  type: string;
  slug: string;
  content: string;
}

// Split on top-level ## headings; each chunk keeps its heading as context.
// Chunks under 200 chars are skipped (chapter title pages, blank sections).
export function chunkByHeading(markdown: string): string[] {
  const parts = markdown.split(/(?=\n## )/);
  return parts.map(p => p.trim()).filter(p => p.length >= 200);
}

async function extractEntities(
  chunk: string,
  apiKey: string,
  model: string,
  provider: string,
): Promise<ExtractedEntity[]> {
  try {
    const tier = { provider: provider as 'claude' | 'openai' | 'deepseek', model };
    const adapter = buildAdapter(tier, apiKey);
    const raw = await adapter.complete(buildExtractionPrompt(chunk));

    // Strip any accidental markdown fences the model may have added
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (e): e is ExtractedEntity =>
        typeof e === 'object' && e !== null &&
        typeof (e as Record<string, unknown>).type === 'string' &&
        typeof (e as Record<string, unknown>).slug === 'string' &&
        typeof (e as Record<string, unknown>).content === 'string',
    );
  } catch (err) {
    console.warn('[compendium] extraction parse failed:', (err as Error).message);
    return [];
  }
}

export async function runPipeline(
  slug: string,
  name: string,
  source: string,
  markdown: string,
  tierKey: 'light' | 'thinking',
  onProgress: (msg: string) => void,
): Promise<void> {
  const config = await getConfig();
  const tier = config.tiers[tierKey];
  const apiKey = getTierApiKey(config.apiKeys, tier.provider);
  if (!apiKey) throw new Error(`No API key configured for ${tier.provider}`);

  await saveCompendiumRaw(slug, markdown);
  onProgress('Splitting adventure into sections…');

  const chunks = chunkByHeading(markdown);
  onProgress(`Found ${chunks.length} sections to process`);

  // Track which slugs have already been appended this run — each recurring entity appends at most once.
  const appendedOnce = new Set<string>();

  for (let i = 0; i < chunks.length; i++) {
    const heading = chunks[i]!.split('\n')[0]?.replace(/^#+\s*/, '') ?? `Section ${i + 1}`;
    onProgress(`Extracting: ${heading} (${i + 1}/${chunks.length})`);

    const entities = await extractEntities(chunks[i]!, apiKey, tier.model, tier.provider);
    for (const entity of entities) {
      await saveCompendiumEntity(slug, entity.type, entity.slug, entity.content, appendedOnce);
    }

    if (entities.length > 0) {
      onProgress(`  → ${entities.length} ${entities.length === 1 ? 'entity' : 'entities'} extracted`);
    }
  }

  const entityCount = await countCompendiumEntities(slug);
  await saveCompendiumMeta(slug, {
    slug,
    name,
    source,
    createdAt: new Date().toISOString(),
    entityCount,
  });

  onProgress(
    `Done — ${entityCount.npc} NPCs, ${entityCount.creature} creatures, ` +
    `${entityCount.faction} factions, ${entityCount.location} locations`,
  );
}
