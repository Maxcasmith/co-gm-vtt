import { listCharacters } from '../storage.ts';
import { io, campaignRoom, fightOf, locationOf, sessionState } from '../state.ts';
import { trackOf, locationOfTrack } from 'shared';
import { getPartyGroups, savePartyGroups, moveMember, addTrack, removeTrack, chatHistoryFor, summarizeClosedSplit, foldScenesOnReunion } from '../partyGroups.ts';
import { logError } from '../logger.ts';
import type { JoinContext } from './context.ts';

async function rosterNames(cid: string): Promise<string[]> {
  return (await listCharacters(cid)).map(c => c.name);
}

export function registerGroupHandlers(ctx: JoinContext): void {
  const { socket, player, charId, campaignId } = ctx;

  void getPartyGroups(campaignId).then(groups => socket.emit('groups:update', groups));

  // Splitting and rejoining is something the party does in play — outside a running session there's
  // no narration, no DM turns and nothing to keep apart, so every group change is refused.
  const sessionRunning = () => sessionState.get(campaignId) === true;

  // Only ever moves the requester's own character — the payload carries no "who".
  socket.on('groups:move', ({ track }) => {
    void (async () => {
      if (!sessionRunning()) return;
      // Changing track mid-fight would pull a combatant's chat out from under the fight they're in.
      if (fightOf(campaignId, charId)) return;
      const groups = await getPartyGroups(campaignId);
      const from = trackOf(groups, player);
      if (from === track) return;
      // A track belongs to the place its group is in — you can only switch between tracks where
      // you're standing. Joining a group inside a dungeon you're not in would teleport you there.
      if (locationOfTrack(groups, track) !== locationOfTrack(groups, from)) return;
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
      if (!sessionRunning()) return;
      const groups = await getPartyGroups(campaignId);
      if (!addTrack(groups, locationOf(campaignId, player))) return;
      await savePartyGroups(campaignId, groups);
      io.to(campaignRoom(campaignId)).emit('groups:update', groups);
    })().catch(err => logError('groups:track:add', err));
  });

  socket.on('groups:track:remove', ({ track }) => {
    void (async () => {
      if (!sessionRunning()) return;
      const groups = await getPartyGroups(campaignId);
      if (!removeTrack(groups, track, await rosterNames(campaignId))) return;
      await savePartyGroups(campaignId, groups);
      io.to(campaignRoom(campaignId)).emit('groups:update', groups);
    })().catch(err => logError('groups:track:remove', err));
  });
}
