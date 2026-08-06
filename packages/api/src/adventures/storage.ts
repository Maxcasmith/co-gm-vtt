import { readFile, writeFile, mkdir, readdir, rm, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import type { SavedAdventureMeta, WorldMeta, Dungeon, Quest } from 'shared';
import { CAMPAIGNS_DIR, emptyManifest } from '../storage.ts';
import { logError } from '../logger.ts';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dir, '../../storage');

export const SAVED_ADVENTURES_DIR = path.join(STORAGE_DIR, 'saved-adventures');

// Files that hold live-play state, never part of a reusable template.
const PLAY_STATE_FILES = ['chat.json', 'encounter.json', 'world-state.json', 'nemeses.json', 'party-allies.json'];
const PLAY_STATE_DIRS = ['party', 'sessions'];

async function countEntities(entitiesDir: string): Promise<SavedAdventureMeta['entityCount']> {
  const types = ['npc', 'creature', 'faction', 'location'] as const;
  const counts = await Promise.all(
    types.map(async type => {
      const dir = path.join(entitiesDir, type);
      if (!existsSync(dir)) return 0;
      const entries = await readdir(dir);
      return entries.filter(f => f.endsWith('.md')).length;
    }),
  );
  return { npc: counts[0]!, creature: counts[1]!, faction: counts[2]!, location: counts[3]! };
}

export async function saveCampaignAsAdventure(campaignSlug: string, adventureSlug: string, name: string): Promise<void> {
  const srcDir = path.join(CAMPAIGNS_DIR, campaignSlug);
  const dstDir = path.join(SAVED_ADVENTURES_DIR, adventureSlug);
  await mkdir(SAVED_ADVENTURES_DIR, { recursive: true });
  await cp(srcDir, dstDir, { recursive: true });

  await Promise.all([
    ...PLAY_STATE_FILES.map(f => rm(path.join(dstDir, f), { force: true })),
    ...PLAY_STATE_DIRS.map(d => rm(path.join(dstDir, d), { recursive: true, force: true })),
  ]);

  // Quests/dungeon reset to a fresh, undiscovered starting state — a template is replayed from
  // scratch every time, never resumed mid-progress.
  const questsPath = path.join(dstDir, 'quests.json');
  try {
    const quests = JSON.parse(await readFile(questsPath, 'utf-8')) as Quest[];
    const reset = quests.map(q => ({ ...q, status: 'undiscovered' as const, log: [] }));
    await writeFile(questsPath, JSON.stringify(reset, null, 2), 'utf-8');
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:quests', err); }

  const dungeonPath = path.join(dstDir, 'dungeon.json');
  let hasDungeon = false;
  try {
    const dungeon = JSON.parse(await readFile(dungeonPath, 'utf-8')) as Dungeon;
    dungeon.entities = dungeon.entities.map(e => ({ ...e, discovered: false }));
    await writeFile(dungeonPath, JSON.stringify(dungeon, null, 2), 'utf-8');
    hasDungeon = true;
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:dungeon', err); }

  const manifestPath = path.join(dstDir, 'manifest.json');
  try {
    const original = JSON.parse(await readFile(manifestPath, 'utf-8')) as { currentLocation: string | null };
    const fresh = { ...emptyManifest(), currentLocation: original.currentLocation };
    await writeFile(manifestPath, JSON.stringify(fresh, null, 2), 'utf-8');
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:manifest', err); }

  const worldMeta = await (async () => {
    try { return JSON.parse(await readFile(path.join(dstDir, 'world.json'), 'utf-8')) as WorldMeta; }
    catch (err) { logError('adventures/storage:saveCampaignAsAdventure:worldMeta', err); return null; }
  })();

  const meta: SavedAdventureMeta = {
    slug: adventureSlug,
    name,
    sourceType: worldMeta?.type ?? 'campaign',
    savedAt: new Date().toISOString(),
    hasDungeon,
    entityCount: await countEntities(path.join(dstDir, 'entities')),
  };
  await writeFile(path.join(dstDir, 'adventure.json'), JSON.stringify(meta, null, 2), 'utf-8');
}

export async function loadSavedAdventureMeta(slug: string): Promise<SavedAdventureMeta | null> {
  try {
    const raw = await readFile(path.join(SAVED_ADVENTURES_DIR, slug, 'adventure.json'), 'utf-8');
    return JSON.parse(raw) as SavedAdventureMeta;
  } catch (err) {
    logError('adventures/storage:loadSavedAdventureMeta', err);
    return null;
  }
}

export async function listSavedAdventures(): Promise<SavedAdventureMeta[]> {
  if (!existsSync(SAVED_ADVENTURES_DIR)) return [];
  const entries = await readdir(SAVED_ADVENTURES_DIR, { withFileTypes: true });
  const results = await Promise.all(
    entries.filter(e => e.isDirectory()).map(e => loadSavedAdventureMeta(e.name)),
  );
  return results.filter((r): r is SavedAdventureMeta => r !== null);
}

export async function deleteSavedAdventure(slug: string): Promise<void> {
  const dir = path.join(SAVED_ADVENTURES_DIR, slug);
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
}

// Zero LLM calls — the template already carries its starting location, undiscovered quests, and
// reset dungeon, so spinning up a copy is a plain filesystem clone plus a fresh campaign identity.
export async function copyAdventureToCampaign(adventureSlug: string, campaignSlug: string, campaignName: string): Promise<void> {
  const srcDir = path.join(SAVED_ADVENTURES_DIR, adventureSlug);
  const dstDir = path.join(CAMPAIGNS_DIR, campaignSlug);
  await mkdir(CAMPAIGNS_DIR, { recursive: true });
  await cp(srcDir, dstDir, { recursive: true });
  await rm(path.join(dstDir, 'adventure.json'), { force: true });

  const worldMetaPath = path.join(dstDir, 'world.json');
  const original = JSON.parse(await readFile(worldMetaPath, 'utf-8')) as WorldMeta;
  const worldMeta: WorldMeta = { ...original, id: randomUUID(), name: campaignName, campaignDir: campaignSlug };
  await writeFile(worldMetaPath, JSON.stringify(worldMeta, null, 2), 'utf-8');
}
