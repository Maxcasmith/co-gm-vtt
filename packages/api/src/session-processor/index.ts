import path from 'path';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import {
  readChatLog, listEntitySlugs, readEntity, writeEntity, archiveChatLog,
  getCharacter, getWorldMeta, CAMPAIGNS_DIR, readManifest, writeManifest,
  readQuests, writeQuests, readCampaignFile,
} from '../storage.ts';
import { getConfig } from '../storage.ts';
import { getStoryProvider, type ChatMessage } from '../providers/index.ts';
import { buildTriagePrompt, buildResolvePrompt, buildDMSystemPrompt, buildDmBriefPrompt, buildSessionQuestsPrompt, type EntityType } from './prompts.ts';
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

  // World bible — generated campaigns use world.md/factions.md; modules use dm-brief.md
  for (const filename of ['world.md', 'factions.md', 'dm-brief.md']) {
    const content = await readWorldFile(campaignSlug, filename);
    const cap = filename === 'dm-brief.md' ? 4000 : 1000;
    if (content) lines.push(`### ${filename}\n${content.slice(0, cap)}`);
  }

  // Characters — always load (the active party)
  const charSlugs = await listEntitySlugs(campaignSlug, 'character');
  for (const slug of charSlugs) {
    const content = await readEntity(campaignSlug, 'character', slug);
    if (content) lines.push(`### character/${slug}\n${content.slice(0, 500)}`);
  }

  // Quests — pending shown as story beats to trigger, active shown as ongoing goals
  const quests = await readQuests(campaignSlug);
  const pendingQuests = quests.filter(q => q.status === 'undiscovered').slice(0, 3);
  const activeQuests = quests.filter(q => q.status === 'open');
  if (pendingQuests.length) {
    const section = pendingQuests.map(q => `- ${q.id}: ${q.name} — ${q.description}`).join('\n');
    lines.push(`### Undiscovered quests (steer the player toward these — do not wait for them to ask)\n${section}`);
  }
  if (activeQuests.length) {
    const section = activeQuests.map(q => {
      const log = q.log.length ? `\n  - ${q.log.map(e => `${e.date}: ${e.text}`).join('\n  - ')}` : '';
      return `- ${q.id}: ${q.name} — ${q.description}${log}`;
    }).join('\n');
    lines.push(`### Open quests (player is tracking these — push toward resolution)\n${section}`);
  }

  const manifest = await readManifest(campaignSlug);
  if (!manifest) return lines.join('\n\n') || '(no entity notes yet)';

  const totalSecs = manifest.worldTimeSecs ?? 43200;
  const day = Math.floor(totalSecs / 86400) + 1;
  const h = Math.floor((totalSecs % 86400) / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  lines.push(`### World Time\nDay ${day}, ${h12}:${String(m).padStart(2, '0')} ${period}`);

  if (!manifest.currentLocation) {
    // Cold start — no scene established yet. Build a compact world index so the DM
    // knows the geography and can place the players correctly from turn one.
    const locationSlugs = await listEntitySlugs(campaignSlug, 'location');
    const npcSlugs = await listEntitySlugs(campaignSlug, 'npc');
    const factionSlugs = await listEntitySlugs(campaignSlug, 'faction');
    const toName = (slug: string) => slug.split('-').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ');
    if (locationSlugs.length) lines.push(`### World Locations\n${locationSlugs.map(toName).join('\n')}`);
    if (npcSlugs.length) lines.push(`### Key NPCs\n${npcSlugs.map(toName).join('\n')}`);
    if (factionSlugs.length) lines.push(`### Factions\n${factionSlugs.map(toName).join('\n')}`);
    return lines.join('\n\n') || '(no entity notes yet)';
  }

  // Current location — full content (scene text + DM notes)
  const locContent = await readEntity(campaignSlug, 'location', manifest.currentLocation);
  if (locContent) lines.push(`### location/${manifest.currentLocation} [CURRENT]\n${locContent}`);

  // NPCs and factions in current scene
  for (const slug of manifest.npcs) {
    const content = await readEntity(campaignSlug, 'npc', slug);
    if (content) lines.push(`### npc/${slug}\n${content.slice(0, 800)}`);
  }
  for (const slug of manifest.factions) {
    const content = await readEntity(campaignSlug, 'faction', slug);
    if (content) lines.push(`### faction/${slug}\n${content.slice(0, 600)}`);
  }

  // Adjacent zones — names only so DM can narrate transitions
  if (manifest.connectedZones.length) {
    lines.push(`### Connected zones\n${manifest.connectedZones.join(', ')}`);
  }

  return lines.join('\n\n') || '(no entity notes yet)';
}

// ── DM brief generation ───────────────────────────────────────────────────────

export interface DmBriefResult {
  startingLocationSlug: string;
  dmBrief: string;
  initialQuests?: Array<{ id: string; name: string; description: string }>;
  acts?: Array<{ act: number; conditions: string[] }>;
}

