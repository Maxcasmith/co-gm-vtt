import { readFile, writeFile, mkdir, readdir, rm, cp } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import type { SavedAdventureMeta, WorldMeta, Dungeon, Quest, ScenarioStoryboard } from 'shared';
import { CAMPAIGNS_DIR, emptyManifest } from '../storage.ts';
import { scenarioSlideUrl } from '../dungeon/storyboard.ts';
import { logError } from '../logger.ts';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dir, '../../storage');

export const SAVED_ADVENTURES_DIR = path.join(STORAGE_DIR, 'saved-adventures');

export function slugifyAdventureName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Collision-avoidance for a new saved-adventure directory, scoped to SAVED_ADVENTURES_DIR.
export function uniqueAdventureSlug(base: string): string {
  let slug = base;
  let n = 2;
  while (existsSync(path.join(SAVED_ADVENTURES_DIR, slug))) {
    slug = `${base}-${n}`;
    n++;
  }
  return slug;
}

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

  // Quests/dungeon reset to a fresh starting state — a template is replayed from scratch every
  // time, never resumed mid-progress. Any quest seeded by a dungeon's own goals (sourceDungeonId
  // set — see generateDungeonQuests/questChain) was never discovery-gated: it's written straight
  // to 'open' at dungeon-generation time and the dungeon's closed-world narration never fires a
  // QUEST_ADD to un-hide it, so resetting it to 'undiscovered' would hide it forever. Only
  // campaign-level narrative quests (no sourceDungeonId — discovered mid-session via QUEST_ADD)
  // reset to 'undiscovered'.
  const questsPath = path.join(dstDir, 'quests.json');
  try {
    const quests = JSON.parse(await readFile(questsPath, 'utf-8')) as Quest[];
    const reset = quests.map(q => ({ ...q, status: q.sourceDungeonId ? 'open' as const : 'undiscovered' as const, log: [] }));
    await writeFile(questsPath, JSON.stringify(reset, null, 2), 'utf-8');
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:quests', err); }

  const dungeonPath = path.join(dstDir, 'dungeon.json');
  let hasDungeon = false;
  try {
    const dungeon = JSON.parse(await readFile(dungeonPath, 'utf-8')) as Dungeon;
    // Only entities that are actually hidden behind a Perception check reset — decorative props
    // (type 'object') are placed with discovered: true and stay that way (see placer.ts), since
    // furniture isn't something a search reveals. Resetting them too left every prop invisible in
    // any campaign cloned from a template.
    dungeon.entities = dungeon.entities.map(e => e.hideDC === undefined ? e : { ...e, discovered: false });
    await writeFile(dungeonPath, JSON.stringify(dungeon, null, 2), 'utf-8');
    hasDungeon = true;
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:dungeon', err); }

  const manifestPath = path.join(dstDir, 'manifest.json');
  try {
    const original = JSON.parse(await readFile(manifestPath, 'utf-8')) as { currentLocation: string | null };
    const fresh = { ...emptyManifest(), currentLocation: original.currentLocation };
    await writeFile(manifestPath, JSON.stringify(fresh, null, 2), 'utf-8');
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:manifest', err); }

  // A template is reused across many campaigns — never carry the source game's password along.
  const worldMeta = await (async () => {
    try {
      const parsed = JSON.parse(await readFile(path.join(dstDir, 'world.json'), 'utf-8')) as WorldMeta;
      const { gamePassword: _pw, ...stripped } = parsed;
      await writeFile(path.join(dstDir, 'world.json'), JSON.stringify(stripped, null, 2), 'utf-8');
      return stripped;
    } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:worldMeta', err); return null; }
  })();

  const meta: SavedAdventureMeta = {
    slug: adventureSlug,
    name,
    sourceType: worldMeta?.type ?? 'campaign',
    savedAt: new Date().toISOString(),
    hasDungeon,
    ...(worldMeta?.scenarioSynopsis ? { scenarioSynopsis: worldMeta.scenarioSynopsis } : {}),
    ...(worldMeta?.partySize !== undefined ? { partySize: worldMeta.partySize } : {}),
    ...(worldMeta?.concept?.name ? { theme: worldMeta.concept.name } : {}),
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

  // scenario-storyboard.json bakes each slide's URL with the source campaign's slug baked in
  // (generateScenarioStoryboard writes it once, at generation time, for the campaign it was
  // generated for). A plain file copy carries those stale URLs over unchanged — the physical
  // jpgs move to campaignSlug's own directory, but slides[].url still points at adventureSlug's
  // old campaign path, which 404s (black screen) once that source campaign is gone or was never
  // a live campaign route to begin with. Rewrite them to the new campaignSlug, same idea as the
  // worldMeta rewrite above.
  const storyboardPath = path.join(dstDir, 'scenario-storyboard.json');
  try {
    const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as ScenarioStoryboard;
    storyboard.slides = storyboard.slides.map((slide, i) => ({ ...slide, url: scenarioSlideUrl(campaignSlug, i + 1) }));
    await writeFile(storyboardPath, JSON.stringify(storyboard, null, 2), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logError('adventures/storage:copyAdventureToCampaign:storyboard', err);
  }
}
