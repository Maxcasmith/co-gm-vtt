import type { DungeonEntity, EnemyStatBlock } from 'shared';
import { hasLineOfSight, closedDoorCells, statMod } from 'shared';
import { randomUUID } from 'crypto';
import { saveDungeon, saveEncounter, getConfig, readChatLog, listCharacters, getCharacter, readNemeses, readManifest, appendChatLog } from '../storage.ts';
import { D20Roll } from '../combat/dice.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateEncounterEnemies } from '../session-processor/imagePrompts.ts';
import { generateEncounterDungeon, toClientDungeon, roomAt } from './index.ts';
import { templateRoomEntry, type SearchFind } from './narrateEvents.ts';
import { dungeonEvents } from './events.ts';
import { Encounter, Team, Participant } from '../domain/encounter.ts';
import { Creature } from '../domain/creature.ts';
import { logError, logDebug } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, dungeons, microDungeons, withLivePositions, PLAYER_SIGHT_RADIUS, ENEMY_AGGRO_RADIUS, enemiesReady, combatStartedAt } from '../state.ts';
import { addToTurnOrder, rollPlayerInitiatives, rollEnemyInitiatives } from '../combat/runtime/lifecycle.ts';
import { checkTrapAt } from '../combat/runtime/traps.ts';
import { checkQuestChainTriggers } from './questChain.ts';

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
    void checkQuestChainTriggers(cid, { kind: 'enter_room', roomName: room.name });
  }

  await checkTrapAt(cid, gx, gy, characterName, characterName, true);

  for (const entity of dungeon.entities) {
    if (entity.type !== 'creature') continue;
    if (encounter?.findParticipant(entity.id)) continue; // already in this fight
    // Discovery (fog of war) stays scoped to what the moving player themself can actually see.
    const dist = Math.max(Math.abs(gx - entity.x), Math.abs(gy - entity.y));
    const seen = dist <= PLAYER_SIGHT_RADIUS && hasLineOfSight(dungeon.cells, gx, gy, entity.x, entity.y, blocked);
    if (!entity.discovered && seen) {
      entity.discovered = true;
      changed = true;
      void checkQuestChainTriggers(cid, { kind: 'discover_entity', entityName: entity.name });
    }

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
    void checkQuestChainTriggers(cid, { kind: 'discover_entity', entityName: entity.name });
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

// Chebyshev distance in feet from a character's cell to the nearest cell a door/stairs/entity
// occupies — shared by toggleDoor's/useStairs' click gate and the narrated door_unlock effect's
// proximity check.
function feetToEntity(pos: { gx: number; gy: number }, door: { x: number; y: number; width?: number; height?: number }): number {
  const w = door.width ?? 1, h = door.height ?? 1;
  const dx = Math.max(door.x - pos.gx, 0, pos.gx - (door.x + w - 1));
  const dy = Math.max(door.y - pos.gy, 0, pos.gy - (door.y + h - 1));
  return Math.max(dx, dy) * 5;
}

// Player-clicked open/closed toggle. A no-op (not an error) if the door doesn't exist or the
// requester isn't within 5ft of any cell the door occupies. For a 'locked' door specifically, a
// click also requires its key (requiresKeyId) to already be discovered — no key found yet means
// this is still a dead end; the door unlocks AND opens in this one click once it is (see
// DungeonEntity.doorState's doc — narrating the key/a successful lockpick instead goes through
// [[DOOR_UNLOCK]], see effects.ts). Authority lives here, not on the client: the click only sends
// intent, this decides whether it actually happens.
export async function toggleDoor(cid: string, doorId: string, characterName: string): Promise<void> {
  const dungeon = dungeons.get(cid);
  const door = dungeon?.entities.find(e => e.id === doorId && e.type === 'door');
  if (!dungeon || !door) return;

  const pos = tokenPositions.get(cid)?.[characterName];
  if (!pos || feetToEntity(pos, door) > 5) return;

  if (door.doorState === 'locked') {
    const key = door.requiresKeyId ? dungeon.entities.find(e => e.id === door.requiresKeyId) : undefined;
    if (!key?.discovered) return;
    door.doorState = 'open';
    console.log(`[dungeon] ${characterName} unlocks and opens a door with ${key.name}`);
  } else {
    door.doorState = door.doorState === 'open' ? 'closed' : 'open';
    console.log(`[dungeon] ${characterName} ${door.doorState === 'open' ? 'opens' : 'closes'} a door`);
  }
  await saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  // Opening a door can put a creature on the other side within sight/aggro range for the first
  // time — without this, it stayed hidden until the opener's next token:move re-ran this scan,
  // reading as the creature "spawning" a beat late rather than being revealed the instant the
  // door swings open.
  if (door.doorState === 'open') await checkDungeonProximity(cid, pos.gx, pos.gy, characterName);
}

// Player-clicked stairs — warps the clicker straight to the paired stairs entity's coordinates.
// No lock/key concept (unlike toggleDoor), no state to persist on the dungeon itself (unlike a
// door's open/closed) — this only moves tokenPositions, same shape as a normal token:move, not a
// dungeon mutation. Works regardless of turn/combat state, same precedent as toggleDoor (an
// environment interaction, not an action-economy one) — not gated by canMove.
export async function useStairs(cid: string, stairsId: string, characterName: string): Promise<void> {
  const dungeon = dungeons.get(cid);
  const stairs = dungeon?.entities.find(e => e.id === stairsId && e.type === 'stairs');
  const target = stairs?.linkTo ? dungeon?.entities.find(e => e.id === stairs.linkTo && e.type === 'stairs') : undefined;
  if (!dungeon || !stairs || !target) return;

  const pos = tokenPositions.get(cid)?.[characterName];
  if (!pos || feetToEntity(pos, stairs) > 5) return;

  const positions = tokenPositions.get(cid) ?? {};
  positions[characterName] = { gx: target.x, gy: target.y };
  tokenPositions.set(cid, positions);
  io.to(ROOM).emit('token:moved', { tokenId: characterName, gx: target.x, gy: target.y });
  console.log(`[dungeon] ${characterName} takes the stairs`);
  // Handles room-visited/quest-trigger/trap-check/aggro on landing — same post-move checks a
  // normal token:move gets (see socketHandlers/combat.ts), just triggered by a teleport instead.
  await checkDungeonProximity(cid, target.x, target.y, characterName);
}

// Narrated unlock ("I use the key", "I pick the lock") — the DM tags [[DOOR_UNLOCK:PlayerName]]
// once its narration establishes the door opened, whether via the key or a successful Thieves'
// Tools check against the door's (DM-eyes-only) lockpickDC. Unlike toggleDoor's click path, this
// doesn't re-check key discovery or compare a roll against lockpickDC itself — same trust model
// already used for a seal trap's escapeDC (resolved by the DM's own judgment, never re-verified in
// code) — proximity is the only thing enforced server-side. No-op if nothing locked is in range.
export async function unlockDoorNear(cid: string, characterName: string): Promise<void> {
  const dungeon = dungeons.get(cid);
  const pos = tokenPositions.get(cid)?.[characterName];
  if (!dungeon || !pos) return;

  const door = dungeon.entities.find(e => e.type === 'door' && e.doorState === 'locked' && feetToEntity(pos, e) <= 5);
  if (!door) return;

  door.doorState = 'open';
  console.log(`[dungeon] ${characterName} narrates a door unlocked`);
  await saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  await checkDungeonProximity(cid, pos.gx, pos.gy, characterName);
}

// A consumable Lockpick's whole job — unlike unlockDoorNear (the key/narration path, AI-trusted,
// no roll), this always rolls a real DEX check (labeled Thieves' Tools; no tool-proficiency bonus
// is modeled — this codebase has no tool-proficiency concept on Character at all) against the
// nearest locked door's lockpickDC. Shared by both the inventory-click path (socketHandlers/
// inventory.ts's consumable:lockpick) and the narrated path ([[ITEM_USED]], see effects.ts) — the
// item itself is consumed by the caller either way, this only resolves what the roll does.
export async function resolveLockpickAttempt(cid: string, characterId: string, characterName: string): Promise<void> {
  const char = await getCharacter(cid, characterId);
  const dungeon = dungeons.get(cid);
  const pos = tokenPositions.get(cid)?.[characterName];
  if (!char || !dungeon || !pos) return;

  const d20 = new D20Roll().roll();
  const total = d20 + statMod(char.stats.dex);
  await appendChatLogAndBroadcast(cid, `${characterName} rolls Thieves' Tools (DEX) to pick a lock: ${total}.`);

  const door = dungeon.entities.find(e => e.type === 'door' && e.doorState === 'locked' && feetToEntity(pos, e) <= 5);
  if (!door) {
    await appendChatLogAndBroadcast(cid, `${characterName} has no locked door within reach.`);
    return;
  }
  if (total < (door.lockpickDC ?? 15)) {
    await appendChatLogAndBroadcast(cid, `${characterName} fails to pick the lock.`);
    return;
  }
  door.doorState = 'open';
  await saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  await checkDungeonProximity(cid, pos.gx, pos.gy, characterName);
  await appendChatLogAndBroadcast(cid, `${characterName} picks the lock — the door swings open.`);
}

// A consumable Trap Disarm Kit's whole job — same DEX-check convention as resolveLockpickAttempt,
// rolled against the nearest DISCOVERED trap's disarmDC (an undiscovered trap can't be targeted —
// you have to have found it first). Success removes the trap entity outright, same end state as
// it triggering, just without the consequence. Shared by the click and narrated paths.
export async function resolveTrapDisarmAttempt(cid: string, characterId: string, characterName: string): Promise<void> {
  const char = await getCharacter(cid, characterId);
  const dungeon = dungeons.get(cid);
  const pos = tokenPositions.get(cid)?.[characterName];
  if (!char || !dungeon || !pos) return;

  const d20 = new D20Roll().roll();
  const total = d20 + statMod(char.stats.dex);
  await appendChatLogAndBroadcast(cid, `${characterName} rolls Thieves' Tools (DEX) to disarm a trap: ${total}.`);

  const trap = dungeon.entities.find(e => e.type === 'trap' && e.discovered && feetToEntity(pos, e) <= 5);
  if (!trap) {
    await appendChatLogAndBroadcast(cid, `${characterName} has no discovered trap within reach.`);
    return;
  }
  if (total < (trap.trap?.disarmDC ?? 13)) {
    await appendChatLogAndBroadcast(cid, `${characterName} fails to disarm the trap.`);
    return;
  }
  dungeon.entities = dungeon.entities.filter(e => e.id !== trap.id);
  await saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  await appendChatLogAndBroadcast(cid, `${characterName} disarms the trap safely.`);
}

async function appendChatLogAndBroadcast(cid: string, text: string): Promise<void> {
  const msg = { text, senderName: 'System', timestamp: Date.now() };
  await appendChatLog(cid, msg);
  io.to(ROOM).emit('chat:message', msg);
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
