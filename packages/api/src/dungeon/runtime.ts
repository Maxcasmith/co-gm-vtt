import type { DungeonEntity, EnemyStatBlock } from 'shared';
import { hasLineOfSight, closedDoorCells } from 'shared';
import { randomUUID } from 'crypto';
import { saveDungeon, saveEncounter, getConfig, readChatLog, listCharacters, readNemeses, readManifest, appendChatLog } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateEncounterEnemies } from '../session-processor/imagePrompts.ts';
import { generateEncounterDungeon, toClientDungeon, roomAt } from './index.ts';
import { templateRoomEntry, type SearchFind } from './narrateEvents.ts';
import { dungeonEvents } from './events.ts';
import { Encounter, Team, Participant } from '../domain/encounter.ts';
import { Creature } from '../domain/creature.ts';
import { logError, logDebug } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, dungeons, microDungeons, withLivePositions, PLAYER_SIGHT_RADIUS, ENEMY_AGGRO_RADIUS, enemiesReady, combatStartedAt } from '../state.ts';
import { addToTurnOrder, rollPlayerInitiatives, rollEnemyInitiatives, checkTrapAt } from '../combat/runtime.ts';

// Live cell positions of every participant currently in the fight — players keyed by name,
// everyone else (creatures, allies) keyed by id, matching tokenPositions' own convention.
function combatantPositions(cid: string, encounter: Encounter): { gx: number; gy: number }[] {
  const positions = tokenPositions.get(cid) ?? {};
  return encounter.turnOrder
    .map(p => positions[p.isPlayer ? p.name : p.id])
    .filter((pos): pos is { gx: number; gy: number } => !!pos);
}

// Runs on every player token move while a dungeon is loaded: reveals creatures within sight,
// fires room_entered the first time a room is stepped into, and either starts combat (not
// already fighting) or pulls newly-aggro'd creatures into the running fight (already fighting)
// when one comes within aggro radius of ANY live combatant — not just the player who moved, so a
// creature lurking near an already-engaged ally or enemy still gets pulled in even though it's
// out of range of whoever happened to trigger this check.
export async function checkDungeonProximity(cid: string, gx: number, gy: number, characterName: string): Promise<void> {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const inCombat = combatState.get(cid);
  const encounter = inCombat ? encounters.get(cid) : undefined;
  // The entrance room is the placement safe zone (see placer.ts's isEntranceRoom) — nothing hostile
  // spawns inside it, but a creature can still be placed just past its threshold. Without this, that
  // creature's aggro radius could still reach in and ambush a party that hasn't even left the room
  // yet. A position still standing in the entrance can't trigger aggro; once it steps out, normal
  // detection applies immediately, even right at the doorway.
  const aggroSources = (encounter ? combatantPositions(cid, encounter) : [{ gx, gy }])
    .filter(pos => roomAt(dungeon, pos.gx, pos.gy)?.role !== 'entrance');

  let changed = false;
  const aggro: DungeonEntity[] = [];
  // A shut, opaque door blocks discovery/aggro sight the same as a wall — computed once per call
  // rather than per entity, since it doesn't change mid-loop.
  const blocked = closedDoorCells(dungeon);

  const room = roomAt(dungeon, gx, gy);
  if (room && !room.visited) {
    room.visited = true;
    changed = true;
    dungeonEvents.emit('room_entered', { cid, room, characterName });
  }

  await checkTrapAt(cid, gx, gy, characterName, characterName, true);

  for (const entity of dungeon.entities) {
    if (entity.type !== 'creature') continue;
    if (encounter?.findParticipant(entity.id)) continue; // already in this fight
    // Discovery (fog of war) stays scoped to what the moving player themself can actually see.
    const dist = Math.max(Math.abs(gx - entity.x), Math.abs(gy - entity.y));
    const seen = dist <= PLAYER_SIGHT_RADIUS && hasLineOfSight(dungeon.cells, gx, gy, entity.x, entity.y, blocked);
    if (!entity.discovered && seen) { entity.discovered = true; changed = true; }

    const aggroed = aggroSources.some(pos =>
      Math.max(Math.abs(pos.gx - entity.x), Math.abs(pos.gy - entity.y)) <= ENEMY_AGGRO_RADIUS &&
      hasLineOfSight(dungeon.cells, pos.gx, pos.gy, entity.x, entity.y, blocked));
    if (aggroed) aggro.push(entity);
  }

  if (changed) {
    void saveDungeon(cid, dungeon);
    io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  }
  if (!aggro.length) return;
  if (inCombat) joinReinforcements(cid, aggro);
  else await startDungeonCombat(cid, aggro);
}

