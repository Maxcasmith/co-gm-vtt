import { randomUUID } from 'crypto';
import type { AppConfig, Dungeon, DungeonEntity, DungeonRoom, EnemyStatBlock, CampaignGenre, ClientToServerEvents, ServerToClientEvents } from 'shared';
import type { Socket } from 'socket.io';
import { toDungeon, occupantsOf, type Audience } from '../state.ts';
import { slugifyTheme, hasLineOfSight, closedDoorCells } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import type { ArenaTerrain } from '../session-processor/imagePrompts.ts';
import { fetchManifest, type ManifestRoom } from './manifest.ts';
import { generateGrid, type DoorRect } from './generator.ts';
import { generateBuildingLayout } from './buildingLayout.ts';
import { collectPendingSpawns, pendingSpawnEntity, placeEntities, placeEncounterEntities } from './placer.ts';
import { ensureTilesetSupport, type TilesetResolution } from './tilesets.ts';
import { assignPortraitSrcs, generateCreaturePortraits } from './creaturePortraits.ts';
import { assignPropSpriteSrcs, generatePropSprites } from './props.ts';
import { readPropBucket } from './propCatalogue.ts';
import { logDebug } from '../logger.ts';
import { EMPTY_PROP_PLAN, generatePropDressing } from './propDressing.ts';
import { furnishRooms } from './roomLayout.ts';

