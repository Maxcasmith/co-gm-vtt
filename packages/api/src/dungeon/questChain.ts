import type { Dungeon, Quest } from 'shared';
import { readQuests, writeQuests, readManifest, saveDungeon, getWorldMeta } from '../storage.ts';
import { io, campaignRoom, dungeonsIn } from '../state.ts';
import { broadcastDungeon } from './index.ts';
import { dungeonEvents } from './events.ts';
import { spawnPending } from './placer.ts';

// Every kind of in-dungeon event that can resolve the active quest chain stage. See
// DungeonQuestTrigger (shared/types/dungeon.ts) for what each kind means and how it's matched.
export type QuestChainEvent =
  | { kind: 'enter_room'; roomName: string }
  | { kind: 'discover_entity'; entityName: string }
  | { kind: 'defeat_boss' }
  | { kind: 'exit_dungeon' };

// Deliberately its own module, not part of dungeon/runtime.ts or combat/runtime/ — both of
// those need to call this (room-entry/discovery live in dungeon/runtime.ts, boss-defeat lives in
// combat/runtime/damage.ts, which dungeon/runtime.ts already imports from), so putting it in
// either would create a circular import. Game completion goes out through dungeonEvents for the
// same reason: ending the session lives in session.ts, which imports effects.ts, which imports this.
//
// A linear chain has exactly one open, chain-sourced quest at a time (dungeon.questChain[n], where
// n is the first stage whose Quest is 'open' rather than 'resolved' or not yet created).
export async function checkQuestChainTriggers(cid: string, event: QuestChainEvent, dungeon: Dungeon | undefined): Promise<void> {
  const chain = dungeon?.questChain;
  if (!dungeon || !chain?.length) return;

  const quests = await readQuests(cid);
  const activeIdx = chain.findIndex(stage => quests.find(q => q.id === stage.id)?.status === 'open');
  if (activeIdx === -1) return;

  const { trigger } = chain[activeIdx]!;
  const matches =
    (trigger.kind === 'enter_room' && event.kind === 'enter_room' && trigger.roomName === event.roomName) ||
    (trigger.kind === 'discover_entity' && event.kind === 'discover_entity' && trigger.entityName === event.entityName) ||
    (trigger.kind === 'defeat_boss' && event.kind === 'defeat_boss') ||
    (trigger.kind === 'exit_dungeon' && event.kind === 'exit_dungeon');
  if (!matches) return;

  const final = await onStageSuccess(cid, dungeon, quests, chain[activeIdx]!.id);
  await writeQuests(cid, quests);
  const manifest = await readManifest(cid);
  io.to(campaignRoom(cid)).emit('quest:update', { quests, act: manifest?.act ?? 1 });
  if (final) await completeChain(cid, dungeon);
}

/** The loaded dungeon whose quest chain holds `stageId`, if any — how a DM-resolved quest
 * ([[QUEST_RESOLVE]]) finds out it was a chain stage and must go through onStageSuccess. */
export function chainDungeonOf(cid: string, stageId: string): Dungeon | undefined {
  return dungeonsIn(cid).find(d => d.questChain?.some(s => s.id === stageId));
}

/**
 * onSuccess — the ONE place a chain stage resolves, whether a mechanical trigger fired
 * (checkQuestChainTriggers) or the DM declared it done ([[QUEST_RESOLVE]], effects.ts). Mutates
 * `quests` in place; the caller writes and broadcasts it. Runs the stage's events in order:
 *   1. the stage is marked resolved;
 *   2. the next stage opens, and every creature held for it spawns (placer.ts's spawnPending);
 *   3. no next stage → returns true, and the caller runs completeChain once quests are written.
 * New event kinds (unlock a door, reveal a room, narrate) belong here, next to the spawn.
 */
export async function onStageSuccess(cid: string, dungeon: Dungeon, quests: Quest[], stageId: string): Promise<boolean> {
  const chain = dungeon.questChain ?? [];
  const idx = chain.findIndex(s => s.id === stageId);
  if (idx === -1) return false;

  const quest = quests.find(q => q.id === stageId);
  if (quest) quest.status = 'resolved';

  const next = chain[idx + 1];
  if (!next) return true;
  if (!quests.some(q => q.id === next.id)) {
    quests.push({
      id: next.id, name: next.name, description: next.description,
      status: 'open', log: [], addedAt: new Date().toISOString().slice(0, 10), sourceDungeonId: dungeon.id,
    });
  }
  const arrived = spawnPending(dungeon, next.id);
  if (arrived.length) {
    console.log(`[dungeon] stage "${next.id}" opened — spawned ${arrived.map(e => e.name).join(', ')}`);
    await saveDungeon(cid, dungeon);
    broadcastDungeon(cid, dungeon);
    // Aggro lives in runtime.ts, which imports this file — so it's reached through the event.
    dungeonEvents.emit('creatures_spawned', { cid, dungeon, spawned: arrived });
  }
  return false;
}

/** The chain's last stage succeeded. Only a dungeon crawl — one dungeon IS the whole game — ends
 * here; a campaign carries on to its next location, so this is a no-op there. */
export async function completeChain(cid: string, dungeon: Dungeon): Promise<void> {
  if ((await getWorldMeta(cid))?.type !== 'dungeon-crawl') return;
  dungeonEvents.emit('game_complete', { cid, dungeon });
}
