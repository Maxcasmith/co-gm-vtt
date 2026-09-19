import { characterLightRangeFt } from 'shared';
import { readNotes, readQuests, readManifest, listCharacters, loadDungeon, loadEncounters } from '../storage.ts';
import { toClientDungeon } from '../dungeon/index.ts';
import { io, campaignRoom, DEBUG_LOG_ROOM, connected, playerSocketIds, campaignPlayers, sessionState, dungeons, tokenPositions, microDungeons, withLivePositions, fightOf, fightsIn, registerFight } from '../state.ts';
import { maybeResolveRest, broadcastRestProgress } from './rest.ts';
import { conditionsHolder } from '../combat/runtime/statusEffects.ts';
import { chatHistoryFor } from '../partyGroups.ts';
import type { JoinContext } from './context.ts';

// Campaigns whose persisted fights have been reloaded into memory this process — see registerJoin.
const restoredCampaigns = new Set<string>();

export function registerJoin(ctx: JoinContext): void {
  const { socket, player, charId, campaignId } = ctx;

  connected.add(player);
  playerSocketIds.set(charId, socket.id);
  void socket.join([campaignRoom(campaignId), DEBUG_LOG_ROOM]);
  io.to(campaignRoom(campaignId)).emit('players:update', [...connected]);
  const cpl = campaignPlayers.get(campaignId) ?? [];
  if (!cpl.includes(player)) { cpl.push(player); campaignPlayers.set(campaignId, cpl); }

  void chatHistoryFor(campaignId, player).then(history => socket.emit('chat:history', history));
  void readNotes(campaignId).then(notes => socket.emit('note:history', notes));
  socket.emit('session:state', sessionState.get(campaignId) ?? false);
  socket.emit('combat:state', !!fightOf(campaignId, player));
  void Promise.all([readQuests(campaignId), readManifest(campaignId)]).then(([quests, manifest]) => {
    socket.emit('quest:update', { quests, act: manifest?.act ?? 1 });
    socket.emit('clock:update', { worldTimeSecs: manifest?.worldTimeSecs ?? 43200 });
  });

  void listCharacters(campaignId).then(chars => {
    const map: Record<string, string> = {};
    for (const c of chars) map[c.name] = c.id;
    io.to(campaignRoom(campaignId)).emit('players:characters', map);
  });

  // Restores dungeon + combat state for a reconnecting player. Prefers in-memory state (may
  // have reveals/moves not yet flushed to disk) but falls back to disk — needed because a
  // server restart (e.g. resuming a session a week later) wipes combatState/encounters/dungeons,
  // even though everything relevant was persisted via saveEncounter/saveDungeon as it happened.
  void (async () => {
    let dungeon = dungeons.get(campaignId);
    if (!dungeon) {
      const loaded = await loadDungeon(campaignId);
      if (loaded) { dungeons.set(campaignId, loaded); dungeon = loaded; }
    }
    if (dungeon) {
      if (dungeon.arena) microDungeons.add(campaignId);
      if (!tokenPositions.has(campaignId) && dungeon.positions) tokenPositions.set(campaignId, dungeon.positions);
      // Rebuild lightSources from scratch on (re)connect — the in-memory dungeon may be freshly
      // loaded from disk (server restart) with no idea who's currently holding a lit torch.
      const chars = await listCharacters(campaignId);
      const lightSources: Record<string, number> = {};
      for (const c of chars) {
        const range = characterLightRangeFt(c);
        if (range > 0) lightSources[c.name] = range;
      }
      dungeon.lightSources = lightSources;
      socket.emit('dungeon:loaded', toClientDungeon(withLivePositions(campaignId, dungeon)));
      Object.entries(tokenPositions.get(campaignId) ?? {}).forEach(([tokenId, pos]) => socket.emit('token:moved', { tokenId, ...pos }));
    }

    // A server restart wipes the in-memory fight registry — every fight was persisted as it
    // happened (saveEncounter), so reload them all once, the first time anyone rejoins.
    if (!restoredCampaigns.has(campaignId)) {
      restoredCampaigns.add(campaignId);
      if (!fightsIn(campaignId).length) {
        const everyone = (await listCharacters(campaignId)).map(c => c.name);
        for (const saved of await loadEncounters(campaignId)) {
          if (!saved.enemies.length || saved.allEnemiesDead()) continue;
          // A legacy single-fight save doesn't record who was in it — back then, everyone was.
          if (!saved.pendingPlayerNames.length) saved.pendingPlayerNames = everyone;
          saved.enemiesReady = true;
          registerFight(campaignId, saved);
        }
      }
    }

    // Only this player's own fight — another group's battle elsewhere isn't theirs to see.
    const encounter = fightOf(campaignId, player);
    const active = !!encounter;
    if (active) socket.emit('combat:state', true); // corrects the optimistic `false` sent above

    if (active && encounter) {
      socket.emit('encounter:ready', encounter.enemies
        .filter(p => p.creature)
        .map(p => p.creature!.toStatBlock()));

      const positions = tokenPositions.get(campaignId) ?? {};
      Object.entries(positions).forEach(([tokenId, pos]) => socket.emit('token:moved', { tokenId, ...pos }));

      if (encounter.turnOrder.length) {
        socket.emit('combat:turn:order', encounter.turnOrder.map(p => p.toTurnOrderEntry()));
        const actor = encounter.currentActor;
        if (actor) socket.emit('combat:turn', { actorId: actor.id, actorName: actor.name });

        // Re-sync any concentration badges a reconnecting client would otherwise have missed
        // (combat:concentration only fires at the moment it starts/breaks).
        for (const p of encounter.turnOrder) {
          const holder = await conditionsHolder(campaignId, p.id);
          const link = holder?.conditions?.find(c => c.name === 'Concentrating')?.concentration;
          if (link) socket.emit('combat:concentration', { targetId: p.id, targetName: p.name, spellName: link.spellName });
        }
      }
    }
  })();
}

export function registerDisconnectHandler(ctx: JoinContext): void {
  const { socket, player, charId, campaignId } = ctx;
  socket.on('disconnect', () => {
    connected.delete(player);
    playerSocketIds.delete(charId);
    io.to(campaignRoom(campaignId)).emit('players:update', [...connected]);
    // Removing this player may have been the last thing blocking a pending group rest.
    void broadcastRestProgress(campaignId);
    void maybeResolveRest(campaignId);
  });
}
