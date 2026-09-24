import { randomUUID } from 'crypto';
import type { Dungeon, DungeonRoom, DungeonEntity, EnemyStatBlock, PendingSpawn, PropSpec, PropZone, RoomProp, TrapEffect } from 'shared';
import type { DungeonManifest, ManifestTrap } from './manifest.ts';

// Every AI-authored dungeon trap not otherwise given one gets this Thieves' Tools disarm DC — a
// hard guarantee, not something the model can skip by omission (same pattern as manifest.ts's
// DEFAULT_LOCKPICK_DC for doors).
const DEFAULT_DISARM_DC = 13;

function clampDisarmDC(dc: unknown): number {
  return typeof dc === 'number' && Number.isFinite(dc) ? Math.max(1, Math.min(30, Math.round(dc))) : DEFAULT_DISARM_DC;
}

// Builds the mechanical TrapEffect from the manifest's flavor+mechanics split. 'seal' carries no
// save/damage at all — it's an environmental consequence, not something to roll against. 'damage'
// (and anything else the model might emit for kind) rolls a save if the model gave one; missing
// save/damage data falls through to checkTrapAt's alert-only branch rather than guessing a formula.
// Either kind always gets a disarmDC — see clampDisarmDC.
export function trapEffectFor(hint: ManifestTrap): TrapEffect {
  const disarmDC = clampDisarmDC(hint.disarmDC);
  if (hint.kind === 'seal') {
    return {
      kind: 'seal', effects: [], disarmDC,
      ...(hint.escapeSkill ? { escapeSkill: hint.escapeSkill } : {}),
      ...(hint.escapeDC ? { escapeDC: hint.escapeDC } : {}),
    };
  }
  return {
    kind: 'damage', disarmDC,
    ...(hint.saveAbility && hint.dc ? { save: { ability: hint.saveAbility, dc: hint.dc, halfOnSave: true } } : {}),
    effects: hint.damageFormula
      ? [{ type: 'damage' as const, ...(hint.damageType ? { damageType: hint.damageType } : {}), scaling: { mode: 'spell-slot' as const, base: hint.damageFormula, tiers: [] } }]
      : [],
  };
}