export async function generateDungeon(
  name: string,
  dungeonType: string,
  adapter: StoryProviderAdapter,
  storyContext = '',
  opts?: {
    width?: number; height?: number; roomRange?: [number, number]; partySize?: number; partyLevel?: number;
    /** Use this id instead of generating a fresh one — lets a caller (dungeon_gen) generate quests
     * tagged with the dungeon's id before the dungeon itself exists. */
    id?: string;
    /** Generated before this call — see session-processor's generateDungeonQuests. When present,
     * this becomes questChain[0] (set directly below, id/name/description never re-echoed by the
     * manifest LLM call) — the floor plan is designed to serve it, and the manifest call itself
     * decides its trigger plus every stage that follows, since only it knows the real room/entity
     * names to reference. */
    predefinedChain?: { id: string; name: string; description: string }[];
    /** The campaign's persisted, fixed-set genre (see WorldMeta.genre) — undefined for campaigns
     * predating the field. Threaded through to fetchManifest (narrows the room-material prompt to
     * what's already reusable) and ensureTilesetSupport (records new materials against it). */
    genre?: CampaignGenre;
    /** Surfaced to whoever is watching the loading screen. Generation is several minutes of
     * sequential model and image calls, and a single "Generating dungeon…" for all of them leaves
     * both the player and us unable to tell a slow stage from a hung one. */
    onProgress?: (message: string) => void;
  },
  onToken: (t: string) => void = () => {},
  config?: AppConfig,
): Promise<Dungeon> {
  // Per-stage elapsed, logged to storage/logs (console.log only reaches the dev terminal). Paired
  // with the progress messages so a slow run can be attributed to a specific call afterwards
  // instead of inferred from file mtimes.
  let mark = Date.now();
  const since = (): string => {
    const seconds = (Date.now() - mark) / 1000;
    mark = Date.now();
    return `${seconds.toFixed(1)}s`;
  };
  const progress = (message: string): void => opts?.onProgress?.(message);

  progress('Designing the floor plan…');
  const manifest = await fetchManifest(name, dungeonType, adapter, storyContext, opts?.roomRange, opts?.partySize, opts?.partyLevel, onToken, opts?.predefinedChain, opts?.genre);
  logDebug(`dungeon "${name}": manifest (${manifest.rooms.length} rooms) ${since()}`);
  // Man-made structures get a deterministic floor-plan layout driven by the manifest's adjacency
  // graph; natural/carved spaces (cave, crypt, tomb) go straight to the procedural row-packer —
  // no LLM geometry call, and no attempt to force building-shaped rooms onto a cave.
  const { cells, rooms, doors, stairs } = manifest.structureType === 'building'
    ? generateBuildingLayout(manifest, opts)
    : generateGrid(manifest, opts);
  // Pass 2: what furnishes each room, and how much of it. Serial rather than overlapped with the
  // manifest call because it needs both that call's per-room categories AND the carved layout above
  // (density is derived from each room's real floor area, not its 'small|medium|large' label).
  // Awaited, not backgrounded: the client draws props synchronously, so they must exist before the
  // dungeon ships — same contract tilesets and prop sprites already have below.
  logDebug(`dungeon "${name}": layout (${rooms.length} rooms, ${manifest.structureType}) ${since()}`);

  progress('Furnishing the rooms…');
  const propCatalogue = await readPropBucket(opts?.genre);
  const propPlan = config
    ? await generatePropDressing(rooms, manifest.rooms, cells, manifest.theme, adapter, propCatalogue, opts?.genre, onToken)
    : EMPTY_PROP_PLAN;
  logDebug(`dungeon "${name}": prop dressing (${propPlan.props.length} types) ${since()}`);

  // Everything except props. Props go last (pass 3, below), because the layout call has to be shown
  // which cells creatures, loot, traps, stairs and doors already hold.
  const entities = placeEntities(rooms, manifest, cells);
  const pendingSpawns = collectPendingSpawns(rooms, manifest);
  // Held creatures get their portraits now, with everyone else's — by the time they spawn mid-play
  // there is no generation step left to draw them.
  const withHeld = [...entities, ...pendingSpawns.map(p => pendingSpawnEntity(p))];
  // Multi-floor building layouts only — already fully resolved (id + reciprocal linkTo) by
  // generateBuildingLayout's stitching step, nothing left to look up here (unlike doors' keyName,
  // stairs pairing never depends on placeEntities' output).
  entities.push(...(stairs ?? []));
  // Name -> id for every placed loot entity, to resolve a locked door's keyName (still just a
  // name at this point — manifest.ts validated it refers to *some* loot item, but nothing gets a
  // real id until placeEntities runs above) into the real DungeonEntity.requiresKeyId points at.
  const lootIdByName = new Map(entities.filter(e => e.type === 'loot').map(e => [e.name, e.id]));
  // Every carved doorway (building layouts only — organic spaces carve plain gaps, no literal
  // door fits the genre) becomes its own Door entity, state/key resolved by resolveDoorState.
  for (const door of doors ?? []) {
    const { doorState, requiresKeyId, lockpickDC } = resolveDoorState(door, lootIdByName);
    entities.push({
      id: randomUUID(), type: 'door', x: door.x, y: door.y, width: door.width, height: door.height,
      name: 'Door', discovered: true, doorState, transparency: 0,
      ...(requiresKeyId ? { requiresKeyId } : {}),
      ...(lockpickDC ? { lockpickDC } : {}),
    });
  }
  // Synchronous/deterministic — every creature entity gets a portraitSrc before this function
  // returns, regardless of whether the file exists yet (see creaturePortraits.ts).
  assignPortraitSrcs(withHeld);

  // Creatures never gate dungeon return — fired first, resolves in the background regardless of
  // how long tilesets/props take (errors caught/logged inside generateCreaturePortraits itself).
  if (config) void generateCreaturePortraits(withHeld, config);

  // Tilesets, prop sprites and pass 3 (room layout) must all exist before the dungeon ships — the
  // client draws them synchronously, no background fill like creature portraits get. None of the
  // three depends on another (layout needs only the prop plan, which already exists), so they run
  // together and the dungeon waits for the slowest rather than the sum.
  progress('Arranging furniture, drawing floor textures and props…');
  const descriptions = new Map(manifest.rooms.map(r => [r.name, r.description ?? '']));
  const [tileset, props] = await Promise.all([
    config ? ensureTilesetSupport(manifest.theme, manifest.materials, config, opts?.genre) : Promise.resolve<TilesetResolution>({ tilesetSlug: slugifyTheme(manifest.theme) }),
    config && propPlan.props.length ? furnishRooms(rooms, propPlan, cells, entities, adapter, descriptions, opts?.genre) : Promise.resolve([]),
    config ? generatePropSprites(propPlan.props, config, opts?.genre) : Promise.resolve(),
  ]);
  entities.push(...props);
  // Same contract as creature portraits: spriteSrc set synchronously whether or not the file
  // exists yet. Genre-scoped, because a sprite lives under its setting/tone bucket — without a genre
  // there is no bucket to point at, so props render as plain markers rather than at a dead URL.
  assignPropSpriteSrcs(entities, opts?.genre);
  // Last place props can silently vanish (after the manifest's categories and the dressing plan):
  // a layout that couldn't fit them. Logged so a propless dungeon names the stage that dropped them.
  logDebug(`dungeon "${name}": tilesets + prop sprites + room layout — ${props.length} props from ${propPlan.props.length} types across ${rooms.length} rooms ${since()}`);

  const dungeon: Dungeon = {
    id: opts?.id ?? randomUUID(),
    name,
    // Actual carved dimensions, not the per-floor opts — a multi-floor building's stitched canvas
    // is wider than any single floor block (see buildingLayout.ts's generateBuildingLayout).
    width: cells[0]?.length ?? opts?.width ?? 50,
    height: cells.length || (opts?.height ?? 50),
    cells,
    rooms,
    entities,
    questChain: manifest.questChain,
    ...(pendingSpawns.length ? { pendingSpawns } : {}),
    theme: manifest.theme,
    tilesetSlug: tileset.tilesetSlug,
    ...(tileset.materialSources ? { materialSources: tileset.materialSources } : {}),
    structureType: manifest.structureType,
    illumination: manifest.illumination,
    baseIllumination: manifest.illumination,
  };

  return dungeon;
}