export async function generateDmBrief(
  moduleName: string,
  locationSlugs: string[],
  npcSlugs: string[],
  factionSlugs: string[],
): Promise<DmBriefResult> {
  const config = await getConfig();
  const provider = getStoryProvider(config);
  const prompt = buildDmBriefPrompt(moduleName, locationSlugs, npcSlugs, factionSlugs);
  const raw = await provider.complete(prompt);
  console.log('[dm-brief] raw response:\n', raw);
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
  const parsed = JSON.parse(cleaned) as DmBriefResult;
  // Guard: ensure the slug is actually in the provided list
  if (!locationSlugs.includes(parsed.startingLocationSlug)) {
    parsed.startingLocationSlug = locationSlugs[0] ?? '';
  }
  return parsed;
}

// ── Session quest generation ──────────────────────────────────────────────────

const UNDISCOVERED_THRESHOLD = 2;

export async function ensureSessionQuests(campaignSlug: string): Promise<void> {
  const quests = await readQuests(campaignSlug);
  const undiscovered = quests.filter(q => q.status === 'undiscovered');
  if (undiscovered.length >= UNDISCOVERED_THRESHOLD) return;

  try {
    const [manifest, actsRaw, meta] = await Promise.all([
      readManifest(campaignSlug),
      readCampaignFile(campaignSlug, 'acts.json'),
      getWorldMeta(campaignSlug),
    ]);

    const acts = actsRaw ? JSON.parse(actsRaw) as Array<{ act: number; conditions: string[] }> : [];
    const currentAct = manifest?.act ?? 1;
    const actConditions = acts.find(a => a.act === currentAct)?.conditions ?? [];

    const existingIds = quests.map(q => q.id);
    const openNames = quests.filter(q => q.status === 'open').map(q => q.name);
    const resolvedNames = quests.filter(q => q.status === 'resolved').map(q => q.name);

    const config = await getConfig();
    const provider = getStoryProvider(config);
    const prompt = buildSessionQuestsPrompt({
      campaignName: meta?.name ?? campaignSlug,
      currentAct,
      actConditions,
      existingIds,
      openQuestNames: openNames,
      resolvedQuestNames: resolvedNames,
      currentLocation: manifest?.currentLocation ?? null,
      needed: UNDISCOVERED_THRESHOLD - undiscovered.length,
    });

    const raw = await provider.complete(prompt);
    console.log('[session-quests] raw response:\n', raw);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
    const generated = JSON.parse(cleaned) as Array<{ id: string; name: string; description: string }>;

    const today = new Date().toISOString().slice(0, 10);
    const newQuests = generated
      .filter(q => q.id && q.name && !existingIds.includes(q.id))
      .map(q => ({ id: q.id, name: q.name, description: q.description, status: 'undiscovered' as const, log: [], addedAt: today }));

    if (newQuests.length) {
      await writeQuests(campaignSlug, [...quests, ...newQuests]);
      console.log(`[session-quests] added ${newQuests.length} undiscovered quest(s): ${newQuests.map(q => q.id).join(', ')}`);
    }
  } catch (err) {
    console.error('[session-quests] generation failed:', err);
  }
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

  const worldType = (meta?.type === 'module' ? 'campaign' : meta?.type) ?? 'campaign';
  const system = buildDMSystemPrompt(
    meta?.name ?? 'Unknown World',
    worldType,
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

  // Act advancement check
  try {
    const [manifest, actsRaw] = await Promise.all([
      readManifest(campaignSlug),
      readCampaignFile(campaignSlug, 'acts.json'),
    ]);
    if (manifest && actsRaw) {
      const acts = JSON.parse(actsRaw) as Array<{ act: number; conditions: string[] }>;
      const currentActDef = acts.find(a => a.act === manifest.act);
      if (currentActDef?.conditions.length) {
        const conditionList = currentActDef.conditions.map((c, i) => `${i + 1}. ${c}`).join('\n');
        const checkPrompt = `You are tracking story progression for a TTRPG campaign.\n\nCurrent act: ${manifest.act}\nConditions to advance to act ${manifest.act + 1}:\n${conditionList}\n\nSession log:\n${chatLogText}\n\nBased on this session log, has at least one of the act ${manifest.act} completion conditions been clearly met? Be strict — partial progress does not count. Return ONLY valid JSON: {"advanceAct": true}  or {"advanceAct": false}`;
        const raw = await provider.complete(checkPrompt);
        const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '');
        const result = JSON.parse(cleaned) as { advanceAct: boolean };
        if (result.advanceAct) {
          manifest.act = manifest.act + 1;
          await writeManifest(campaignSlug, manifest);
          console.log(`[act] advanced to act ${manifest.act}`);
        }
      }
    }
  } catch (err) {
    console.error('[act] advancement check failed:', err);
  }

  return { updated, created, cascaded };
}
