import { characterLightRangeFt } from 'shared';
import { readChatLog, readQuests, readManifest, listCharacters, loadDungeon, loadEncounter } from '../storage.ts';
import { toClientDungeon } from '../dungeon/index.ts';
import { io, ROOM, connected, playerSocketIds, campaignPlayers, sessionState, combatState, dungeons, tokenPositions, microDungeons, encounters, enemiesReady, withLivePositions } from '../state.ts';
import { maybeResolveRest, broadcastRestProgress } from './rest.ts';
import { conditionsHolder } from '../combat/runtime.ts';
import type { JoinContext } from './context.ts';

export function registerJoin(ctx: JoinContext): void {
  const { socket, player, charId, campaignId } = ctx;

  connected.add(player);
  playerSocketIds.set(charId, socket.id);
  void socket.join(ROOM);
  io.to(ROOM).emit('players:update', [...connected]);
  const cpl = campaignPlayers.get(campaignId) ?? [];
  if (!cpl.includes(player)) { cpl.push(player); campaignPlayers.set(campaignId, cpl); }

  void readChatLog(campaignId).then(history => socket.emit('chat:history', history));
  socket.emit('session:state', sessionState.get(campaignId) ?? false);
  socket.emit('combat:state', combatState.get(campaignId) ?? false);
  void Promise.all([readQuests(campaignId), readManifest(campaignId)]).then(([quests, manifest]) => {
    socket.emit('quest:update', { quests, act: manifest?.act ?? 1 });
    socket.emit('clock:update', { worldTimeSecs: manifest?.worldTimeSecs ?? 43200 });
  });

  void listCharacters(campaignId).then(chars => {
    const map: Record<string, string> = {};
    for (const c of chars) map[c.name] = c.id;
    io.to(ROOM).emit('players:characters', map);
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

    let encounter = encounters.get(campaignId);
    let active = combatState.get(campaignId) ?? false;
    if (!active) {
      const saved = encounter ?? await loadEncounter(campaignId);
      if (saved && saved.enemies.length > 0 && !saved.allEnemiesDead()) {
        encounters.set(campaignId, saved);
        encounter = saved;
        combatState.set(campaignId, true);
        enemiesReady.set(campaignId, true);
        active = true;
        socket.emit('combat:state', true); // corrects the optimistic `false` sent above
      }
    }

    if (active && encounter) {
      socket.emit('encounter:ready', encounter.enemies
        .filter(p => p.creature)
        .map(p => p.creature!.toStatBlock()));

      const positions = tokenPositions.get(campaignId) ?? {};
      Object.entries(positions).forEach(([tokenId, pos]) => socket.emit('token:moved', { tokenId, ...pos }));

      if (encounter.turnOrder.length) {
        socket.emit('combat:turn:order', encounter.turnOrder.map(p => p.toTurnOrderEntry()));
        const actor = encounter.currentActor;
        if (actor) socket.emit('combat:turn', { actorName: actor.name });

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
    io.to(ROOM).emit('players:update', [...connected]);
    // Removing this player may have been the last thing blocking a pending group rest.
    void broadcastRestProgress(campaignId);
    void maybeResolveRest(campaignId);
  });
}
