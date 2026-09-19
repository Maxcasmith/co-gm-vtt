// Regression check for the storage layer's public API (storage.ts, compendium/storage.ts,
// adventures/storage.ts). Run with `tsx src/storage.selfcheck.ts` from packages/api. Exercises
// whatever backend STORAGE_TEXT_BACKEND/STORAGE_MEDIA_BACKEND currently select (default: local) —
// same assertions, same fixtures, regardless of which backend is under test.
import path from 'path';
import type { Character, WorldMeta, ChatPayload, Quest, Dungeon, CompendiumMeta } from 'shared';
import {
  campaignDir, writeWorldMeta, getWorldMeta, listCampaigns,
  writeCharacter, getCharacter, listCharacters, updateCharacter, findCharacterByPassword,
  appendChatLog, readChatLog, writeCharacterImage, writeCampaignImage,
  saveMap, appendMapIndex, listMaps, saveDungeon, loadDungeon, clearDungeon,
  writeQuests, readQuests, writeEntity, readEntity, listEntitySlugs, deleteCampaign,
  getConfig, saveConfig, readPlotHooks, writePlotHooks,
} from './storage.ts';
import { getMediaStore } from './storage/index.ts';
import {
  saveCompendiumMeta, loadCompendiumMeta, saveCompendiumRaw, loadCompendiumRaw,
  copyCompendiumToCampaign, deleteCompendiumAdventure,
} from './compendium/storage.ts';
import {
  saveCampaignAsAdventure, loadSavedAdventureMeta, copyAdventureToCampaign,
  deleteSavedAdventure,
} from './adventures/storage.ts';

const SLUG = '__selfcheck-storage__';
const SLUG2 = '__selfcheck-storage-clone__';
const SLUG3 = '__selfcheck-storage-fromadv__';
const CHAR_ID = 'char-1';
const ADV_SLUG = '__selfcheck-storage-adv__';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function cleanup() {
  await Promise.all([SLUG, SLUG2, SLUG3].map(s => deleteCampaign(s)));
  await deleteSavedAdventure('fixture-saved-adventure');
  await deleteCompendiumAdventure(ADV_SLUG);
}