// Perception/Investigation checks compare against hideDC for undiscovered loot/traps within sight,
// and against hidden dressing in the room the searcher is standing in.
// Returns what this roll resolved so the caller can narrate it deterministically (see
// narrateEvents.templateSearchResult): a non-empty array of finds, an EMPTY array when a hideDC was
// in play but the roll came up short (a real, templatable miss), or null when nothing
// dungeon-related was in range to resolve against at all — that last case means this roll wasn't a
// dungeon search, so the caller should fall through to the narrator instead of templating.
export async function checkDungeonHiddenReveal(cid: string, characterName: string, total: number): Promise<SearchFind[] | null> {
  const dungeon = dungeons.get(cid);
  const pos = tokenPositions.get(cid)?.[characterName];
  if (!dungeon || !pos) return null;

  let changed = false;
  const found: SearchFind[] = [];
  let nearbyUncleared = false;
  // Scoped to the room the searcher is standing in — not sight radius/LOS across the whole map,
  // which let a search in one room turn up loot sitting in a room two doors down whenever the
  // corridor between them happened to have clear line of sight.
  const playerRoom = roomAt(dungeon, pos.gx, pos.gy);
  const blocked = closedDoorCells(dungeon);
  for (const entity of dungeon.entities) {
    if (entity.type === 'creature' || entity.discovered || entity.hideDC === undefined) continue;
    const inRange = playerRoom
      ? roomAt(dungeon, entity.x, entity.y)?.id === playerRoom.id
      : Math.max(Math.abs(pos.gx - entity.x), Math.abs(pos.gy - entity.y)) <= 2 && hasLineOfSight(dungeon.cells, pos.gx, pos.gy, entity.x, entity.y, blocked);
    if (!inRange) continue;
    if (total < entity.hideDC) { nearbyUncleared = true; continue; }
    entity.discovered = true;
    changed = true;
    found.push(entity);
    console.log(`[dungeon] ${characterName} notices ${entity.name}`);
  }

  // Hidden dressing is text-only — no coordinates, no sprite — so it resolves against the room the
  // searcher occupies rather than sight radius/line of sight the way placed entities do.
  for (const hd of playerRoom?.hiddenDressing ?? []) {
    if (hd.discovered) continue;
    if (total < hd.hideDC) { nearbyUncleared = true; continue; }
    hd.discovered = true;
    changed = true;
    found.push(hd);
    console.log(`[dungeon] ${characterName} notices: ${hd.text}`);
  }

  if (changed) {
    void saveDungeon(cid, dungeon);
    io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  }
  if (!found.length && !nearbyUncleared) return null;
  return found;
}

// Player-clicked open/closed toggle — a no-op (not an error) if the door doesn't exist, is
// locked (no unlock mechanic exists yet — see DungeonEntity.doorState's doc), or the requester
// isn't within 5ft of any cell the door occupies. Authority lives here, not on the client: the
// click only sends intent, this decides whether it actually happens.
export async function toggleDoor(cid: string, doorId: string, characterName: string): Promise<void> {
  const dungeon = dungeons.get(cid);
  const door = dungeon?.entities.find(e => e.id === doorId && e.type === 'door');
  if (!dungeon || !door || door.doorState === 'locked') return;

  const pos = tokenPositions.get(cid)?.[characterName];
  if (!pos) return;
  const w = door.width ?? 1, h = door.height ?? 1;
  const dx = Math.max(door.x - pos.gx, 0, pos.gx - (door.x + w - 1));
  const dy = Math.max(door.y - pos.gy, 0, pos.gy - (door.y + h - 1));
  if (Math.max(dx, dy) * 5 > 5) return;

  door.doorState = door.doorState === 'open' ? 'closed' : 'open';
  console.log(`[dungeon] ${characterName} ${door.doorState === 'open' ? 'opens' : 'closes'} a door`);
  await saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
}

