import type { Dungeon, DungeonEntity, EnemyStatBlock, RollBreakdown } from 'shared';
import { hasLineOfSight, closedDoorCells } from 'shared';
import { randomUUID } from 'crypto';
import { saveDungeon, saveEncounter, getConfig, listCharacters, getCharacter, readNemeses, readManifest, getWorldMeta } from '../storage.ts';
import { rollD20, withModifiers, dexLine } from '../combat/dice.ts';
import { conditionModeSources } from '../combat/conditions/rollModeFor.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateEncounterEnemies, assignCombatTeams, DEFAULT_ENEMY_SIDE, type CombatSide } from '../session-processor/imagePrompts.ts';
import { generateEncounterDungeon, placeArenaEnemies, applyArenaTerrain, roomAt, chainClosure } from './index.ts';
import { assignPortraitSrcs, generateCreaturePortraits } from './creaturePortraits.ts';
import { templateRoomEntry, type SearchFind } from './narrateEvents.ts';
import { dungeonEvents } from './events.ts';
import { Encounter, Participant, PLAYERS_TEAM_ID } from '../domain/encounter.ts';
import { Creature } from '../domain/creature.ts';
import { logError } from '../logger.ts';
import { io, campaignRoom, positionsOf, dungeonOf, fightDungeon, registerDungeon, toDungeon, PLAYER_SIGHT_RADIUS, ENEMY_AGGRO_RADIUS, COMBAT_CHAIN_RADIUS, campaignPlayers, connected, fightOf, registerFight, toFight, toDungeonOf, markFightGenerating } from '../state.ts';
import { addToTurnOrder, rollPlayerInitiatives, rollEnemyInitiatives, resolveFightChains, syncFight } from '../combat/runtime/lifecycle.ts';
import { checkTrapAt } from '../combat/runtime/traps.ts';
import { checkQuestChainTriggers } from './questChain.ts';
import { postChat, readChatContext } from '../partyGroups.ts';
import { broadcastDungeon } from '../dungeon/index.ts';

// Live cell positions of every participant currently in the fight — players keyed by name,
// everyone else (creatures, allies) keyed by id, matching Dungeon.positions' own convention.
function combatantPositions(cid: string, encounter: Encounter): { gx: number; gy: number }[] {
  const positions = fightDungeon(cid, encounter)?.positions ?? {};
  return encounter.turnOrder
    .map(p => positions[p.isPlayer ? p.name : p.id])
    .filter((pos): pos is { gx: number; gy: number } => !!pos);
}

// Runs on every player token move while a dungeon is loaded: reveals creatures within sight,
// fires room_entered the first time a room is stepped into, merges/joins fights by the chain rule,
// and either starts a new fight (the mover isn't in one — even if another group is fighting
// elsewhere) or pulls newly-aggro'd creatures into the mover's own fight when one comes within
// aggro radius of ANY of its live combatants — not just the player who moved, so a creature lurking
// near an already-engaged ally or enemy still gets pulled in even though it's out of range of
// whoever happened to trigger this check.
export async function checkDungeonProximity(cid: string, gx: number, gy: number, characterName: string): Promise<void> {
  const dungeon = dungeonOf(cid, characterName);
  if (!dungeon) return;
  // Chain first: stepping within range of a fight joins it, rather than starting a second one beside it.
  await resolveFightChains(cid);
  const encounter = fightOf(cid, characterName);
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
    void checkQuestChainTriggers(cid, { kind: 'enter_room', roomName: room.name }, dungeon);
  }

  await checkTrapAt(cid, gx, gy, characterName, characterName, true);

  for (const entity of dungeon.entities) {
    if (entity.type !== 'creature') continue;
    if (fightOf(cid, entity.id)) continue; // already in a fight — this one or another group's
    // Discovery (fog of war) stays scoped to what the moving player themself can actually see.
    const dist = Math.max(Math.abs(gx - entity.x), Math.abs(gy - entity.y));
    const seen = dist <= PLAYER_SIGHT_RADIUS && hasLineOfSight(dungeon.cells, gx, gy, entity.x, entity.y, blocked);
    if (!entity.discovered && seen) {
      entity.discovered = true;
      changed = true;
      void checkQuestChainTriggers(cid, { kind: 'discover_entity', entityName: entity.name }, dungeon);
    }

    const aggroed = aggroSources.some(pos =>
      Math.max(Math.abs(pos.gx - entity.x), Math.abs(pos.gy - entity.y)) <= ENEMY_AGGRO_RADIUS &&
      hasLineOfSight(dungeon.cells, pos.gx, pos.gy, entity.x, entity.y, blocked));
    if (aggroed) aggro.push(entity);
  }

  if (changed) {
    void saveDungeon(cid, dungeon);
    broadcastDungeon(cid, dungeon);
  }
  if (!aggro.length) return;
  if (encounter) joinReinforcements(cid, encounter, aggro);
  else await startDungeonCombat(cid, aggro, characterName);
}

