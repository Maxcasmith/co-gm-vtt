import path from 'path';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import {
  readChatLog, listEntitySlugs, readEntity, writeEntity, archiveChatLog,
  getCharacter, getWorldMeta, CAMPAIGNS_DIR,
} from '../storage.ts';
import { getConfig } from '../storage.ts';
import { getStoryProvider, type ChatMessage } from '../providers/index.ts';
import { buildTriagePrompt, buildResolvePrompt, buildDMSystemPrompt, type EntityType } from './prompts.ts';
import type { ChatPayload } from 'shared';

const ENTITY_TYPES: EntityType[] = ['npc', 'faction', 'location', 'character'];

// ── YAML parsing ─────────────────────────────────────────────────────────────
// ponytail: hand-rolled parser for the simple list-of-objects shape the AI returns

interface TriageEntity { slug: string; type: EntityType; reason: string }

function parseTriageYaml(raw: string): { touched: TriageEntity[]; new: TriageEntity[] } {
  const result: { touched: TriageEntity[]; new: TriageEntity[] } = { touched: [], new: [] };
  let current: TriageEntity[] | null = null;
  let item: Partial<TriageEntity> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'touched:') { current = result.touched; continue; }
    if (trimmed === 'new:') { current = result.new; continue; }
    if (!current) continue;
    if (trimmed.startsWith('- slug:')) {
      if (item.slug) current.push(item as TriageEntity);
      item = { slug: trimmed.replace('- slug:', '').trim() };
    } else if (trimmed.startsWith('type:')) {
      item.type = trimmed.replace('type:', '').trim() as EntityType;
    } else if (trimmed.startsWith('reason:')) {
      item.reason = trimmed.replace('reason:', '').trim().replace(/^"|"$/g, '');
    }
  }
  if (item.slug && current) current.push(item as TriageEntity);
  return result;
}

function parseCascadeYaml(raw: string): TriageEntity[] {
  const items: TriageEntity[] = [];
  let item: Partial<TriageEntity> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'cascade: []' || trimmed === 'cascade:') continue;
    if (trimmed.startsWith('- slug:')) {
      if (item.slug) items.push(item as TriageEntity);
      item = { slug: trimmed.replace('- slug:', '').trim() };
    } else if (trimmed.startsWith('type:')) {
      item.type = trimmed.replace('type:', '').trim() as EntityType;
    } else if (trimmed.startsWith('reason:')) {
      item.reason = trimmed.replace('reason:', '').trim().replace(/^"|"$/g, '');
    }
  }
  if (item.slug) items.push(item as TriageEntity);
  return items;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function getCharacterNames(campaignSlug: string): Promise<string[]> {
  const partyPath = path.join(CAMPAIGNS_DIR, campaignSlug, 'party');
  if (!existsSync(partyPath)) return [];
  const entries = await readdir(partyPath, { withFileTypes: true });
  const names = await Promise.all(
    entries.filter(e => e.isDirectory()).map(async e => {
      const char = await getCharacter(campaignSlug, e.name);
      return char?.name ?? null;
    }),
  );
  return names.filter((n): n is string => n !== null);
}

function excerpts(log: ChatPayload[], entitySlug: string): string {
  const term = entitySlug.replace(/-/g, ' ').toLowerCase();
  const relevant = log.filter(m =>
    m.text.toLowerCase().includes(term) ||
    m.senderName.toLowerCase().includes(term),
  );
  return relevant
    .map(m => `[${m.senderName}]: ${m.text}`)
    .join('\n') || '';
}

async function resolveEntity(
  campaignSlug: string,
  type: EntityType,
  slug: string,
  log: ChatPayload[],
  characters: string[],
  today: string,
  provider: { complete: (p: string) => Promise<string> },
): Promise<{ cascade: TriageEntity[] }> {
  const current = await readEntity(campaignSlug, type, slug);
  const chatExcerpts = excerpts(log, slug);
  const prompt = buildResolvePrompt(type, slug, current, chatExcerpts, characters, today);
  const response = await provider.complete(prompt);

  const [fileContent, cascadeSection] = response.split('===CASCADE===');
  if (fileContent?.trim()) {
    const clean = fileContent.trim()
      .replace(/^```(?:yaml|markdown|md)?\n?/i, '')
      .replace(/\n?```\s*$/, '');
    await writeEntity(campaignSlug, type, slug, clean);
  }
  const cascade = cascadeSection ? parseCascadeYaml(cascadeSection) : [];
  return { cascade };
}

async function readWorldFile(campaignSlug: string, filename: string): Promise<string | null> {
  try {
    return await readFile(path.join(CAMPAIGNS_DIR, campaignSlug, filename), 'utf-8');
  } catch {
    return null;
  }
}

