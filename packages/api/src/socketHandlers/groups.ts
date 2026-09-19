import { listCharacters } from '../storage.ts';
import { io, campaignRoom, fightOf } from '../state.ts';
import { trackOf } from 'shared';
import { getPartyGroups, savePartyGroups, moveMember, addTrack, removeTrack, chatHistoryFor, summarizeClosedSplit, foldScenesOnReunion } from '../partyGroups.ts';
import { logError } from '../logger.ts';
import type { JoinContext } from './context.ts';

async function rosterNames(cid: string): Promise<string[]> {
  return (await listCharacters(cid)).map(c => c.name);
}

export function registerGroupHandlers(ctx: JoinContext): void {
  const { socket, player, charId, campaignId } = ctx;

  void getPartyGroups(campaignId).then(groups => socket.emit('groups:update', groups));

  // Only ever moves the requester's own character — the payload carries no "who".
  socket.on('groups:move', ({ track }) => {
    void (async () => {
      // Changing track mid-fight would pull a combatant's chat out from under the fight they're in.
      if (fightOf(campaignId, charId)) return;
      const groups = await getPartyGroups(campaignId);
      const from = trackOf(groups, player);
      if (from === track) return;
      const transition = moveMember(groups, player, track, await rosterNames(campaignId));
      if (!transition) return;
      if (transition.ended) await foldScenesOnReunion(campaignId, groups, track);
      await savePartyGroups(campaignId, groups);
      io.to(campaignRoom(campaignId)).emit('groups:update', groups);

      if (transition.ended) {
        void summarizeClosedSplit(campaignId, transition.ended).catch(err => logError('groups:summarizeClosedSplit', err));
        // Reunited — every closed branch is now visible to everyone, and history is identical for all.
        io.to(campaignRoom(campaignId)).emit('chat:history', await chatHistoryFor(campaignId, player));
      } else if (!transition.started) {
        // Switched tracks mid-split — the mover now sees their new track's branch so far.
        socket.emit('chat:history', await chatHistoryFor(campaignId, player));
      }
    })().catch(err => logError('groups:move', err));
  });

  socket.on('groups:track:add', () => {
    void (async () => {
      const groups = await getPartyGroups(campaignId);
      if (!addTrack(groups)) return;
      await savePartyGroups(campaignId, groups);
      io.to(campaignRoom(campaignId)).emit('groups:update', groups);
    })().catch(err => logError('groups:track:add', err));
  });

  socket.on('groups:track:remove', ({ track }) => {
    void (async () => {
      const groups = await getPartyGroups(campaignId);
      if (!removeTrack(groups, track, await rosterNames(campaignId))) return;
      await savePartyGroups(campaignId, groups);
      io.to(campaignRoom(campaignId)).emit('groups:update', groups);
    })().catch(err => logError('groups:track:remove', err));
  });
}