function area(room: DungeonRoom): number {
  return room.width * room.height;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

// Nearest free FLOOR cell to (targetX, targetY), searched outward ring by ring, never leaving the
// room's bounding box. Floor check matters because a room's bounding box can include wall cells
// once rooms are irregular shapes, not solid rectangles — the geometric center isn't always floor.
// Returns null only if the room has no free floor cell at all (won't happen at realistic sizes).
function findFreeCell(room: DungeonRoom, targetX: number, targetY: number, occupied: Set<string>, cells: number[][]): { x: number; y: number } | null {
  const isFree = (x: number, y: number) => cells[y]?.[x] === 1 && !occupied.has(key(x, y));
  if (isFree(targetX, targetY)) return { x: targetX, y: targetY };
  const maxRadius = Math.max(room.width, room.height);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only, skip interior already checked
        const x = targetX + dx, y = targetY + dy;
        if (x < room.x || x >= room.x + room.width || y < room.y || y >= room.y + room.height) continue;
        if (isFree(x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** Every cell of an anchor's footprint is floor and unoccupied. Unlike the pre-density placer —
 * which tracked only the single anchor cell and let footprints overlap — this checks the whole
 * rect, because at 20-30 props per room overlapping furniture is the common case, not the edge. */
function footprintFree(room: DungeonRoom, x: number, y: number, w: number, h: number, occupied: Set<string>, cells: number[][]): boolean {
  if (x < room.x || y < room.y || x + w > room.x + room.width || y + h > room.y + room.height) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (cells[y + dy]?.[x + dx] !== 1 || occupied.has(key(x + dx, y + dy))) return false;
    }
  }
  return true;
}

function occupyFootprint(x: number, y: number, w: number, h: number, occupied: Set<string>): void {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) occupied.add(key(x + dx, y + dy));
}

/** How many of a cell's four orthogonal neighbours are wall/void — 1+ means it's against a wall,
 * 2+ (on perpendicular sides) means a corner. Cells outside the grid count as wall, so a room
 * flush with the map edge still reads as walled. */
function wallSides(x: number, y: number, cells: number[][]): number {
  let n = 0;
  if (cells[y]?.[x - 1] !== 1) n++;
  if (cells[y]?.[x + 1] !== 1) n++;
  if (cells[y - 1]?.[x] !== 1) n++;
  if (cells[y + 1]?.[x] !== 1) n++;
  return n;
}

/**
 * Anchor cells for a zone, best first. This is the half of prop placement the model used to do
 * badly with relX/relY: it has no idea where the walls are, and a bed floating mid-floor is what
 * made rooms read as abstract. Here the geometry is decided against the real carved cells.
 *
 * 'floor' is deliberately scattered by a cheap deterministic hash rather than scanned in row order,
 * which would stack every loose prop along the room's top edge. Deterministic so the same dungeon
 * always lays out the same way.
 */
function zoneCandidates(room: DungeonRoom, cells: number[][], zone: PropZone): { x: number; y: number }[] {
  const cx = room.x + (room.width - 1) / 2;
  const cy = room.y + (room.height - 1) / 2;
  const candidates: { x: number; y: number; score: number }[] = [];

  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (cells[y]?.[x] !== 1) continue;
      const sides = wallSides(x, y, cells);
      const distance = Math.abs(x - cx) + Math.abs(y - cy);
      let score: number;
      switch (zone) {
        // Against a wall but not wedged in a corner — a bed's headboard, a counter, a row of lockers.
        case 'wall': score = sides >= 1 ? sides : 99; break;
        case 'corner': score = sides >= 2 ? -sides : 99; break;
        case 'centre': score = distance; break;
        default: score = (x * 7919 + y * 104729) % 97; break;
      }
      candidates.push({ x, y, score });
    }
  }

  // Distance is the tiebreak for wall/corner so props run along a wall outward from the middle of
  // it rather than always piling into whichever corner the scan reached first.
  return candidates
    .sort((a, b) => a.score - b.score || (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy)) || a.y - b.y || a.x - b.x)
    .map(({ x, y }) => ({ x, y }));
}

/**
 * Places one room's prop requests. Exported and pure so the zone/footprint/collision behaviour —
 * the part that decides whether a furnished room reads as a real place — is checkable without an
 * LLM or an image call (see placer.zones.selfcheck.ts).
 *
 * A request whose footprint no longer fits anywhere is dropped rather than shrunk or overlapped: a
 * room that ran out of floor is already full, which is the outcome we wanted.
 */
export function placeRoomProps(
  room: DungeonRoom,
  requests: RoomProp[],
  specs: Map<string, PropSpec>,
  occupied: Set<string>,
  cells: number[][],
): DungeonEntity[] {
  const placed: DungeonEntity[] = [];
  // Largest first: a 2x3 counter placed after thirty 1x1 stools would find no contiguous rect left.
  const ordered = [...requests].sort((a, b) => {
    const sa = specs.get(a.noun), sb = specs.get(b.noun);
    return (sb ? sb.sizeXY[0] * sb.sizeXY[1] : 0) - (sa ? sa.sizeXY[0] * sa.sizeXY[1] : 0);
  });

  for (const request of ordered) {
    const spec = specs.get(request.noun);
    if (!spec) continue;
    const [w, h] = spec.sizeXY;
    const candidates = zoneCandidates(room, cells, request.zone);
    let remaining = request.count;
    for (const { x, y } of candidates) {
      if (remaining <= 0) break;
      if (!footprintFree(room, x, y, w, h, occupied, cells)) continue;
      occupyFootprint(x, y, w, h, occupied);
      placed.push({ id: randomUUID(), type: 'object', x, y, width: w, height: h, name: spec.noun, discovered: true });
      remaining--;
    }
  }
  return placed;
}

/**
 * The creatures placeEntities skipped because they `appears` with a later quest stage — stored on
 * the dungeon and placed in their room when that stage opens (questChain.ts's resolveStage). Same
 * entrance/stairwell exclusion as placeEntities, so a held creature can't land somewhere a placed
 * one never could.
 */