/** Opens an empty combat arena for an open-world fight and puts it on its players' screens right
 * away — the enemies themselves take a model call, and until step 15 the map only appeared once
 * that returned, leaving players in combat mode staring at the map they'd just left. */
export function openArena(cid: string, fight: Encounter): Dungeon {
  const arena = generateEncounterDungeon();
  arena.arena = true;
  // The fight owns its arena — its players stand in it (locationOf) until it's discarded on
  // victory, so two groups can each have their own open-world fight at once.
  fight.arenaId = arena.id;
  registerDungeon(cid, arena);
  void saveDungeon(cid, arena);
  broadcastDungeon(cid, arena);
  return arena;
}

/** LLM side assignment for creatures joining `fight` (see assignCombatTeams), then applied —
 * they joined on the default side synchronously; this re-homes them once the model answers. */
async function assignSides(cid: string, fight: Encounter, joining: EnemyStatBlock[], contextFor: string[]): Promise<void> {
  const joiningIds = new Set(joining.map(sb => sb.id));
  const existing = fight.teams
    .filter(t => t.id !== PLAYERS_TEAM_ID)
    .map(t => ({ side: { id: t.id, name: t.name } as CombatSide, members: t.participants.filter(p => !joiningIds.has(p.id)).map(p => p.name) }))
    .filter(e => e.members.length);
  const [config, recent] = await Promise.all([getConfig(), readChatContext(cid, contextFor)]);
  const adapter = hasFeatureProvider(config, 'encounterGeneration') ? getFeatureProvider(config, 'encounterGeneration') : undefined;
  const sides = await assignCombatTeams(joining, existing, recent.slice(-6).map(m => `[${m.senderName}]: ${m.text}`).join('\n'), adapter);
  if (fight.ended) return;
  for (const [id, side] of Object.entries(sides)) {
    const p = fight.findParticipant(id);
    if (p) fight.moveToTeam(p, side);
  }
  const sideNames = [...new Set(Object.values(sides).map(sd => sd.name))];
  if (sideNames.length > 1) console.log(`[combat] sides: ${sideNames.join(' vs ')}`);
  void saveEncounter(cid, fight);
}

// Perception/Investigation checks compare against hideDC for undiscovered loot/traps within sight,
// and against hidden dressing in the room the searcher is standing in.
// Returns what this roll resolved so the caller can narrate it deterministically (see
// narrateEvents.templateSearchResult): a non-empty array of finds, an EMPTY array when a hideDC was
// in play but the roll came up short (a real, templatable miss), or null when nothing
// dungeon-related was in range to resolve against at all — that last case means this roll wasn't a
// dungeon search, so the caller should fall through to the narrator instead of templating.
export async function checkDungeonHiddenReveal(cid: string, characterName: string, total: number): Promise<SearchFind[] | null> {
  const dungeon = dungeonOf(cid, characterName);
  const pos = dungeon?.positions?.[characterName];
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
    void checkQuestChainTriggers(cid, { kind: 'discover_entity', entityName: entity.name }, dungeon);
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
    broadcastDungeon(cid, dungeon);
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
  const dungeon = dungeonOf(cid, characterName);
  const door = dungeon?.entities.find(e => e.id === doorId && e.type === 'door');
  if (!dungeon || !door) return;

  const pos = dungeon.positions?.[characterName];
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
  broadcastDungeon(cid, dungeon);
  // Opening a door can put a creature on the other side within sight/aggro range for the first
  // time — without this, it stayed hidden until the opener's next token:move re-ran this scan,
  // reading as the creature "spawning" a beat late rather than being revealed the instant the
  // door swings open.
  if (door.doorState === 'open') await checkDungeonProximity(cid, pos.gx, pos.gy, characterName);
}