export async function generateAndBroadcastEnemies(campaignId: string, combatants: string[] = []): Promise<void> {
  try {
    io.to(ROOM).emit('encounter:generating');
    const config = await getConfig();
    if (!hasFeatureProvider(config, 'encounterGeneration')) console.warn('[encounter] no combat models configured, using fallback');
    const adapter = getFeatureProvider(config, 'encounterGeneration');

    const [messages, characters, nemeses, manifest] = await Promise.all([
      readChatLog(campaignId),
      listCharacters(campaignId),
      readNemeses(campaignId),
      readManifest(campaignId),
    ]);

    const sessionsPlayed = manifest?.sessionsPlayed ?? 0;
    const characterNames = characters.map(c => c.name);
    const availableNemeses = nemeses.filter(n =>
      n.status === 'active' &&
      n.cooldownUntilSession <= sessionsPlayed &&
      (n.boundTo === 'party' || characterNames.includes(n.boundTo))
    );

    const statBlocks = await generateEncounterEnemies(messages, characters, adapter, availableNemeses, combatants);

    const encounter = encounters.get(campaignId);
    if (!encounter) return;

    let enemyTeam = encounter.teams.find(t => t.name === 'Enemies');
    if (!enemyTeam) {
      enemyTeam = new Team('enemies', 'Enemies');
      encounter.addTeam(enemyTeam);
    }

    // Assign a fresh UUID per combat slot so duplicate-name enemies have unique IDs
    const uniqueStatBlocks = statBlocks.map(sb => ({ ...sb, id: randomUUID() }));

    for (const sb of uniqueStatBlocks) {
      const creature = Creature.from(sb);
      enemyTeam.addParticipant(new Participant({
        id: creature.id,
        name: creature.name,
        initiative: 0,
        isPlayer: false,
        teamId: 'enemies',
        creature,
      }));
    }

    encounter.expectedParticipantCount += uniqueStatBlocks.length;
    await saveEncounter(campaignId, encounter);
    io.to(ROOM).emit('encounter:ready', uniqueStatBlocks);
    console.log('[encounter] ready:', statBlocks.map(e => `${e.name} (CR ${e.cr})`).join(', '));

    // World-map combat (no dungeon already loaded — the only case that reaches this function at
    // all now that combat_init is hard-blocked while a real dungeon exists): spawn a bare
    // combat-arena dungeon instead of an AI backdrop image — same rendering/fog/movement path as
    // any other dungeon, discarded on victory.
    if (!dungeons.has(campaignId)) {
      const dungeon = generateEncounterDungeon(uniqueStatBlocks);
      dungeon.arena = true;
      dungeons.set(campaignId, dungeon);
      microDungeons.add(campaignId);
      await saveDungeon(campaignId, dungeon);
      io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(campaignId, dungeon)));

      const positions = tokenPositions.get(campaignId) ?? {};
      for (const entity of dungeon.entities) {
        positions[entity.id] = { gx: entity.x, gy: entity.y };
        io.to(ROOM).emit('token:moved', { tokenId: entity.id, gx: entity.x, gy: entity.y });
      }
      tokenPositions.set(campaignId, positions);
    }

    if (combatState.get(campaignId)) rollEnemyInitiatives(campaignId);
  } catch (err) {
    logError('index:generateAndBroadcastEnemies', err);
  }
}

