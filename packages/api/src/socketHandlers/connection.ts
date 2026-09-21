import { characterLightRangeFt, trackOf } from 'shared';
import { readNotes, readQuests, readManifest, listCharacters, loadDungeons, loadEncounters } from '../storage.ts';
import { broadcastDungeon } from '../dungeon/index.ts';
import { io, campaignRoom, DEBUG_LOG_ROOM, connected, playerSocketIds, playerCharIds, campaignPlayers, sessionState, dungeonsIn, dungeonOf, registerDungeon, fightOf, fightsIn, registerFight, isDungeonGeneratingFor, isFightGenerating } from '../state.ts';
import { maybeResolveRest, broadcastRestProgress } from './rest.ts';
import { turnPayload } from '../combat/runtime/lifecycle.ts';
import { conditionsHolder } from '../combat/runtime/statusEffects.ts';
import { chatHistoryFor, getPartyGroups, setTrackLocations } from '../partyGroups.ts';
import type { JoinContext } from './context.ts';

// Campaigns whose persisted fights have been reloaded into memory this process — see registerJoin.
const restoredFights = new Set<string>();

export function registerJoin(ctx: JoinContext): void {
  const { socket, player, charId, campaignId } = ctx;

  connected.add(player);
  playerSocketIds.set(charId, socket.id);
  const names = playerCharIds.get(campaignId) ?? new Map<string, string>();
  names.set(player, charId);
  playerCharIds.set(campaignId, names);
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
    // A server restart wipes the in-memory registries — everything was persisted as it happened
    // (saveDungeon/saveEncounter), so reload the campaign's maps once, the first time anyone rejoins.
    if (!dungeonsIn(campaignId).length) {
      const loaded = await loadDungeons(campaignId);
      const groups = await getPartyGroups(campaignId);
      const real = loaded.filter(d => !d.arena);
      // A save from before per-group locations (or a dungeon-crawl campaign) has exactly one
      // dungeon and the whole party inside it.
      if (!groups.locations && real.length === 1) {
        registerDungeon(campaignId, real[0]!);
        await setTrackLocations(campaignId, null, real[0]!.id);
      } else {
        // Only what's actually in play: the maps groups are currently standing in, plus arenas for
        // any live fight. The rest stay on disk — dungeons are kept after the party leaves so they
        // can be re-entered, so loading every one would grow this with visit history rather than
        // with what's active. reopenStoredDungeon (effects.ts) registers one on demand.
        const occupied = new Set(Object.values(groups.locations ?? {}));
        for (const d of loaded) if (d.arena || occupied.has(d.id)) registerDungeon(campaignId, d);
      }
    }

    // Only the map this player is standing on — another group's dungeon isn't theirs to see.
    const dungeon = dungeonOf(campaignId, player);
    if (dungeon) {
      // Rebuild lightSources from scratch on (re)connect — the in-memory dungeon may be freshly
      // loaded from disk (server restart) with no idea who's currently holding a lit torch.
      const chars = await listCharacters(campaignId);
      const lightSources: Record<string, number> = {};
      for (const c of chars) {
        const range = characterLightRangeFt(c);
        if (range > 0) lightSources[c.name] = range;
      }
      dungeon.lightSources = lightSources;
      broadcastDungeon(campaignId, dungeon, socket);
      Object.entries(dungeon.positions ?? {}).forEach(([tokenId, pos]) => socket.emit('token:moved', { tokenId, ...pos }));
    }

    // Reloading mid-generation would otherwise drop this player onto a live, fully interactive map
    // for the rest of the wait — dungeon:generating was emitted before they disconnected and is
    // never repeated. Replayed after the dungeon broadcast above so it wins: the loading screen is
    // the last word until dungeon:loaded (or dungeon:failed) arrives for real.
    if (isDungeonGeneratingFor(campaignId, trackOf(await getPartyGroups(campaignId), player))) {
      socket.emit('dungeon:generating');
    }

    // A server restart wipes the in-memory fight registry — every fight was persisted as it
    // happened (saveEncounter), so reload them all once, the first time anyone rejoins.
    if (!restoredFights.has(campaignId)) {
      restoredFights.add(campaignId);
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
      // Enemies are still being generated — emitting encounter:ready here with the (empty) roster
      // would dismiss this player's loading screen and leave them in an arena with nothing in it
      // until generation lands. Send the generating signal instead; the real encounter:ready is
      // broadcast to the whole fight when it completes.
      if (isFightGenerating(encounter.id)) socket.emit('encounter:generating');
      else socket.emit('encounter:ready', encounter.enemies
        .filter(p => p.creature)
        .map(p => p.creature!.toStatBlock()));


      // Down/dead flags are otherwise only set by live events, so a refresh would show them upright.
      socket.emit('combat:downed:sync', {
        downNames: encounter.teams.flatMap(t => t.participants).filter(p => p.isPlayer && p.currentHp <= 0 && !p.isDead()).map(p => p.name),
        deadNames: encounter.teams.flatMap(t => t.participants).filter(p => p.isPlayer && p.isDead()).map(p => p.name),
        deadCreatureIds: encounter.teams.flatMap(t => t.participants).filter(p => !p.isPlayer && p.isDead()).map(p => p.id),
        players: encounter.teams.flatMap(t => t.participants).filter(p => p.isPlayer).map(p => ({ id: p.id, name: p.name, currentHp: p.currentHp, maxHp: p.maxHp, tempHp: p.tempHp })),
      });

      const me = encounter.findParticipant(charId);
      if (me) socket.emit('combat:player:resources', { characterId: me.id, actionsRemaining: me.actionsRemaining, bonusActionsRemaining: me.bonusActionsRemaining, reactionsRemaining: me.reactionsRemaining, activeEffects: me.activeEffects });

      if (encounter.turnOrder.length) {
        socket.emit('combat:turn:order', encounter.turnOrder.map(p => p.toTurnOrderEntry()));
        const actor = encounter.currentActor;
        // resync: client keeps its own movement/buffs state instead of refilling as for a fresh turn.
        if (actor) socket.emit('combat:turn', { ...turnPayload(campaignId, actor), resync: true, ...(actor.movementRemainingFt !== undefined ? { movementRemainingFt: actor.movementRemainingFt } : {}) });
        for (const p of encounter.turnOrder) if (p.elevationFt) socket.emit('combat:elevation:update', { targetId: p.id, elevationFt: p.elevationFt });

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