async function main() {
  await cleanup(); // idempotent: wipe any leftovers from a previous failed run before asserting fresh state

  // --- storage.ts: world meta + campaign listing ---
  const meta: WorldMeta = { id: SLUG, name: 'Selfcheck Campaign', campaignDir: SLUG, type: 'campaign' };
  await writeWorldMeta(SLUG, meta);
  const readMeta = await getWorldMeta(SLUG);
  assert(readMeta?.name === 'Selfcheck Campaign', 'world meta round-trip failed');
  const campaigns = await listCampaigns();
  assert(campaigns.some(c => c.id === SLUG), 'listCampaigns should include the fixture campaign');

  // --- characters ---
  const char: Character = {
    id: CHAR_ID, campaignId: SLUG, name: 'Fixture Hero', species: 'Human', background: 'Sage',
    class: 'Wizard', stats: { str: 10, dex: 12, con: 14, int: 16, wis: 10, cha: 8 },
    skillProficiencies: ['Arcana'], password: 'secret', portraitPath: 'portrait.jpg',
    tokenPath: 'token.jpg', createdAt: new Date().toISOString(),
  };
  await writeCharacter(SLUG, CHAR_ID, char);
  const readChar = await getCharacter(SLUG, CHAR_ID);
  assert(readChar?.name === 'Fixture Hero', 'character round-trip failed');
  const chars = await listCharacters(SLUG);
  assert(chars.length === 1 && chars[0]!.id === CHAR_ID, 'listCharacters should return the fixture character');
  const found = await findCharacterByPassword(SLUG, 'secret');
  assert(found?.id === CHAR_ID, 'findCharacterByPassword should find the fixture character');

  const updated = await updateCharacter(SLUG, CHAR_ID, c => ({ ...c, name: 'Renamed Hero' }));
  assert(updated?.name === 'Renamed Hero', 'updateCharacter should apply the updater');
  const reread = await getCharacter(SLUG, CHAR_ID);
  assert(reread?.name === 'Renamed Hero', 'updateCharacter should persist the change');

  // --- chat log ---
  const chatMsg: ChatPayload = { text: 'Welcome', senderName: 'System', timestamp: Date.now() };
  await appendChatLog(SLUG, chatMsg);
  const log = await readChatLog(SLUG);
  assert(log.length === 1 && log[0]!.text === 'Welcome', 'chat log round-trip failed');

  // --- images (no getter in storage.ts — verify the write landed via the MediaStore directly) ---
  await writeCharacterImage(SLUG, CHAR_ID, 'portrait.jpg', Buffer.from('fake-jpg-bytes'));
  const portraitBytes = await getMediaStore().get(path.join(campaignDir(SLUG), 'party', CHAR_ID, 'portrait.jpg'));
  assert(portraitBytes?.toString() === 'fake-jpg-bytes', 'character image write failed');

  await writeCampaignImage(SLUG, 'banner.jpg', Buffer.from('banner-bytes'));
  const bannerBytes = await getMediaStore().get(path.join(campaignDir(SLUG), 'banner.jpg'));
  assert(bannerBytes?.toString() === 'banner-bytes', 'campaign image write failed');

  // --- maps ---
  await saveMap(SLUG, 'map-1', Buffer.from('map-bytes'));
  await appendMapIndex(SLUG, { id: 'map-1', name: 'Fixture Map' } as never);
  const maps = await listMaps(SLUG);
  assert(maps.some(m => m.id === 'map-1'), 'map index round-trip failed');

  // --- dungeon ---
  const dungeon: Dungeon = {
    id: 'd1', name: 'Fixture Dungeon', width: 2, height: 2,
    cells: [[1, 1], [1, 1]], rooms: [], tilesetSlug: 'none', entities: [],
  } as unknown as Dungeon;
  await saveDungeon(SLUG, dungeon);
  const loadedDungeon = await loadDungeon(SLUG);
  assert(loadedDungeon?.id === 'd1', 'dungeon round-trip failed');
  await clearDungeon(SLUG);
  assert((await loadDungeon(SLUG)) === null, 'clearDungeon should remove the dungeon file');

  // --- quests ---
  const quests: Quest[] = [{ id: 'q1', title: 'Fixture Quest', status: 'open', log: [] } as unknown as Quest];
  await writeQuests(SLUG, quests);
  const readQuestsResult = await readQuests(SLUG);
  assert(readQuestsResult.length === 1 && readQuestsResult[0]!.id === 'q1', 'quests round-trip failed');

  // --- entities (storage.ts's own, campaign-scoped) ---
  await writeEntity(SLUG, 'npc', 'fixture-npc', '# Fixture NPC\nA test entity.');
  const entityContent = await readEntity(SLUG, 'npc', 'fixture-npc');
  assert(entityContent?.includes('Fixture NPC'), 'entity round-trip failed');
  const entitySlugs = await listEntitySlugs(SLUG, 'npc');
  assert(entitySlugs.includes('fixture-npc'), 'listEntitySlugs should include the fixture entity');

  // --- compendium/storage.ts ---
  const compMeta: CompendiumMeta = {
    slug: ADV_SLUG, name: 'Fixture Adventure', source: 'selfcheck',
    entityCount: { npc: 0, creature: 0, faction: 0, location: 0 },
  } as unknown as CompendiumMeta;
  await saveCompendiumMeta(ADV_SLUG, compMeta);
  const readCompMeta = await loadCompendiumMeta(ADV_SLUG);
  assert(readCompMeta?.name === 'Fixture Adventure', 'compendium meta round-trip failed');
  await saveCompendiumRaw(ADV_SLUG, '# Raw adventure text');
  const rawText = await loadCompendiumRaw(ADV_SLUG);
  assert(rawText?.includes('Raw adventure text'), 'compendium raw round-trip failed');

  await copyCompendiumToCampaign(ADV_SLUG, SLUG2, 'Cloned From Compendium');
  const clonedMeta = await getWorldMeta(SLUG2);
  assert(clonedMeta?.adventureSlug === ADV_SLUG, 'copyCompendiumToCampaign should stamp the source adventure slug');

  // --- adventures/storage.ts: save campaign as reusable template, then clone it back ---
  await saveCampaignAsAdventure(SLUG, 'fixture-saved-adventure', 'Fixture Saved Adventure');
  const savedMeta = await loadSavedAdventureMeta('fixture-saved-adventure');
  assert(savedMeta?.name === 'Fixture Saved Adventure', 'saveCampaignAsAdventure/loadSavedAdventureMeta round-trip failed');

  await copyAdventureToCampaign('fixture-saved-adventure', SLUG3, 'Cloned From Adventure');
  const clonedFromAdv = await getWorldMeta(SLUG3);
  assert(clonedFromAdv?.name === 'Cloned From Adventure', 'copyAdventureToCampaign should produce a working campaign clone');
  const clonedChars = await listCharacters(SLUG3);
  assert(clonedChars.length === 0, 'a saved-adventure template should strip the party — clone should start empty');

  await deleteSavedAdventure('fixture-saved-adventure');
  assert((await loadSavedAdventureMeta('fixture-saved-adventure')) === null, 'deleteSavedAdventure should remove the template');

  await deleteCompendiumAdventure(ADV_SLUG);

  // --- global singletons: config.json, plot-hooks.json — read-modify-restore, never clobber real data ---
  const originalConfig = await getConfig();
  await saveConfig({ ...originalConfig, adminPassword: '__selfcheck-marker__' });
  assert((await getConfig()).adminPassword === '__selfcheck-marker__', 'config round-trip failed');
  await saveConfig(originalConfig);
  assert((await getConfig()).adminPassword === originalConfig.adminPassword, 'config restore failed');

  const originalHooks = await readPlotHooks();
  const fixtureHook = { id: '__selfcheck-hook__', rawText: 'x', title: 'x', tags: [], structuralRequirements: [], beats: [], createdAt: new Date().toISOString(), usedIn: [] } as never;
  await writePlotHooks([...originalHooks, fixtureHook]);
  assert((await readPlotHooks()).some(h => h.id === '__selfcheck-hook__'), 'plot hooks round-trip failed');
  await writePlotHooks(originalHooks);
  assert((await readPlotHooks()).length === originalHooks.length, 'plot hooks restore failed');
}

main()
  .then(() => console.log('storage selfcheck: OK — storage.ts, compendium/storage.ts, adventures/storage.ts round-trips all behave.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(cleanup)
  // A live mysql2 pool keeps its sockets open (correct for a long-lived server), which would
  // otherwise leave this one-off script hanging forever instead of exiting after the run.
  .finally(() => process.exit(process.exitCode ?? 0));