// Resolves a carved doorway's lock into what actually ships on the Door entity. `door.keyName`
// (see buildingLayout.ts's lockFor) is still just a name — manifest.ts's resolveDoorLocks already
// checked it matches *some* loot item in the manifest, but nothing gets a real id until
// placeEntities runs, so this is the point that turns it into a real requiresKeyId. A 'locked'
// door whose key doesn't resolve in `lootIdByName` — should never happen given manifest.ts's own
// validation, but never trusted blind twice — downgrades to 'closed' rather than shipping
// unopenable. Exported/pure so this one small but safety-critical branch is unit-testable without
// spinning up a full generateDungeon call (see doorLocks.selfcheck.ts).
// Same fallback manifest.ts's resolveDoorLocks already applies — repeated here as a second,
// independent guarantee that a 'locked' door can never ship without one, not a config to tune.
const DEFAULT_LOCKPICK_DC = 15;

export function resolveDoorState(
  door: DoorRect, lootIdByName: Map<string, string>,
): { doorState: 'open' | 'closed' | 'locked'; requiresKeyId?: string; lockpickDC?: number } {
  if (door.doorState === 'locked') {
    const requiresKeyId = lootIdByName.get(door.keyName ?? '');
    return requiresKeyId ? { doorState: 'locked', requiresKeyId, lockpickDC: door.lockpickDC ?? DEFAULT_LOCKPICK_DC } : { doorState: 'closed' };
  }
  return { doorState: door.doorState ?? 'closed' };
}

// Combat-arena dungeon: one bare room sized for the encounter, no LLM calls — who spawns is
// already decided (the stat blocks), this only needs geometry to drop them into.
/** The bare combat arena an open-world fight is played on. Built with no enemies at combat start
 * (so the map is on screen immediately, not after the enemy-generation model call), then filled in
 * by placeArenaEnemies once the stat blocks arrive. */
export function generateEncounterDungeon(statBlocks: EnemyStatBlock[] = []): Dungeon {
  const { cells, rooms } = generateGrid({ rooms: [{ name: 'Battle', size: 'large' }], structureType: 'organic', theme: 'high_fantasy', questChain: [], illumination: 1, materials: [] });
  const room = rooms[0]!;
  const entities = placeEncounterEntities(room, statBlocks);

  return {
    id: randomUUID(),
    name: 'Battle',
    width: 50,
    height: 50,
    cells,
    rooms,
    entities,
    theme: 'high_fantasy',
    structureType: 'organic',
    illumination: 1,
    baseIllumination: 1,
  };
}

