import type { DungeonEntity, EnemyStatBlock } from 'shared';
import { hasLineOfSight, statMod } from 'shared';
import { randomUUID } from 'crypto';
import { saveDungeon, saveEncounter, getConfig, readChatLog, listCharacters, readNemeses, readManifest, appendChatLog } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateEncounterEnemies } from '../session-processor/imagePrompts.ts';
import { generateEncounterDungeon, toClientDungeon, roomAt } from './index.ts';
import { dungeonEvents } from './events.ts';
import { Encounter, Team, Participant } from '../domain/encounter.ts';
import { Creature } from '../domain/creature.ts';
import { logError, logDebug } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, dungeons, microDungeons, withLivePositions, PLAYER_SIGHT_RADIUS, ENEMY_AGGRO_RADIUS, enemiesReady, combatStartedAt } from '../state.ts';
import { D20Roll } from '../combat/dice.ts';
import { addToTurnOrder, rollPlayerInitiatives, rollEnemyInitiatives } from '../combat/runtime.ts';

// Runs on every player token move while a dungeon is loaded: reveals creatures within sight,
// fires room_entered the first time a room is stepped into, and either starts combat (not
// already fighting) or pulls newly-aggro'd creatures into the running fight (already fighting)
// when one comes within its own aggro radius.
export async function checkDungeonProximity(cid: string, gx: number, gy: number, characterName: string): Promise<void> {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const inCombat = combatState.get(cid);
  const encounter = inCombat ? encounters.get(cid) : undefined;

  let changed = false;
  const aggro: DungeonEntity[] = [];

  const room = roomAt(dungeon, gx, gy);
  if (room && !room.visited) {
    room.visited = true;
    changed = true;
    dungeonEvents.emit('room_entered', { cid, room, characterName });
  }

  for (const entity of dungeon.entities) {
    if (entity.type !== 'creature') continue;
    if (encounter?.findParticipant(entity.id)) continue; // already in this fight
    const dist = Math.max(Math.abs(gx - entity.x), Math.abs(gy - entity.y));
    const seen = dist <= PLAYER_SIGHT_RADIUS && hasLineOfSight(dungeon.cells, gx, gy, entity.x, entity.y);
    if (!entity.discovered && seen) { entity.discovered = true; changed = true; }
    if (dist <= ENEMY_AGGRO_RADIUS && seen) aggro.push(entity);
  }

  if (changed) {
    void saveDungeon(cid, dungeon);
    io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  }
  if (!aggro.length) return;
  if (inCombat) joinReinforcements(cid, aggro);
  else await startDungeonCombat(cid, aggro);
}

// Perception/Investigation checks compare against hideDC for undiscovered loot/traps within sight
// Returns a grounded note for the DM's next response: what this roll found (or that it found
// nothing conclusive), so the narration matches the map instead of improvising blind. Returns
// null when there's nothing dungeon-related to say at all (no dungeon, or nothing nearby).
export async function checkDungeonHiddenReveal(cid: string, characterName: string, total: number): Promise<string | null> {
  const dungeon = dungeons.get(cid);
  const pos = tokenPositions.get(cid)?.[characterName];
  if (!dungeon || !pos) return null;

  let changed = false;
  const found: string[] = [];
  let nearbyUncleared = false;
  for (const entity of dungeon.entities) {
    if (entity.type === 'creature' || entity.discovered || entity.hideDC === undefined) continue;
    if (Math.max(Math.abs(pos.gx - entity.x), Math.abs(pos.gy - entity.y)) > PLAYER_SIGHT_RADIUS) continue;
    if (!hasLineOfSight(dungeon.cells, pos.gx, pos.gy, entity.x, entity.y)) continue;
    if (total < entity.hideDC) { nearbyUncleared = true; continue; }
    entity.discovered = true;
    changed = true;
    found.push(entity.name);
    console.log(`[dungeon] ${characterName} notices ${entity.name}`);
  }

  if (changed) {
    void saveDungeon(cid, dungeon);
    io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
    return `${characterName}'s check finds: ${found.join(', ')}.`;
  }
  if (nearbyUncleared) return `${characterName}'s check finds nothing conclusive — whatever's here stays hidden for now.`;
  return null;
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

  let enemyTeam = encounter.teams.find(t => t.name === 'Enemies');
  if (!enemyTeam) {
    enemyTeam = new Team('enemies', 'Enemies');
    encounter.addTeam(enemyTeam);
  }

  const joined = triggerEntities.filter((e): e is DungeonEntity & { statBlock: EnemyStatBlock } => !!e.statBlock);
  const entries = joined.map(e => {
    const creature = Creature.from({ ...e.statBlock, id: e.id });
    const p = new Participant({
      id: creature.id,
      name: creature.name,
      initiative: new D20Roll().roll() + statMod(creature.stats.dex),
      isPlayer: false,
      teamId: 'enemies',
      creature,
    });
    enemyTeam!.addParticipant(p);
    return p;
  });

  encounter.expectedParticipantCount += entries.length;
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

// Posts a room's pre-generated description to the journal the instant a party first steps into
// it — no LLM call on this path, so there's no wait. Rooms without a description (e.g. the
// hand-authored GENERIC_ROOMS fallback) stay silent rather than inventing filler text.
dungeonEvents.on('room_entered', ({ cid, room }) => {
  if (!room.description) return;
  const msg = { text: room.description, senderName: 'DM', timestamp: Date.now() };
  io.to(ROOM).emit('chat:message', msg);
  void appendChatLog(cid, msg);
});
