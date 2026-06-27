import { readFile, writeFile, mkdir, readdir, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CompendiumMeta, WorldMeta } from 'shared';
import { CAMPAIGNS_DIR, emptyManifest } from '../storage.ts';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dir, '../../storage');

export const COMPENDIUM_DIR = path.join(STORAGE_DIR, 'compendium', 'adventures');

export async function saveCompendiumMeta(slug: string, meta: CompendiumMeta): Promise<void> {
  const dir = path.join(COMPENDIUM_DIR, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
}

export async function loadCompendiumMeta(slug: string): Promise<CompendiumMeta | null> {
  try {
    const raw = await readFile(path.join(COMPENDIUM_DIR, slug, 'meta.json'), 'utf-8');
    return JSON.parse(raw) as CompendiumMeta;
  } catch {
    return null;
  }
}

export async function listCompendiumAdventures(): Promise<CompendiumMeta[]> {
  if (!existsSync(COMPENDIUM_DIR)) return [];
  const entries = await readdir(COMPENDIUM_DIR, { withFileTypes: true });
  const results = await Promise.all(
    entries.filter(e => e.isDirectory()).map(e => loadCompendiumMeta(e.name)),
  );
  return results.filter((r): r is CompendiumMeta => r !== null);
}

export async function saveCompendiumRaw(slug: string, markdown: string): Promise<void> {
  const dir = path.join(COMPENDIUM_DIR, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'raw.md'), markdown, 'utf-8');
}

// If the entity file already exists, strip the frontmatter from the new content and append
// the prose body — but only once per pipeline run (appendedOnce guards against repeat chapters).
// Fuzzy dedup routes typos / plurals / partial names to the canonical existing file.
export async function saveCompendiumEntity(
  slug: string,
  type: string,
  entitySlug: string,
  content: string,
  appendedOnce: Set<string>,
): Promise<void> {
  const dir = path.join(COMPENDIUM_DIR, slug, 'entities', type);
  await mkdir(dir, { recursive: true });

  const resolvedSlug = existsSync(path.join(dir, `${entitySlug}.md`))
    ? entitySlug
    : (await findSimilarSlug(entitySlug, dir)) ?? entitySlug;

  const filePath = path.join(dir, `${resolvedSlug}.md`);
  const key = `${type}/${resolvedSlug}`;

  if (existsSync(filePath)) {
    if (!appendedOnce.has(key)) {
      const prose = stripFrontmatter(content);
      if (prose.trim()) {
        const existing = await readFile(filePath, 'utf-8');
        await writeFile(filePath, `${existing.trimEnd()}\n\n${prose.trim()}`, 'utf-8');
        appendedOnce.add(key);
      }
    }
  } else {
    await writeFile(filePath, content, 'utf-8');
  }
}

// ponytail: compact inline Levenshtein — no dep, ~20 lines, fast enough for O(entities²) per chunk
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

function normalizePlural(s: string): string {
  return s.replace(/-ves$/, '-f').replace(/-ies$/, '-y').replace(/s$/, '');
}

async function findSimilarSlug(newSlug: string, dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const existing = (await readdir(dir)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));

  // 1. Prefix: "strahd" ↔ "strahd-von-zarovich"
  for (const s of existing) {
    if (s.startsWith(newSlug + '-') || newSlug.startsWith(s + '-')) return s;
  }
  // 2. Typo: edit distance ≤ 2 and < 20% of the longer slug
  for (const s of existing) {
    const dist = levenshtein(newSlug, s);
    if (dist > 0 && dist <= 2 && dist / Math.max(newSlug.length, s.length) < 0.2) return s;
  }
  // 3. Plural/singular: dire-wolves → dire-wolf (guard: > 3 chars to avoid "bat"/"bats" false neg)
  const norm = normalizePlural(newSlug);
  if (norm.length > 3) {
    for (const s of existing) {
      if (normalizePlural(s) === norm) return s;
    }
  }
  return null;
}

export async function deleteCompendiumAdventure(slug: string): Promise<void> {
  const dir = path.join(COMPENDIUM_DIR, slug);
  if (existsSync(dir)) {
    const { rm } = await import('fs/promises');
    await rm(dir, { recursive: true, force: true });
  }
}

export async function countCompendiumEntities(
  slug: string,
): Promise<CompendiumMeta['entityCount']> {
  const types = ['npc', 'creature', 'faction', 'location'] as const;
  const counts = await Promise.all(
    types.map(async type => {
      const dir = path.join(COMPENDIUM_DIR, slug, 'entities', type);
      if (!existsSync(dir)) return 0;
      const entries = await readdir(dir);
      return entries.filter(f => f.endsWith('.md')).length;
    }),
  );
  return { npc: counts[0]!, creature: counts[1]!, faction: counts[2]!, location: counts[3]! };
}

export async function copyCompendiumToCampaign(
  adventureSlug: string,
  campaignSlug: string,
  campaignName: string,
): Promise<void> {
  const srcEntities = path.join(COMPENDIUM_DIR, adventureSlug, 'entities');
  const dstDir = path.join(CAMPAIGNS_DIR, campaignSlug);
  await mkdir(dstDir, { recursive: true });

  if (existsSync(srcEntities)) {
    await cp(srcEntities, path.join(dstDir, 'entities'), { recursive: true });
  }

  const meta = await loadCompendiumMeta(adventureSlug);
  const worldMeta: WorldMeta = {
    id: campaignSlug,
    name: campaignName,
    campaignDir: campaignSlug,
    type: 'module',
    adventureSlug,
    ...(meta && { concept: { name: meta.name, description: meta.source } }),
  };
  await writeFile(path.join(dstDir, 'world.json'), JSON.stringify(worldMeta, null, 2), 'utf-8');
  await writeFile(path.join(dstDir, 'manifest.json'), JSON.stringify(emptyManifest(), null, 2), 'utf-8');
}

function stripFrontmatter(content: string): string {
  // Remove leading ---...--- block if present
  const match = content.match(/^---[\s\S]*?---\n?([\s\S]*)$/);
  return match ? match[1]! : content;
}