// Starts combat straight from dungeon-placed creatures (their stat blocks were already generated
// at dungeon-gen time) — same shape as combat_init/generateAndBroadcastEnemies, minus the LLM calls
// and map regeneration, since the dungeon map stays as-is.
export async function startDungeonCombat(cid: string, triggerEntities: DungeonEntity[]): Promise<void> {
  if (combatState.get(cid)) return;
  combatState.set(cid, true);
  enemiesReady.set(cid, false);
  combatStartedAt.set(cid, Date.now());
  encounters.set(cid, Encounter.empty(cid));
  io.to(ROOM).emit('combat:state', true);

  void listCharacters(cid).then(chars => rollPlayerInitiatives(cid, chars));

  const encounter = encounters.get(cid)!;
  const enemyTeam = new Team('enemies', 'Enemies');
  encounter.addTeam(enemyTeam);

  // id = the originating DungeonEntity's id, not a fresh one — keeps the combat participant and the
  // dungeon entity as the same row, so a post-combat victory can trace kills back to remove them.
  const triggered = triggerEntities.filter((e): e is DungeonEntity & { statBlock: EnemyStatBlock } => !!e.statBlock);
  const uniqueStatBlocks = triggered.map(e => ({ ...e.statBlock, id: e.id }));

  for (const sb of uniqueStatBlocks) {
    const creature = Creature.from(sb);
    enemyTeam.addParticipant(new Participant({
      id: creature.id,
      name: creature.name,
      initiative: 0,
      isPlayer: false,
      teamId: 'enemies',
      creature,
    }));
  }

  encounter.expectedParticipantCount += uniqueStatBlocks.length;
  await saveEncounter(cid, encounter);
  io.to(ROOM).emit('encounter:ready', uniqueStatBlocks);
  console.log('[dungeon] combat triggered:', uniqueStatBlocks.map(e => `${e.name} (CR ${e.cr})`).join(', '));

  const positions = tokenPositions.get(cid) ?? {};
  for (const e of triggered) {
    positions[e.id] = { gx: e.x, gy: e.y };
    io.to(ROOM).emit('token:moved', { tokenId: e.id, gx: e.x, gy: e.y });
  }
  tokenPositions.set(cid, positions);

  rollEnemyInitiatives(cid);
}

// Mid-fight version of startDungeonCombat: splices newly-aggro'd creatures into the running
// encounter — rolls initiative, doesn't touch whose turn it currently is (addToTurnOrder re-anchors
// the current actor), and re-broadcasts the full enemy list so their tokens render.
export function joinReinforcements(cid: string, triggerEntities: DungeonEntity[]): void {
  const encounter = encounters.get(cid);
  if (!encounter) { logDebug('joinReinforcements BLOCKED — no live encounter'); return; }

  const joined = triggerEntities.filter((e): e is DungeonEntity & { statBlock: EnemyStatBlock } => !!e.statBlock);
  const entries = joined.map(e => encounter.spawnEnemy({ ...e.statBlock, id: e.id }));

  addToTurnOrder(cid, entries);

  io.to(ROOM).emit('encounter:ready', encounter.enemies.filter(p => p.creature).map(p => p.creature!.toStatBlock()));

  const positions = tokenPositions.get(cid) ?? {};
  for (const e of joined) {
    positions[e.id] = { gx: e.x, gy: e.y };
    io.to(ROOM).emit('token:moved', { tokenId: e.id, gx: e.x, gy: e.y });
  }
  tokenPositions.set(cid, positions);

  for (const name of joined.map(e => e.name)) {
    const joinMsg = { text: `${name} joins the fight!`, senderName: 'Combat', timestamp: Date.now() };
    io.to(ROOM).emit('chat:message', joinMsg);
    void appendChatLog(cid, joinMsg);
  }
}

// Posts the room's stored facts — pre-generated description, ambient dressing, anything already
// discovered inside it — to the journal the instant a party first steps into it. No LLM call on
// this path, so there's no wait, and nothing is invented (see narrateEvents.templateRoomEntry).
// Rooms carrying none of the three (e.g. the hand-authored GENERIC_ROOMS fallback) stay silent
// rather than posting filler. room.visited (set in checkDungeonProximity) is what keeps this to
// once per room. senderName is 'Virtual DM' so the line lands as an assistant turn in the LLM's
// chat history rather than being replayed back to it as if a player had said it.
dungeonEvents.on('room_entered', ({ cid, room }) => {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const text = templateRoomEntry(dungeon, room);
  if (!text) return;
  const msg = { text, senderName: 'Virtual DM', timestamp: Date.now() };
  io.to(ROOM).emit('chat:message', msg);
  void appendChatLog(cid, msg);
});