// Player-clicked stairs — warps the clicker straight to the paired stairs entity's coordinates.
// No lock/key concept (unlike toggleDoor), no state to persist on the dungeon itself (unlike a
// door's open/closed) — this only moves the dungeon's own positions, same shape as a normal token:move, not a
// dungeon mutation. Works regardless of turn/combat state, same precedent as toggleDoor (an
// environment interaction, not an action-economy one) — not gated by canMove.
export async function useStairs(cid: string, stairsId: string, characterName: string): Promise<void> {
  const dungeon = dungeonOf(cid, characterName);
  const stairs = dungeon?.entities.find(e => e.id === stairsId && e.type === 'stairs');
  const target = stairs?.linkTo ? dungeon?.entities.find(e => e.id === stairs.linkTo && e.type === 'stairs') : undefined;
  if (!dungeon || !stairs || !target) return;

  const pos = dungeon.positions?.[characterName];
  if (!pos || feetToEntity(pos, stairs) > 5) return;

  const positions = dungeon.positions ??= {};
  positions[characterName] = { gx: target.x, gy: target.y };
  toDungeonOf(cid, characterName).emit('token:moved', { tokenId: characterName, gx: target.x, gy: target.y });
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
  const dungeon = dungeonOf(cid, characterName);
  const pos = dungeon?.positions?.[characterName];
  if (!dungeon || !pos) return;

  const door = dungeon.entities.find(e => e.type === 'door' && e.doorState === 'locked' && feetToEntity(pos, e) <= 5);
  if (!door) return;

  door.doorState = 'open';
  console.log(`[dungeon] ${characterName} narrates a door unlocked`);
  await saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);
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
  const dungeon = dungeonOf(cid, characterName);
  const pos = dungeon?.positions?.[characterName];
  if (!char || !dungeon || !pos) return;

  // Thieves' Tools is a DEX check — conditions affecting checks (Poisoned) apply; no tool proficiency is modeled.
  const breakdown = withModifiers(rollD20(conditionModeSources(char, 'check', 'dex')), [dexLine(char.stats)]);
  const { total } = breakdown;
  await appendChatLogAndBroadcast(cid, characterName, `${characterName} rolls Thieves' Tools (DEX) to pick a lock: ${total}.`, breakdown);

  const door = dungeon.entities.find(e => e.type === 'door' && e.doorState === 'locked' && feetToEntity(pos, e) <= 5);
  if (!door) {
    await appendChatLogAndBroadcast(cid, characterName, `${characterName} has no locked door within reach.`);
    return;
  }
  if (total < (door.lockpickDC ?? 15)) {
    await appendChatLogAndBroadcast(cid, characterName, `${characterName} fails to pick the lock.`);
    return;
  }
  door.doorState = 'open';
  await saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);
  await checkDungeonProximity(cid, pos.gx, pos.gy, characterName);
  await appendChatLogAndBroadcast(cid, characterName, `${characterName} picks the lock — the door swings open.`);
}

