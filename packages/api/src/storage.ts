import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppConfig, Campaign, WorldMeta, Character, ChatPayload, BattleMap, WorldState } from 'shared';
import { Encounter } from './domain/encounter.ts';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dir, '../storage');
const CONFIG_PATH = path.join(STORAGE_DIR, 'config.json');

export const CAMPAIGNS_DIR = path.join(STORAGE_DIR, 'campaigns');

const DEFAULT_CONFIG: AppConfig = {
  story:     { provider: 'claude', model: 'claude-sonnet-4-6', apiKey: '' },
  image:     { model: 'gpt-image-1', apiKey: '' },
  combat:    { model: 'gpt-4o-mini', apiKey: '' },
  narration: { model: 'none', voice: 'onyx', apiKey: '' },
};

export async function getConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as AppConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function writeCampaignFile(slug: string, filename: string, content: string): Promise<void> {
  const dir = path.join(CAMPAIGNS_DIR, slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), content, 'utf-8');
}

export async function getWorldMeta(slug: string): Promise<WorldMeta | null> {
  try {
    const raw = await readFile(path.join(CAMPAIGNS_DIR, slug, 'world.json'), 'utf-8');
    return JSON.parse(raw) as WorldMeta;
  } catch {
    return null;
  }
}

export async function writeWorldMeta(slug: string, meta: WorldMeta): Promise<void> {
  await writeCampaignFile(slug, 'world.json', JSON.stringify(meta, null, 2));
}

export async function listCampaigns(): Promise<Campaign[]> {
  if (!existsSync(CAMPAIGNS_DIR)) return [];
  const entries = await readdir(CAMPAIGNS_DIR, { withFileTypes: true });
  const results = await Promise.all(
    entries.filter(e => e.isDirectory()).map(async e => {
      const meta = await getWorldMeta(e.name);
      if (!meta) return null; // skip directories without world.json (e.g. stray upload dirs)
      return { id: e.name, name: meta.name };
    })
  );
  return results.filter((r): r is Campaign => r !== null);
}

export function campaignDir(slug: string): string {
  return path.join(CAMPAIGNS_DIR, slug);
}

export function partyDir(slug: string, charId: string): string {
  return path.join(CAMPAIGNS_DIR, slug, 'party', charId);
}

export async function writeCharacter(slug: string, charId: string, data: Character): Promise<void> {
  const dir = partyDir(slug, charId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'character.json'), JSON.stringify(data, null, 2), 'utf-8');
}

export async function getCharacter(slug: string, charId: string): Promise<Character | null> {
  try {
    const raw = await readFile(path.join(partyDir(slug, charId), 'character.json'), 'utf-8');
    return JSON.parse(raw) as Character;
  } catch {
    return null;
  }
}

export async function listCharacters(slug: string): Promise<Character[]> {
  const partyPath = path.join(CAMPAIGNS_DIR, slug, 'party');
  if (!existsSync(partyPath)) return [];
  const entries = await readdir(partyPath, { withFileTypes: true });
  const chars = await Promise.all(
    entries.filter(e => e.isDirectory()).map(e => getCharacter(slug, e.name)),
  );
  return chars.filter((c): c is Character => c !== null);
}

export async function findCharacterByPassword(slug: string, password: string): Promise<Character | null> {
  const partyPath = path.join(CAMPAIGNS_DIR, slug, 'party');
  if (!existsSync(partyPath)) return null;
  const entries = await readdir(partyPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const char = await getCharacter(slug, entry.name);
    if (char?.password === password) return char;
  }
  return null;
}

export async function readChatLog(slug: string): Promise<ChatPayload[]> {
  try {
    const raw = await readFile(path.join(CAMPAIGNS_DIR, slug, 'chat.json'), 'utf-8');
    return JSON.parse(raw) as ChatPayload[];
  } catch {
    return [];
  }
}

export async function appendChatLog(slug: string, message: ChatPayload): Promise<void> {
  const log = await readChatLog(slug);
  log.push(message);
  await writeCampaignFile(slug, 'chat.json', JSON.stringify(log, null, 2));
}