// Debug/compare artifact: same wall/corridor/room-letter rendering convention used across the
// layout generators, so a saved map reads consistently regardless of which one produced it.
export function renderDungeonAscii(dungeon: Dungeon): string {
  const ownerOf: number[][] = Array.from({ length: dungeon.height }, () => new Array<number>(dungeon.width).fill(-1));
  dungeon.rooms.forEach((room, i) => {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (dungeon.cells[y]?.[x] === 1) ownerOf[y]![x] = i;
      }
    }
  });

  // '#' for connector corridors (raw floor cells carved between rooms — see resolveRoom's doc —
  // that never got their own DungeonRoom entry), keyed in the legend like every room letter
  // instead of a bare, unexplained '.'. Never a letter itself, so it can't collide with a room's
  // A-Z key the way picking the "next" letter after the room count could once rooms wrap past Z.
  const legend = [
    ...dungeon.rooms.map((r, i) => `${String.fromCharCode(65 + (i % 26))} = ${r.name}`),
    '# = Corridor',
  ].join('\n');
  const rows = dungeon.cells.map((row, y) =>
    row.map((cell, x) => {
      if (cell !== 1) return '-';
      const owner = ownerOf[y]![x]!;
      return owner === -1 ? '#' : String.fromCharCode(65 + (owner % 26));
    }).join('')
  );

  return `${legend}\n\n${rows.join('\n')}\n`;
}

// Server keeps the full dungeon (hidden entities included) in storage/memory —
// this strips anything not yet discovered before it goes out over the wire.
/** Sends `dungeon` to the players standing in it (or to `audience` — one reconnecting socket),
 * with its occupant list, so each client's entrance placement only places this dungeon's group. */
export function broadcastDungeon(cid: string, dungeon: Dungeon, audience: Audience | Socket<ClientToServerEvents, ServerToClientEvents> = toDungeon(cid, dungeon.id)): void {
  audience.emit('dungeon:loaded', { ...toClientDungeon(dungeon), occupants: occupantsOf(cid, dungeon.id) });
}

export function toClientDungeon(dungeon: Dungeon): Dungeon {
  // Party-placed traps skip the discovered gate — you always know where your own trap is.
  // pendingSpawns is spoiler data (who's coming, and when) — never sent.
  const { pendingSpawns: _pendingSpawns, ...visible } = dungeon;
  return { ...visible, entities: dungeon.entities.filter(e => e.discovered || e.placedBy) };
}

/**
 * Applies the ground the encounter model authored for an open-world fight (see ArenaTerrain), so
 * an arena renders real floor art instead of the flat fallback colour a materialless room paints.
 * Runs after the arena is already on screen, not before — the map ships first by design (see
 * openArena), so this is a fill-in followed by a rebroadcast. Reuses existing genre art rather than
 * drawing new whenever the model said to, exactly like a dungeon's rooms.
 */
export async function applyArenaTerrain(arena: Dungeon, terrain: ArenaTerrain, config: AppConfig, genre?: CampaignGenre): Promise<void> {
  arena.theme = terrain.theme;
  // One bare room, but written as a loop so it stays correct if arenas ever get more than one.
  for (const room of arena.rooms) room.material = terrain.material.key;
  const { tilesetSlug, materialSources } = await ensureTilesetSupport(terrain.theme, [terrain.material], config, genre);
  arena.tilesetSlug = tilesetSlug;
  if (materialSources) arena.materialSources = materialSources;
}

/**
 * Furnishes an open-world fight's arena with the exact dungeon prop pipeline — pass 2 dressing, pass
 * 3 layout and sprite art — so a change to how dungeons are furnished changes arenas too. The arena
 * is one room, described by the encounter call's terrain. Awaited in full: the fight's loading
 * screen stays up until the props exist, same contract generateDungeon has.
 *
 * `partySize` keeps the room centre clear, because that is where the client spreads the party
 * (GamePage's entrance placement) — props there would sit under the players' tokens.
 */