// A consumable Trap Disarm Kit's whole job — same DEX-check convention as resolveLockpickAttempt,
// rolled against the nearest DISCOVERED trap's disarmDC (an undiscovered trap can't be targeted —
// you have to have found it first). Success removes the trap entity outright, same end state as
// it triggering, just without the consequence. Shared by the click and narrated paths.
export async function resolveTrapDisarmAttempt(cid: string, characterId: string, characterName: string): Promise<void> {
  const char = await getCharacter(cid, characterId);
  const dungeon = dungeonOf(cid, characterName);
  const pos = dungeon?.positions?.[characterName];
  if (!char || !dungeon || !pos) return;

  const breakdown = withModifiers(rollD20(conditionModeSources(char, 'check', 'dex')), [dexLine(char.stats)]);
  const { total } = breakdown;
  await appendChatLogAndBroadcast(cid, characterName, `${characterName} rolls Thieves' Tools (DEX) to disarm a trap: ${total}.`, breakdown);

  const trap = dungeon.entities.find(e => e.type === 'trap' && e.discovered && feetToEntity(pos, e) <= 5);
  if (!trap) {
    await appendChatLogAndBroadcast(cid, characterName, `${characterName} has no discovered trap within reach.`);
    return;
  }
  if (total < (trap.trap?.disarmDC ?? 13)) {
    await appendChatLogAndBroadcast(cid, characterName, `${characterName} fails to disarm the trap.`);
    return;
  }
  dungeon.entities = dungeon.entities.filter(e => e.id !== trap.id);
  await saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);
  await appendChatLogAndBroadcast(cid, characterName, `${characterName} disarms the trap safely.`);
}

async function appendChatLogAndBroadcast(cid: string, characterName: string, text: string, breakdown?: RollBreakdown): Promise<void> {
  await postChat(cid, { text, senderName: 'System', timestamp: Date.now(), breakdown }, [characterName]);
}

