import { randomUUID } from 'crypto';
import path from 'path';
import type { SavedAdventureMeta, WorldMeta, Dungeon, Quest, ScenarioStoryboard } from 'shared';
import { campaignDir, emptyManifest } from '../storage.ts';
import { getTextStore, getMediaStore } from '../storage/index.ts';
import { scenarioSlideUrl } from '../dungeon/storyboard.ts';
import { logError } from '../logger.ts';

export const SAVED_ADVENTURES_DIR = 'saved-adventures';

export function slugifyAdventureName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function adventureDir(slug: string): string {
  return path.join(SAVED_ADVENTURES_DIR, slug);
}

// Collision-avoidance for a new saved-adventure directory, scoped to SAVED_ADVENTURES_DIR.
// adventure.json is always the last thing saveCampaignAsAdventure writes, so its presence is
// the marker that a slug is already taken.
export async function uniqueAdventureSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (await getTextStore().exists(path.join(adventureDir(slug), 'adventure.json'))) {
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
      const entries = await getTextStore().list(path.join(entitiesDir, type));
      return entries.filter(f => f.endsWith('.md')).length;
    }),
  );
  return { npc: counts[0]!, creature: counts[1]!, faction: counts[2]!, location: counts[3]! };
}

export async function saveCampaignAsAdventure(campaignSlug: string, adventureSlug: string, name: string): Promise<void> {
  const textStore = getTextStore();
  const mediaStore = getMediaStore();
  const srcDir = campaignDir(campaignSlug);
  const dstDir = adventureDir(adventureSlug);

  // Sequential, not Promise.all: on the local backend both stores physically share one
  // directory tree, so concurrent copies race to create the same destination folder.
  await textStore.copyPrefix(srcDir, dstDir);
  await mediaStore.copyPrefix(srcDir, dstDir);

  await Promise.all([
    ...PLAY_STATE_FILES.map(f => textStore.delete(path.join(dstDir, f))),
    ...PLAY_STATE_DIRS.map(d => Promise.all([
      textStore.deletePrefix(path.join(dstDir, d)),
      mediaStore.deletePrefix(path.join(dstDir, d)),
    ])),
  ]);

  // Quests/dungeon reset to a fresh starting state — a template is replayed from scratch every
  // time, never resumed mid-progress. Any quest seeded by a dungeon's own goals (sourceDungeonId
  // set — see generateDungeonQuests/questChain) was never discovery-gated: it's written straight
  // to 'open' at dungeon-generation time and the dungeon's closed-world narration never fires a
  // QUEST_ADD to un-hide it, so resetting it to 'undiscovered' would hide it forever. Only
  // campaign-level narrative quests (no sourceDungeonId — discovered mid-session via QUEST_ADD)
  // reset to 'undiscovered'.
  const questsKey = path.join(dstDir, 'quests.json');
  try {
    const raw = await textStore.get(questsKey);
    if (raw !== null) {
      const quests = JSON.parse(raw) as Quest[];
      const reset = quests.map(q => ({ ...q, status: q.sourceDungeonId ? 'open' as const : 'undiscovered' as const, log: [] }));
      await textStore.put(questsKey, JSON.stringify(reset, null, 2));
    }
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:quests', err); }

  const dungeonKey = path.join(dstDir, 'dungeon.json');
  let hasDungeon = false;
  try {
    const raw = await textStore.get(dungeonKey);
    if (raw !== null) {
      const dungeon = JSON.parse(raw) as Dungeon;
      // Only entities that are actually hidden behind a Perception check reset — decorative props
      // (type 'object') are placed with discovered: true and stay that way (see placer.ts), since
      // furniture isn't something a search reveals. Resetting them too left every prop invisible in
      // any campaign cloned from a template.
      dungeon.entities = dungeon.entities.map(e => e.hideDC === undefined ? e : { ...e, discovered: false });
      await textStore.put(dungeonKey, JSON.stringify(dungeon, null, 2));
      hasDungeon = true;
    }
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:dungeon', err); }

  const manifestKey = path.join(dstDir, 'manifest.json');
  try {
    const raw = await textStore.get(manifestKey);
    if (raw !== null) {
      const original = JSON.parse(raw) as { currentLocation: string | null };
      const fresh = { ...emptyManifest(), currentLocation: original.currentLocation };
      await textStore.put(manifestKey, JSON.stringify(fresh, null, 2));
    }
  } catch (err) { logError('adventures/storage:saveCampaignAsAdventure:manifest', err); }

  // A template is reused across many campaigns — never carry the source game's password along.
  const worldMetaKey = path.join(dstDir, 'world.json');
  const worldMeta = await (async () => {
    try {
      const raw = await textStore.get(worldMetaKey);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as WorldMeta;
      const { gamePassword: _pw, ...stripped } = parsed;
      await textStore.put(worldMetaKey, JSON.stringify(stripped, null, 2));
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
  await textStore.put(path.join(dstDir, 'adventure.json'), JSON.stringify(meta, null, 2));
}

export async function loadSavedAdventureMeta(slug: string): Promise<SavedAdventureMeta | null> {
  try {
    const raw = await getTextStore().get(path.join(adventureDir(slug), 'adventure.json'));
    return raw === null ? null : (JSON.parse(raw) as SavedAdventureMeta);
  } catch (err) {
    logError('adventures/storage:loadSavedAdventureMeta', err);
    return null;
  }
}

export async function listSavedAdventures(): Promise<SavedAdventureMeta[]> {
  const slugs = await getTextStore().list(SAVED_ADVENTURES_DIR);
  const results = await Promise.all(slugs.map(slug => loadSavedAdventureMeta(slug)));
  return results.filter((r): r is SavedAdventureMeta => r !== null);
}

export async function deleteSavedAdventure(slug: string): Promise<void> {
  const dir = adventureDir(slug);
  await Promise.all([getTextStore().deletePrefix(dir), getMediaStore().deletePrefix(dir)]);
}

// Zero LLM calls — the template already carries its starting location, undiscovered quests, and
// reset dungeon, so spinning up a copy is a plain storage clone plus a fresh campaign identity.
export async function copyAdventureToCampaign(adventureSlug: string, campaignSlug: string, campaignName: string): Promise<void> {
  const textStore = getTextStore();
  const mediaStore = getMediaStore();
  const srcDir = adventureDir(adventureSlug);
  const dstDir = campaignDir(campaignSlug);

  await textStore.copyPrefix(srcDir, dstDir);
  await mediaStore.copyPrefix(srcDir, dstDir);
  await textStore.delete(path.join(dstDir, 'adventure.json'));

  const worldMetaKey = path.join(dstDir, 'world.json');
  const original = JSON.parse((await textStore.get(worldMetaKey))!) as WorldMeta;
  const worldMeta: WorldMeta = { ...original, id: randomUUID(), name: campaignName, campaignDir: campaignSlug };
  await textStore.put(worldMetaKey, JSON.stringify(worldMeta, null, 2));

  // scenario-storyboard.json bakes each slide's URL with the source campaign's slug baked in
  // (generateScenarioStoryboard writes it once, at generation time, for the campaign it was
  // generated for). A plain copy carries those stale URLs over unchanged — the physical
  // jpgs move to campaignSlug's own directory, but slides[].url still points at adventureSlug's
  // old campaign path, which 404s (black screen) once that source campaign is gone or was never
  // a live campaign route to begin with. Rewrite them to the new campaignSlug, same idea as the
  // worldMeta rewrite above.
  const storyboardKey = path.join(dstDir, 'scenario-storyboard.json');
  try {
    const raw = await textStore.get(storyboardKey);
    if (raw !== null) {
      const storyboard = JSON.parse(raw) as ScenarioStoryboard;
      storyboard.slides = storyboard.slides.map((slide, i) => ({ ...slide, url: scenarioSlideUrl(campaignSlug, i + 1) }));
      await textStore.put(storyboardKey, JSON.stringify(storyboard, null, 2));
    }
  } catch (err) {
    logError('adventures/storage:copyAdventureToCampaign:storyboard', err);
  }
}

