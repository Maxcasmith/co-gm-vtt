import type { Dungeon } from 'shared';
import { readQuests, writeQuests, readManifest } from '../storage.ts';
import { io, ROOM, dungeons } from '../state.ts';

// Every kind of in-dungeon event that can resolve the active quest chain stage. See
// DungeonQuestTrigger (shared/types/dungeon.ts) for what each kind means and how it's matched.
export type QuestChainEvent =
  | { kind: 'enter_room'; roomName: string }
  | { kind: 'discover_entity'; entityName: string }
  | { kind: 'defeat_boss' }
  | { kind: 'exit_dungeon' };

// Deliberately its own module, not part of dungeon/runtime.ts or combat/runtime.ts — both of
// those need to call this (room-entry/discovery live in dungeon/runtime.ts, boss-defeat lives in
// combat/runtime.ts, which dungeon/runtime.ts already imports from), so putting it in either would
// create a circular import. This file only depends on storage.ts/state.ts.
//
// A linear chain has exactly one open, chain-sourced quest at a time (dungeon.questChain[n], where
// n is the first stage whose Quest is 'open' rather than 'resolved' or not yet created). Resolving
// it here both closes it out and opens the next stage's Quest, reusing the exact quest:update
// broadcast the Congrats modal already listens for — nothing else needed client-side.
export async function checkQuestChainTriggers(cid: string, event: QuestChainEvent): Promise<void> {
  const dungeon: Dungeon | undefined = dungeons.get(cid);
  const chain = dungeon?.questChain;
  if (!dungeon || !chain?.length) return;

  const quests = await readQuests(cid);
  const activeIdx = chain.findIndex(stage => quests.find(q => q.id === stage.id)?.status === 'open');
  if (activeIdx === -1) return;

  const stage = chain[activeIdx]!;
  const { trigger } = stage;
  const matches =
    (trigger.kind === 'enter_room' && event.kind === 'enter_room' && trigger.roomName === event.roomName) ||
    (trigger.kind === 'discover_entity' && event.kind === 'discover_entity' && trigger.entityName === event.entityName) ||
    (trigger.kind === 'defeat_boss' && event.kind === 'defeat_boss') ||
    (trigger.kind === 'exit_dungeon' && event.kind === 'exit_dungeon');
  if (!matches) return;

  const quest = quests.find(q => q.id === stage.id)!;
  quest.status = 'resolved';

  const next = chain[activeIdx + 1];
  if (next) {
    quests.push({
      id: next.id, name: next.name, description: next.description,
      status: 'open', log: [], addedAt: new Date().toISOString().slice(0, 10), sourceDungeonId: dungeon.id,
    });
  }

  await writeQuests(cid, quests);
  const manifest = await readManifest(cid);
  // `final` — this resolution closed out the chain's last stage (no next stage queued), i.e. the
  // whole dungeon questline is done, not just one stage of it. The Congrats screen (client)
  // gates on this instead of "any quest resolved" so it only shows once, at the true end.
  io.to(ROOM).emit('quest:update', { quests, act: manifest?.act ?? 1, final: !next });
}
