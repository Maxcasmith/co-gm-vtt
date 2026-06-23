import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AppConfig, Campaign, WorldMeta, Character } from 'shared';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dir, '../storage');
const CONFIG_PATH = path.join(STORAGE_DIR, 'config.json');

export const CAMPAIGNS_DIR = path.join(STORAGE_DIR, 'campaigns');

const DEFAULT_CONFIG: AppConfig = {
  story: { provider: 'claude', model: 'claude-sonnet-4-6', apiKey: '' },
  image: { model: 'dall-e-3', apiKey: '' },
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

export async function writeCharacterImage(slug: string, charId: string, filename: string, data: Buffer): Promise<void> {
  const dir = partyDir(slug, charId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), data);
}