export async function furnishArena(arena: Dungeon, terrain: ArenaTerrain, partySize: number, config: AppConfig, adapter: StoryProviderAdapter, genre?: CampaignGenre): Promise<void> {
  const room = arena.rooms[0];
  if (!room) return;
  if (!terrain.description) logDebug(`arena: encounter call gave no scene description — furnishing from the floor alone`);
  const description = terrain.description ?? `A fight on ${terrain.material.description}.`;
  const manifestRoom: ManifestRoom = { name: room.name, size: 'large', description };
  const plan = await generatePropDressing(arena.rooms, [manifestRoom], arena.cells, terrain.theme, adapter, await readPropBucket(genre), genre);
  if (!plan.props.length) return;

  // A stand-in footprint over the party's spawn area, only so furnishRooms counts those cells as
  // taken. Never stored on the arena.
  const side = Math.ceil(Math.sqrt(Math.max(1, partySize))) + 2;
  const partyArea: DungeonEntity = {
    id: 'party-spawn', type: 'object', name: 'party-spawn', discovered: false, width: side, height: side,
    x: room.x + Math.floor(room.width / 2) - Math.floor(side / 2),
    y: room.y + Math.floor(room.height / 2) - Math.floor(side / 2),
  };
  const [props] = await Promise.all([
    furnishRooms(arena.rooms, plan, arena.cells, [...arena.entities, partyArea], adapter, new Map([[room.name, description]]), genre),
    generatePropSprites(plan.props, config, genre),
  ]);
  arena.entities.push(...props);
  assignPropSpriteSrcs(arena.entities, genre);
  logDebug(`arena: ${props.length} props from ${plan.props.length} types`);
}

/** Drops freshly generated enemies into an existing arena, returning the entities placed. */
export function placeArenaEnemies(arena: Dungeon, statBlocks: EnemyStatBlock[]): DungeonEntity[] {
  const room = arena.rooms[0];
  if (!room) return [];
  arena.entities = placeEncounterEntities(room, statBlocks);
  const positions = arena.positions ??= {};
  for (const entity of arena.entities) positions[entity.id] = { gx: entity.x, gy: entity.y };
  return arena.entities;
}

export function roomAt(dungeon: Dungeon, gx: number, gy: number): DungeonRoom | undefined {
  return dungeon.rooms.find(r => gx >= r.x && gx < r.x + r.width && gy >= r.y && gy < r.y + r.height);
}

type Cell = { gx: number; gy: number };

/** Chained aggro for joining a fight: starting from `seeds` (everyone already in it, enemies
 * included), a candidate joins once within `radius` cells (Chebyshev) AND in line of sight of
 * anyone already in — and from then on extends the chain itself. Returns the joined candidates'
 * names in join order. */
export function chainClosure(dungeon: Dungeon, seeds: Cell[], candidates: Record<string, Cell>, radius: number): string[] {
  const blocked = closedDoorCells(dungeon);
  const chain = [...seeds];
  const joined: string[] = [];
  let pending = Object.entries(candidates);
  for (let grew = true; grew;) {
    grew = false;
    pending = pending.filter(([name, pos]) => {
      const reached = chain.some(c =>
        Math.max(Math.abs(c.gx - pos.gx), Math.abs(c.gy - pos.gy)) <= radius
        && hasLineOfSight(dungeon.cells, c.gx, c.gy, pos.gx, pos.gy, blocked));
      if (!reached) return true;
      joined.push(name);
      chain.push(pos);
      grew = true;
      return false;
    });
  }
  return joined;
}

// Decorative props (type 'object', no followsId — a followed object like Mage Hand's disk isn't
// a real scene fixture) within radiusFt of a point, same Chebyshev/5ft-per-cell distance rule as
// combat's participantsNearPoint. Named improvised targets (e.g. "the barrels") resolve through
// this rather than asking an LLM to invent coordinates for something that's already placed.
export function nearbyObjects(
  dungeon: Dungeon, gx: number, gy: number, radiusFt: number,
): { id: string; name: string; gx: number; gy: number }[] {
  return dungeon.entities
    .filter(e => e.type === 'object' && !e.followsId && e.discovered)
    .filter(e => Math.max(Math.abs(e.x - gx), Math.abs(e.y - gy)) * 5 <= radiusFt)
    .map(e => ({ id: e.id, name: e.name, gx: e.x, gy: e.y }));
}