export async function writeCharacterImage(slug: string, charId: string, filename: string, data: Buffer): Promise<void> {
  const dir = partyDir(slug, charId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), data);
}

export async function listEntitySlugs(slug: string, type: string): Promise<string[]> {
  const dir = path.join(CAMPAIGNS_DIR, slug, 'entities', type);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name.replace(/\.md$/, ''));
}

export async function readEntity(slug: string, type: string, entitySlug: string): Promise<string | null> {
  try {
    return await readFile(path.join(CAMPAIGNS_DIR, slug, 'entities', type, `${entitySlug}.md`), 'utf-8');
  } catch {
    return null;
  }
}

export async function writeEntity(slug: string, type: string, entitySlug: string, content: string): Promise<void> {
  const dir = path.join(CAMPAIGNS_DIR, slug, 'entities', type);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${entitySlug}.md`), content, 'utf-8');
}

export async function saveMap(slug: string, mapId: string, buffer: Buffer): Promise<void> {
  const dir = path.join(CAMPAIGNS_DIR, slug, 'maps');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${mapId}.jpg`), buffer);
}

export async function appendMapIndex(slug: string, entry: BattleMap): Promise<void> {
  const indexPath = path.join(CAMPAIGNS_DIR, slug, 'maps', 'index.json');
  let index: BattleMap[] = [];
  try { index = JSON.parse(await readFile(indexPath, 'utf-8')) as BattleMap[]; } catch { /* first map */ }
  index.push(entry);
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

export async function listMaps(slug: string): Promise<BattleMap[]> {
  try {
    const raw = await readFile(path.join(CAMPAIGNS_DIR, slug, 'maps', 'index.json'), 'utf-8');
    return JSON.parse(raw) as BattleMap[];
  } catch {
    return [];
  }
}

export async function saveEncounter(slug: string, encounter: Encounter): Promise<void> {
  await writeCampaignFile(slug, 'encounter.json', JSON.stringify(encounter.toJSON(), null, 2));
}

export async function loadEncounter(slug: string): Promise<Encounter | null> {
  try {
    const raw = await readFile(path.join(CAMPAIGNS_DIR, slug, 'encounter.json'), 'utf-8');
    return Encounter.fromJSON(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function clearEncounter(slug: string): Promise<void> {
  const p = path.join(CAMPAIGNS_DIR, slug, 'encounter.json');
  try { if (existsSync(p)) await writeFile(p, JSON.stringify({ enemies: [] }), 'utf-8'); } catch { /* ignore */ }
}

export async function readWorldState(slug: string): Promise<WorldState | null> {
  try {
    const raw = await readFile(path.join(CAMPAIGNS_DIR, slug, 'world-state.json'), 'utf-8');
    return JSON.parse(raw) as WorldState;
  } catch { return null; }
}

export async function writeWorldState(slug: string, state: WorldState): Promise<void> {
  await writeCampaignFile(slug, 'world-state.json', JSON.stringify(state, null, 2));
}

export async function readCampaignFile(slug: string, filename: string): Promise<string | null> {
  try {
    return await readFile(path.join(CAMPAIGNS_DIR, slug, filename), 'utf-8');
  } catch { return null; }
}

export async function archiveChatLog(slug: string): Promise<void> {
  const chatPath = path.join(CAMPAIGNS_DIR, slug, 'chat.json');
  const sessionsDir = path.join(CAMPAIGNS_DIR, slug, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  try {
    const raw = await readFile(chatPath, 'utf-8');
    const date = new Date().toISOString().slice(0, 10);
    const existing = await readdir(sessionsDir);
    const count = existing.filter(f => f.startsWith(date)).length;
    const archiveName = `${date}-${String(count + 1).padStart(3, '0')}.json`;
    await writeFile(path.join(sessionsDir, archiveName), raw, 'utf-8');
  } catch { /* no chat log yet */ }
  await writeFile(chatPath, '[]', 'utf-8');
}
