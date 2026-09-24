// Integration check for checkQuestChainTriggers — no test framework in this repo, so this is the
// one runnable check: `tsx src/dungeon/questChain.selfcheck.ts` from packages/api. Writes real
// quests.json under a throwaway campaign slug (never touches a real campaign), populates the
// in-memory `dungeons` map directly (checkQuestChainTriggers reads live dungeon state, not
// storage), exercises the actual code path, then deletes the throwaway campaign directory.
import type { Dungeon } from 'shared';
import { deleteCampaign, writeQuests, readQuests } from '../storage.ts';
import { registerDungeon, unregisterDungeon } from '../state.ts';
import { chainDungeonOf, checkQuestChainTriggers, onStageSuccess } from './questChain.ts';

const SLUG = '__selfcheck-questchain__';

const dungeon: Dungeon = {
  id: 'fixture-dungeon',
  name: 'Fixture Smoke House',
  width: 10,
  height: 10,
  cells: Array.from({ length: 10 }, () => new Array(10).fill(1)),
  rooms: [{ id: 'pit', name: 'Pit', x: 2, y: 2, width: 4, height: 4 }],
  entities: [],
  // The boss waits for stage-3 — it must not exist until stage-2 resolves.
  pendingSpawns: [{ stageId: 'stage-3', roomId: 'pit', statBlock: { id: 'boss', name: 'Pit Boss', cr: 3, hp: 40, ac: 14, speed: 30, stats: { str: 16, dex: 10, con: 14, int: 8, wis: 10, cha: 8 }, attacks: [], isBoss: true } }],
  questChain: [
    { id: 'stage-1', name: 'Find the Cellar', description: '- Get into the cellar', trigger: { kind: 'enter_room', roomName: 'Cellar' } },
    { id: 'stage-2', name: 'Find Food', description: '- Find food in the pit', trigger: { kind: 'discover_entity', entityName: 'Iron Rations' } },
    { id: 'stage-3', name: 'Escape', description: '- Get out alive', trigger: { kind: 'defeat_boss' } },
  ],
};

async function main() {
  registerDungeon(SLUG, dungeon);
  await writeQuests(SLUG, [
    { id: 'stage-1', name: 'Find the Cellar', description: '- Get into the cellar', status: 'open', log: [], addedAt: '2026-01-01', sourceDungeonId: dungeon.id },
  ]);

  // Wrong kind entirely (defeat_boss) while stage-1 (enter_room) is active — must no-op.
  await checkQuestChainTriggers(SLUG, { kind: 'defeat_boss' }, dungeon);
  let quests = await readQuests(SLUG);
  if (quests.find(q => q.id === 'stage-1')?.status !== 'open') throw new Error('an unrelated event kind must never resolve the active stage');
  if (quests.length !== 1) throw new Error(`expected still just 1 quest, got ${quests.length}`);

  // A later stage's trigger firing early (stage-3's defeat_boss, or stage-2's discover_entity for
  // the wrong entity) must never skip ahead — only the CURRENT active stage's exact trigger counts.
  await checkQuestChainTriggers(SLUG, { kind: 'discover_entity', entityName: 'Iron Rations' }, dungeon);
  quests = await readQuests(SLUG);
  if (quests.length !== 1) throw new Error('a future stage\'s trigger must never resolve anything while an earlier stage is still active');

  // The right trigger for the active stage — resolves stage-1, opens stage-2.
  await checkQuestChainTriggers(SLUG, { kind: 'enter_room', roomName: 'Cellar' }, dungeon);
  quests = await readQuests(SLUG);
  if (quests.find(q => q.id === 'stage-1')?.status !== 'resolved') throw new Error('stage-1 should resolve on its own enter_room trigger');
  if (quests.find(q => q.id === 'stage-2')?.status !== 'open') throw new Error('stage-2 should open immediately once stage-1 resolves');
  if (quests.length !== 2) throw new Error(`expected exactly 2 quests after stage-1 resolves, got ${quests.length}`);

  // stage-2's trigger — resolves it, opens stage-3.
  await checkQuestChainTriggers(SLUG, { kind: 'discover_entity', entityName: 'Iron Rations' }, dungeon);
  quests = await readQuests(SLUG);
  if (quests.find(q => q.id === 'stage-2')?.status !== 'resolved') throw new Error('stage-2 should resolve on discover_entity');
  if (quests.find(q => q.id === 'stage-3')?.status !== 'open') throw new Error('stage-3 should open once stage-2 resolves');
  if (!dungeon.entities.some(e => e.name === 'Pit Boss')) throw new Error('stage-3 opening must spawn the creature held for it');
  if (dungeon.pendingSpawns?.length) throw new Error('a spawned creature must leave pendingSpawns');

  // stage-3's trigger — resolves it, and since there's no stage-4, no new quest is added.
  await checkQuestChainTriggers(SLUG, { kind: 'defeat_boss' }, dungeon);
  quests = await readQuests(SLUG);
  if (quests.find(q => q.id === 'stage-3')?.status !== 'resolved') throw new Error('stage-3 should resolve on defeat_boss');
  if (quests.length !== 3) throw new Error(`expected exactly 3 quests total (the whole chain, nothing extra), got ${quests.length}`);

  // Chain fully resolved — a further event must no-op rather than throw or resurrect anything.
  await checkQuestChainTriggers(SLUG, { kind: 'exit_dungeon' }, dungeon);
  quests = await readQuests(SLUG);
  if (quests.length !== 3) throw new Error('an event with no active stage left must no-op');

  // The DM path ([[QUEST_RESOLVE]] in effects.ts) goes through the same hook: resolving the last
  // stage by hand must report the chain finished — the Congrats screen hangs off that.
  const byHand = quests.map(q => q.id === 'stage-3' ? { ...q, status: 'open' as const } : q);
  if (chainDungeonOf(SLUG, 'stage-3') !== dungeon) throw new Error('a chain stage id must find its dungeon');
  if (!await onStageSuccess(SLUG, dungeon, byHand, 'stage-3')) throw new Error('resolving the last stage must report the chain finished');
  if (byHand.find(q => q.id === 'stage-3')?.status !== 'resolved') throw new Error('the hook must resolve the stage');
  if (await onStageSuccess(SLUG, dungeon, byHand, 'not-a-stage')) throw new Error('an unknown id must no-op');
}

main()
  .then(() => console.log('questChain selfcheck: OK — stages resolve only on their own exact trigger, in order, never skip ahead, chain completes cleanly, held creatures spawn on their stage, the DM path reports completion.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => {
    unregisterDungeon(SLUG, dungeon.id);
    await deleteCampaign(SLUG);
  });