// Connector corridors between rooms are carved as raw floor cells (buildingLayout's corridorTo
// repair) and never get their own DungeonRoom entry, so a position mid-corridor has no exact room
// owner. Snap it to the nearest room by center distance instead of surfacing "an unmapped area".
export function resolveRoom(dungeon: Dungeon, gx: number, gy: number): { room?: DungeonRoom; label: string } {
  const room = roomAt(dungeon, gx, gy);
  if (room) return { room, label: room.name };
  if (!dungeon.rooms.length) return { label: 'an unmapped area' };

  let nearest = dungeon.rooms[0]!;
  let bestDist = Infinity;
  for (const r of dungeon.rooms) {
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const dist = (cx - gx) ** 2 + (cy - gy) ** 2;
    if (dist < bestDist) { bestDist = dist; nearest = r; }
  }
  return { room: nearest, label: `the passage toward ${nearest.name}` };
}

/**
 * Ground-truth line anchoring a post-combat aftermath to where the fight actually happened (the
 * defeated creatures' own positions — see combat/runtime/damage.ts's victory handler), not wherever the
 * player's token happens to be sitting. Dungeon-crawl combat triggers on aggro radius, so a
 * ranged fight can end with the player never having walked into the room the kill happened in —
 * without this, the aftermath narration falls back on whatever room the player's token resolves
 * to, which can be a neighboring room entirely. Returns '' when there's nothing to anchor to.
 */
export function describeCombatLocation(dungeon: Dungeon, defeatedAt: { gx: number; gy: number }[]): string {
  if (!defeatedAt.length) return '';
  const rooms = [...new Set(defeatedAt.map(p => resolveRoom(dungeon, p.gx, p.gy).label))];
  return `The fight that just ended happened in ${rooms.join(' / ')} — anchor the aftermath there, not wherever a player's token currently sits.`;
}

function entityStatus(e: DungeonEntity): string {
  if (!e.discovered) return `undiscovered, hideDC ${e.hideDC ?? '?'}`;
  if (e.type === 'door' && e.doorState === 'locked') {
    return `discovered — locked (DM eyes only, NEVER state the DC: opens if a player narrates using the key once it's discovered, or on a Thieves' Tools/DEX check beating DC ${e.lockpickDC ?? '?'} — tag [[DOOR_UNLOCK:PlayerName]] the moment either happens, within 5ft)`;
  }
  if (e.type === 'door') return `discovered — ${e.doorState ?? 'closed'}`;
  if (e.type === 'stairs') return 'discovered — stairs to another floor, always usable, no lock';
  if (e.type === 'loot' && e.contents?.length) return `discovered — contains: ${e.contents.join(', ')}`;
  if (e.type === 'trap') {
    const seal = e.trap?.kind === 'seal' && e.trap.escapeDC
      ? ` — sealed shut (DM eyes only, NEVER state this: resolves on a DC ${e.trap.escapeDC} ${e.trap.escapeSkill ?? 'Athletics'} check when a player attempts something that would plausibly force/bypass it)`
      : '';
    const disarm = e.trap?.disarmDC ? ` (DM eyes only, NEVER state the DC — DC ${e.trap.disarmDC}: a player narrating using a Trap Disarm Kit on this trap removes it entirely if their roll beats it. Requires the kit — tag [[ITEM_USED:PlayerName|Trap Disarm Kit]], the roll and result happen automatically.)` : '';
    return `discovered${seal}${disarm}`;
  }
  return 'discovered';
}

// Ambient grounding for the DM's narrative context — which room each player is in, and what's
// already discovered there. Never mentions undiscovered entities: that's the hideDC reveal gate's
// job, not this one, so a roll like Athletics can't accidentally spoil what a Perception check hasn't found yet.
export function describeDungeonState(dungeon: Dungeon, positions: Record<string, { gx: number; gy: number }>): string {
  const byRoom = new Map<string, string[]>();
  for (const [name, pos] of Object.entries(positions)) {
    const room = roomAt(dungeon, pos.gx, pos.gy);
    const label = room ? room.name : 'an unmapped area';
    const names = byRoom.get(label) ?? [];
    names.push(name);
    byRoom.set(label, names);
  }
  if (!byRoom.size) return `Currently exploring: ${dungeon.name}\nNo live player position is tracked — do not name a specific current room.`;

  const lines = [`Currently exploring: ${dungeon.name}`];
  for (const [roomName, players] of byRoom) {
    lines.push(`- ${players.join(', ')} in ${roomName}`);
    const room = dungeon.rooms.find(r => r.name === roomName);
    if (!room) continue;
    const here = dungeon.entities.filter(e => e.discovered && e.x >= room.x && e.x < room.x + room.width && e.y >= room.y && e.y < room.y + room.height);
    for (const e of here) lines.push(`  - already discovered here: ${e.name}${e.type === 'door' ? ` (${e.doorState ?? 'closed'})` : ''}`);
    for (const d of room.dressing ?? []) lines.push(`  - ${d}`);
    for (const hd of room.hiddenDressing ?? []) if (hd.discovered) lines.push(`  - already discovered here: ${hd.text}`);
  }
  return lines.join('\n');
}