export function collectPendingSpawns(rooms: DungeonRoom[], manifest: DungeonManifest): PendingSpawn[] {
  const startRoom = rooms.find(r => r.role === 'entrance') ?? rooms[0];
  return rooms.flatMap(room => {
    if (room.id === startRoom?.id || room.isStairwell) return [];
    const creatures = manifest.rooms.find(mr => mr.name === room.name)?.creatures ?? [];
    return creatures.flatMap(({ appears, ...creature }) => appears ? [{ stageId: appears, roomId: room.id, statBlock: { ...creature, id: randomUUID() } }] : []);
  });
}

/** A held creature as the entity it becomes — also how generation hands held creatures to the
 * portrait pipeline before they exist on the map (the statBlock is shared, so portraitSrc sticks). */
export function pendingSpawnEntity(spawn: PendingSpawn, x = 0, y = 0): DungeonEntity {
  return { id: spawn.statBlock.id, type: 'creature', x, y, name: spawn.statBlock.name, discovered: false, statBlock: spawn.statBlock };
}

/**
 * Brings every creature held for `stageId` onto the map, each on the free floor cell nearest its
 * room's centre — clear of every entity footprint and every token standing there. Mutates the
 * dungeon (entities in, pendingSpawns out) and returns what it placed. A room with no free cell
 * keeps its creature pending rather than dropping it.
 */
export function spawnPending(dungeon: Dungeon, stageId: string): DungeonEntity[] {
  const occupied = new Set<string>();
  for (const e of dungeon.entities) {
    for (let dy = 0; dy < (e.height ?? 1); dy++) for (let dx = 0; dx < (e.width ?? 1); dx++) occupied.add(key(e.x + dx, e.y + dy));
  }
  for (const pos of Object.values(dungeon.positions ?? {})) occupied.add(key(pos.gx, pos.gy));

  const spawned: DungeonEntity[] = [];
  const kept: PendingSpawn[] = [];
  for (const spawn of dungeon.pendingSpawns ?? []) {
    const room = spawn.stageId === stageId ? dungeon.rooms.find(r => r.id === spawn.roomId) : undefined;
    const cell = room && findFreeCell(room, room.x + Math.floor(room.width / 2), room.y + Math.floor(room.height / 2), occupied, dungeon.cells);
    if (!cell) { kept.push(spawn); continue; }
    occupied.add(key(cell.x, cell.y));
    spawned.push(pendingSpawnEntity(spawn, cell.x, cell.y));
  }
  dungeon.entities.push(...spawned);
  if (kept.length) dungeon.pendingSpawns = kept;
  else delete dungeon.pendingSpawns;
  return spawned;
}