async function buildEntitySummaries(campaignSlug: string): Promise<string> {
  const lines: string[] = [];

  // World generation files — the canonical source of truth for this setting
  const worldFiles = ['world.md', 'locations.md', 'npcs.md', 'factions.md'];
  for (const filename of worldFiles) {
    const content = await readWorldFile(campaignSlug, filename);
    if (content) lines.push(`### ${filename}\n${content}`);
  }

  // Per-entity session notes accumulated during play
  for (const type of ENTITY_TYPES) {
    const slugs = await listEntitySlugs(campaignSlug, type);
    for (const slug of slugs) {
      const content = await readEntity(campaignSlug, type, slug);
      if (content) lines.push(`### ${type}/${slug}\n${content.slice(0, 600)}`);
    }
  }

  return lines.join('\n\n') || '(no entity notes yet)';
}

// ── DM chat response ──────────────────────────────────────────────────────────

const DM_SENDER = 'Virtual DM';
const HISTORY_LIMIT = 20;

export async function getDMResponse(campaignSlug: string): Promise<string> {
  const [config, meta, log] = await Promise.all([
    getConfig(),
    getWorldMeta(campaignSlug),
    readChatLog(campaignSlug),
  ]);

  const entitySummaries = await buildEntitySummaries(campaignSlug);
  const characters = await getCharacterNames(campaignSlug);
  const characterSummaries = characters.map(n => `- ${n}`).join('\n');

  // Build alternating user/assistant turns from the recent chat log
  // Player messages → user role; DM messages → assistant role; System (rolls) → user role labelled as roll
  const recent = log.slice(-HISTORY_LIMIT);
  const messages: ChatMessage[] = [];
  for (const msg of recent) {
    const isRoll = msg.senderName === 'System';
    const role = msg.senderName === DM_SENDER ? 'assistant' : 'user';
    const content = isRoll
      ? `[Roll Result]: ${msg.text}`
      : role === 'user' ? `[${msg.senderName}]: ${msg.text}` : msg.text;
    // Merge consecutive same-role messages (can happen if multiple players speak before DM responds)
    const last = messages[messages.length - 1];
    if (last?.role === role) {
      last.content += `\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }

  // Ensure we end on a user message (the AI can't respond to itself)
  while (messages.length > 0 && messages[messages.length - 1]?.role === 'assistant') {
    messages.pop();
  }
  if (messages.length === 0) return '';

  const system = buildDMSystemPrompt(
    meta?.name ?? 'Unknown World',
    meta?.type ?? 'campaign',
    entitySummaries,
    characterSummaries,
  );

  const provider = getStoryProvider(config);
  return provider.chat(system, messages);
}

// ── main export ───────────────────────────────────────────────────────────────

export interface ProcessResult {
  skipped?: boolean;
  updated: string[];
  created: string[];
  cascaded: string[];
}

export async function processSession(campaignSlug: string): Promise<ProcessResult> {
  const log = await readChatLog(campaignSlug);
  if (log.length === 0) return { skipped: true, updated: [], created: [], cascaded: [] };

  const config = await getConfig();
  const provider = getStoryProvider(config);
  const today = new Date().toISOString().slice(0, 10);
  const characters = await getCharacterNames(campaignSlug);

  // Build existing entity map for triage
  const existingEntities: Record<EntityType, string[]> = { npc: [], faction: [], location: [], character: [] };
  for (const type of ENTITY_TYPES) {
    existingEntities[type] = await listEntitySlugs(campaignSlug, type);
  }

  // Pass 1 — triage
  const chatLogText = log.map(m => `[${m.senderName}]: ${m.text}`).join('\n');
  const triageRaw = await provider.complete(buildTriagePrompt(chatLogText, existingEntities));
  const triage = parseTriageYaml(triageRaw);

  const existingSlugs = new Set(
    ENTITY_TYPES.flatMap(t => existingEntities[t].map(s => `${t}:${s}`)),
  );
  const updated: string[] = [];
  const created: string[] = [];
  const cascadeQueue: TriageEntity[] = [];
  const processed = new Set<string>();

  // Pass 2 — resolve touched + new entities
  const toResolve = [...triage.touched, ...triage.new];
  for (const entity of toResolve) {
    if (!ENTITY_TYPES.includes(entity.type)) continue;
    const key = `${entity.type}:${entity.slug}`;
    if (processed.has(key)) continue;
    processed.add(key);

    const { cascade } = await resolveEntity(campaignSlug, entity.type, entity.slug, log, characters, today, provider);
    (existingSlugs.has(key) ? updated : created).push(`${entity.type}/${entity.slug}`);
    cascadeQueue.push(...cascade);
  }

  // Pass 3 — cascade (depth 1)
  const cascaded: string[] = [];
  for (const entity of cascadeQueue) {
    if (!ENTITY_TYPES.includes(entity.type)) continue;
    const key = `${entity.type}:${entity.slug}`;
    if (processed.has(key)) continue;
    processed.add(key);

    await resolveEntity(campaignSlug, entity.type, entity.slug, log, characters, today, provider);
    cascaded.push(`${entity.type}/${entity.slug}`);
  }

  await archiveChatLog(campaignSlug);
  return { updated, created, cascaded };
}