// Full ground-truth dump for the dedicated dungeon-exploration pathway: complete room graph
// (including undiscovered entities and hideDC) so the DM can reason accurately about spatial
// questions ("is X near Y", "what's through that door") — the caller's prompt is responsible for
// instructing the model never to reveal what a character couldn't perceive. Unlike
// describeDungeonState, this is never sent to a pathway where under-informed narration is the goal.
// Everything here is pre-resolved to room names — no raw (x,y) coordinates — so the model never has
// to do its own spatial math to answer "where am I" or "what's next door".
export function describeDungeonGroundTruth(dungeon: Dungeon, positions: Record<string, { gx: number; gy: number }>): string {
  const entitiesByLabel = new Map<string, DungeonEntity[]>();
  for (const e of dungeon.entities) {
    const { label } = resolveRoom(dungeon, e.x, e.y);
    const list = entitiesByLabel.get(label) ?? [];
    list.push(e);
    entitiesByLabel.set(label, list);
  }

  const lines = [`Full floor plan — ${dungeon.name} (ground truth, not what players have necessarily perceived):`];

  if (Object.keys(positions).length) {
    lines.push('Right now:');
    for (const [name, pos] of Object.entries(positions)) {
      const { room, label } = resolveRoom(dungeon, pos.gx, pos.gy);
      lines.push(`- ${name} is in ${label}`);
      for (const e of entitiesByLabel.get(label) ?? []) lines.push(`  - ${e.name} (${e.type}) — ${entityStatus(e)}`);
      for (const connected of room?.connectsTo ?? []) {
        lines.push(`  - through to ${connected}:`);
        const there = entitiesByLabel.get(connected) ?? [];
        if (!there.length) lines.push('    - nothing of note');
        for (const e of there) lines.push(`    - ${e.name} (${e.type}) — ${entityStatus(e)}`);
      }
    }
  } else {
    // No live token position for anyone — do not let the model fall back to inferring
    // location from chat history (that's how a stale room name survives a narrated move).
    lines.push('Right now: no live player position is tracked. Do not name a specific current room — ask, or describe only what was just narrated.');
  }

  lines.push('Rooms:');
  for (const room of dungeon.rooms) {
    const kind = room.isStairwell ? ' (stairwell)' : room.isHallway ? ' (hallway)' : '';
    const floor = room.floor ? ` (floor ${room.floor})` : '';
    const role = room.role ? ` (${room.role})` : '';
    const connects = room.connectsTo?.length ? ` — connects to: ${room.connectsTo.join(', ')}` : '';
    lines.push(`- ${room.name}${kind}${floor}${role}${connects}`);
    for (const d of room.dressing ?? []) lines.push(`  - dressing: ${d}`);
    for (const hd of room.hiddenDressing ?? []) {
      const state = hd.discovered ? 'discovered' : 'undiscovered — never state outright in narration';
      lines.push(`  - hidden dressing (hideDC ${hd.hideDC}, ${state}): ${hd.text}`);
    }
  }

  if (dungeon.entities.length) {
    lines.push('Entities (includes undiscovered — hideDC is the Perception/Investigation DC to spot it; never state an undiscovered entity outright in narration):');
    for (const e of dungeon.entities) {
      const { label } = resolveRoom(dungeon, e.x, e.y);
      lines.push(`- ${e.name} (${e.type}) in ${label} — ${entityStatus(e)}`);
    }
  }

  return lines.join('\n');
}