/** World-map combat (DM's COMBAT_INIT): generates the enemies for `encounter`, whose players are already in it. */
export async function generateAndBroadcastEnemies(campaignId: string, encounter: Encounter, combatants: string[] = []): Promise<void> {
  try {
    // cid passed deliberately: at this point players are still pending (initiative hasn't rolled),
    // and without it this event — the one the loading screen waits on — reaches nobody.
    toFight(encounter, campaignId).emit('encounter:generating');
    markFightGenerating(encounter.id, true);
    const config = await getConfig();
    if (!hasFeatureProvider(config, 'encounterGeneration')) console.warn('[encounter] no combat models configured, using fallback');
    const adapter = getFeatureProvider(config, 'encounterGeneration');

    const [messages, characters, nemeses, manifest] = await Promise.all([
      readChatContext(campaignId, encounter.players.map(p => p.id)),
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

    const worldMeta = await getWorldMeta(campaignId);
    const { enemies: statBlocks, terrain } = await generateEncounterEnemies(messages, characters, adapter, availableNemeses, combatants, worldMeta?.genre);

    // The fight was resolved while the model was still thinking. endCombat's own combat:state:false
    // normally brings the loading screen down, but emit the explicit release too rather than
    // depending on that ordering — this is the one path where nobody is left to send anything else.
    if (encounter.ended) { toFight(encounter, campaignId).emit('encounter:failed'); return; }

    // Assign a fresh UUID per combat slot so duplicate-name enemies have unique IDs
    const uniqueStatBlocks = statBlocks.map(sb => ({ ...sb, id: randomUUID() }));

    const enemyTeam = encounter.team(DEFAULT_ENEMY_SIDE.id, DEFAULT_ENEMY_SIDE.name);
    for (const sb of uniqueStatBlocks) {
      const creature = Creature.from(sb);
      enemyTeam.addParticipant(new Participant({
        id: creature.id,
        name: creature.name,
        initiative: 0,
        isPlayer: false,
        teamId: DEFAULT_ENEMY_SIDE.id,
        creature,
      }));
    }
    await assignSides(campaignId, encounter, uniqueStatBlocks, encounter.players.map(p => p.id));

    encounter.expectedParticipantCount += uniqueStatBlocks.length;
    await saveEncounter(campaignId, encounter);

    // The arena was put on screen the moment the fight started (see openArena) — the enemies just
    // took a model call to arrive. Place them on it now. A fight with no arena at all (shouldn't
    // happen) gets one here rather than being left mapless.
    const arena = fightDungeon(campaignId, encounter) ?? openArena(campaignId, encounter);
    if (arena.arena) {
      for (const entity of placeArenaEnemies(arena, uniqueStatBlocks)) {
        toDungeonOf(campaignId, entity.id).emit('token:moved', { tokenId: entity.id, gx: entity.x, gy: entity.y });
      }
      // Everything a generated dungeon's rooms and creatures get, the arena gets too — it just
      // gets it here rather than up front, because the map deliberately ships before this model
      // call returns (see openArena). Portraits are assigned synchronously and filled in in the
      // background, same contract as generateDungeon's.
      assignPortraitSrcs(arena.entities);
      void generateCreaturePortraits(arena.entities, config);
      if (terrain) await applyArenaTerrain(arena, terrain, config, worldMeta?.genre);
      await saveDungeon(campaignId, arena);
      broadcastDungeon(campaignId, arena);
    }

    // Emitted LAST, after the arena has its enemies placed and its floor art resolved and has been
    // rebroadcast — this is the event the loading screen comes down on, so anything still missing
    // when it fires is something the party watches pop in on a bare map. It used to fire straight
    // after the stat blocks came back, i.e. before placeArenaEnemies and before applyArenaTerrain
    // had even been called.
    toFight(encounter).emit('encounter:ready', uniqueStatBlocks);
    console.log('[encounter] ready:', statBlocks.map(e => `${e.name} (CR ${e.cr})`).join(', '));

    if (!encounter.ended) rollEnemyInitiatives(campaignId, encounter);
  } catch (err) {
    logError('index:generateAndBroadcastEnemies', err);
    // Releases the loading screen and the input lockout behind it — encounter:ready is never
    // coming. The fight itself stays open (players are already in it); it just has no generated
    // enemies, which the DM can still resolve narratively.
    toFight(encounter, campaignId).emit('encounter:failed');
  } finally {
    // finally, not per-branch: covers the success path, the throw, and the ended-early return, so a
    // reconnecting player is never shown a loading screen for a generation that is already over.
    markFightGenerating(encounter.id, false);
  }
}

// Starts combat straight from dungeon-placed creatures (their stat blocks were already generated
// at dungeon-gen time) — same shape as combat_init/generateAndBroadcastEnemies, minus the LLM calls
// and map regeneration, since the dungeon map stays as-is.
export async function startDungeonCombat(cid: string, triggerEntities: DungeonEntity[], triggeredBy: string): Promise<void> {
  if (fightOf(cid, triggeredBy)) return;
  const fight = Encounter.empty(cid);
  registerFight(cid, fight);

  // Everyone in it is claimed synchronously, before the first await, so a second move racing this
  // one can't start a parallel fight over the same creatures or players.
  // id = the originating DungeonEntity's id, not a fresh one — keeps the combat participant and the
  // dungeon entity as the same row, so a post-combat victory can trace kills back to remove them.
  const triggered = triggerEntities.filter((e): e is DungeonEntity & { statBlock: EnemyStatBlock } => !!e.statBlock && !fightOf(cid, e.id));
  const uniqueStatBlocks = triggered.map(e => ({ ...e.statBlock, id: e.id }));
  const enemyTeam = fight.team(DEFAULT_ENEMY_SIDE.id, DEFAULT_ENEMY_SIDE.name);
  for (const sb of uniqueStatBlocks) {
    const creature = Creature.from(sb);
    enemyTeam.addParticipant(new Participant({
      id: creature.id,
      name: creature.name,
      initiative: 0,
      isPlayer: false,
      teamId: DEFAULT_ENEMY_SIDE.id,
      creature,
    }));
  }
  fight.expectedParticipantCount += uniqueStatBlocks.length;

  // Not everyone online — whoever triggered it, plus anyone not already fighting who's chained to
  // them or to the creatures they aggroed (COMBAT_CHAIN_RADIUS + sight). Everyone else joins later
  // if they close the chain.
  const dungeon = dungeonOf(cid, triggeredBy);
  const livePositions = dungeon?.positions ?? {};
  const seeds = [livePositions[triggeredBy], ...triggered.map(e => ({ gx: e.x, gy: e.y }))].filter((p): p is { gx: number; gy: number } => !!p);
  const candidates = Object.fromEntries((campaignPlayers.get(cid) ?? []).flatMap(name => {
    const pos = livePositions[name];
    return pos && name !== triggeredBy && connected.has(name) && !fightOf(cid, name) ? [[name, pos] as const] : [];
  }));
  const fighters = [triggeredBy, ...(dungeon ? chainClosure(dungeon, seeds, candidates, COMBAT_CHAIN_RADIUS) : Object.keys(candidates))];
  fight.pendingPlayerNames.push(...fighters);

  for (const e of triggered) {
    livePositions[e.id] = { gx: e.x, gy: e.y };
    toDungeonOf(cid, e.id).emit('token:moved', { tokenId: e.id, gx: e.x, gy: e.y });
  }
  console.log('[dungeon] combat triggered:', uniqueStatBlocks.map(e => `${e.name} (CR ${e.cr})`).join(', '), '— fighters:', fighters.join(', '));

  const [chars] = await Promise.all([listCharacters(cid), assignSides(cid, fight, uniqueStatBlocks, fighters)]);
  if (fight.ended) return;
  await rollPlayerInitiatives(cid, fight, chars, fighters);
  syncFight(fight);
  await saveEncounter(cid, fight);
  rollEnemyInitiatives(cid, fight);
}

// Mid-fight version of startDungeonCombat: splices newly-aggro'd creatures into the running
// encounter — rolls initiative, doesn't touch whose turn it currently is (addToTurnOrder re-anchors
// the current actor), and re-broadcasts the full enemy list so their tokens render.
export function joinReinforcements(cid: string, encounter: Encounter, triggerEntities: DungeonEntity[]): void {
  const joined = triggerEntities.filter((e): e is DungeonEntity & { statBlock: EnemyStatBlock } => !!e.statBlock && !fightOf(cid, e.id));
  const statBlocks = joined.map(e => ({ ...e.statBlock, id: e.id }));
  const entries = statBlocks.map(sb => encounter.spawnEnemy(sb));

  addToTurnOrder(cid, encounter, entries);
  // Sides settle a beat later — a newcomer may belong to a side already fighting here, or to a rival one.
  void assignSides(cid, encounter, statBlocks, encounter.players.map(p => p.id));

  toFight(encounter).emit('encounter:ready', encounter.enemies.filter(p => p.creature).map(p => p.creature!.toStatBlock()));

  const positions = fightDungeon(cid, encounter)?.positions ?? {};
  for (const e of joined) {
    positions[e.id] = { gx: e.x, gy: e.y };
    toDungeonOf(cid, e.id).emit('token:moved', { tokenId: e.id, gx: e.x, gy: e.y });
  }

  for (const e of joined) {
    void postChat(cid, { text: `${e.name} joins the fight!`, senderName: 'Combat', timestamp: Date.now() }, [e.id]);
  }
}

// Posts the room's stored facts — pre-generated description, ambient dressing, anything already
// discovered inside it — to the journal the instant a party first steps into it. No LLM call on
// this path, so there's no wait, and nothing is invented (see narrateEvents.templateRoomEntry).
// Rooms carrying none of the three (e.g. the hand-authored GENERIC_ROOMS fallback) stay silent
// rather than posting filler. room.visited (set in checkDungeonProximity) is what keeps this to
// once per room. senderName is 'Virtual DM' so the line lands as an assistant turn in the LLM's
// chat history rather than being replayed back to it as if a player had said it.
dungeonEvents.on('room_entered', ({ cid, room, characterName }) => {
  const dungeon = dungeonOf(cid, characterName);
  if (!dungeon) return;
  const text = templateRoomEntry(dungeon, room);
  if (!text) return;
  void postChat(cid, { text, senderName: 'Virtual DM', timestamp: Date.now() }, [characterName]);
});