export function placeEntities(rooms: DungeonRoom[], manifest: DungeonManifest, cells: number[][]): DungeonEntity[] {
  if (rooms.length === 0) return [];

  const entities: DungeonEntity[] = [];
  const manifestRooms = manifest.rooms;
  const occupied = new Set<string>();

  // Smallest third = loot caches. Everything else is empty unless the manifest itself put
  // something there — no invented filler creature/boss for a room the manifest left alone.
  const byArea = [...rooms].sort((a, b) => area(b) - area(a));
  const lootRooms = new Set(byArea.slice(Math.floor(byArea.length * 0.65)).map(r => r.id));

  const startRoom = rooms.find(r => r.role === 'entrance') ?? rooms[0]!;

  for (const room of rooms) {
    const hints = manifestRooms.find(mr => mr.name === room.name);
    // Aim for room center; loot/trap offset so they don't overlap the creature marker — findFreeCell
    // nudges any of these off each other or off an already-placed entity in the same room.
    const cx = room.x + Math.floor(room.width / 2);
    const cy = room.y + Math.floor(room.height / 2);

    // Safe zone is the entrance room itself, nothing wider — a raw-distance buffer used to also
    // swallow whichever rooms happened to sit nearby, discarding manifest-authored content (see
    // fetchManifest's predefinedChain handling) along with it, which silently broke quests the
    // dungeon was built to serve. checkDungeonProximity (runtime.ts) backs this up: aggro itself
    // is suppressed while a player is standing in the entrance room, so a creature placed right
    // outside it still can't ambush someone who hasn't stepped out yet.
    const isEntranceRoom = room.id === startRoom.id;
    // A stairwell is a fixed 2x2 (see buildingLayout.ts's footprint()) with its own 'stairs' entity
    // taking the whole footprint, added later in dungeon/index.ts — placer.ts runs first and has no
    // idea that entity is coming, so nothing here can avoid colliding with it. Treat it as excluded
    // the same way the entrance room already is, rather than risk a creature/chest/prop sharing a
    // cell with the stairs icon in a room barely big enough for one. Also skips the area-based
    // auto-chest fallback below — a 2x2 room is almost always the smallest in the dungeon, so
    // without this every stairwell would otherwise get one.
    const isStairwellRoom = room.isStairwell === true;
    const skipContent = isEntranceRoom || isStairwellRoom;

    const isLoot = !skipContent && lootRooms.has(room.id);

    // Creatures that arrive with a later quest stage aren't placed — collectPendingSpawns holds them.
    for (const creatureHint of skipContent ? [] : (hints?.creatures ?? []).filter(c => !c.appears)) {
      const cell = findFreeCell(room, cx, cy, occupied, cells);
      if (cell) {
        occupied.add(key(cell.x, cell.y));
        const statBlock = { ...creatureHint, id: randomUUID() };
        entities.push({ id: statBlock.id, type: 'creature', x: cell.x, y: cell.y, name: statBlock.name, discovered: false, statBlock });
      }
    }

    // No manifest loot hints but this room's in the smallest-area third: fall back to one auto chest.
    const lootHints = skipContent ? [] : hints?.loot?.length ? hints.loot : isLoot ? [{ name: 'Chest', hideDC: 10, contents: ['a few silver coins'] }] : [];
    for (const lootHint of lootHints) {
      const cell = findFreeCell(room, cx + 1, cy, occupied, cells);
      if (cell) {
        occupied.add(key(cell.x, cell.y));
        entities.push({ id: randomUUID(), type: 'loot', x: cell.x, y: cell.y, name: lootHint.name, discovered: false, hideDC: lootHint.hideDC, ...(lootHint.contents ? { contents: lootHint.contents } : {}) });
      }
    }

    for (const trapHint of skipContent ? [] : hints?.traps ?? []) {
      const cell = findFreeCell(room, cx - 1, cy, occupied, cells);
      if (cell) {
        occupied.add(key(cell.x, cell.y));
        entities.push({ id: randomUUID(), type: 'trap', x: cell.x, y: cell.y, name: trapHint.name, discovered: false, hideDC: trapHint.hideDC, trap: trapEffectFor(trapHint) });
      }
    }
  }

  return entities;
}

// Scatters a fixed set of stat blocks (already generated for this encounter) around one room —
// used for combat-arena dungeons, where WHO spawns is decided upstream and this only decides WHERE.
// Entity id = stat block id, so the combat participant and the dungeon entity stay the same row.
// Kept strictly left-of-center: the party's own spawn (GamePage.tsx) starts at-and-right-of-center
// in the same room, so the two groups never land on the same cell.
export function placeEncounterEntities(room: DungeonRoom, statBlocks: EnemyStatBlock[]): DungeonEntity[] {
  const cx = room.x + Math.floor(room.width / 2);
  const clampX = (x: number) => Math.max(room.x, Math.min(x, cx - 1));
  const clampY = (y: number) => Math.max(room.y, Math.min(y, room.y + room.height - 1));
  const perRow = Math.max(1, cx - room.x);

  return statBlocks.map((statBlock, i) => ({
    id: statBlock.id,
    type: 'creature',
    x: clampX(cx - 1 - (i % perRow)),
    y: clampY(room.y + 1 + Math.floor(i / perRow)),
    name: statBlock.name,
    discovered: true,
    statBlock,
  }));
}
