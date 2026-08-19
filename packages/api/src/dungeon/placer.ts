import { randomUUID } from 'crypto';
import type { DungeonRoom, DungeonEntity, EnemyStatBlock } from 'shared';
import type { DungeonManifest } from './manifest.ts';

function area(room: DungeonRoom): number {
  return room.width * room.height;
}

const MIN_DIST_FROM_START = 15; // cells, every direction — no enemy/trap/loot may spawn closer than this to the start room

function key(x: number, y: number): string {
  return `${x},${y}`;
}

// Chebyshev distance from a point to a room's nearest edge — 0 while inside the room.
function distToRoom(room: DungeonRoom, x: number, y: number): number {
  const dx = x < room.x ? room.x - x : x > room.x + room.width - 1 ? x - (room.x + room.width - 1) : 0;
  const dy = y < room.y ? room.y - y : y > room.y + room.height - 1 ? y - (room.y + room.height - 1) : 0;
  return Math.max(dx, dy);
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

    // Nothing hostile or valuable spawns within MIN_DIST_FROM_START of the room the party starts in.
    // +1 buffer: loot/trap land up to 1 cell off room-center, so the room itself must clear by that much.
    if (distToRoom(startRoom, cx, cy) < MIN_DIST_FROM_START + 1) continue;

    const isLoot = lootRooms.has(room.id);
    const creatureHint = hints?.creatures?.[0];

    if (creatureHint) {
      const cell = findFreeCell(room, cx, cy, occupied, cells);
      if (cell) {
        occupied.add(key(cell.x, cell.y));
        const statBlock = { ...creatureHint, id: randomUUID() };
        entities.push({ id: statBlock.id, type: 'creature', x: cell.x, y: cell.y, name: statBlock.name, discovered: false, statBlock });
      }
    }

    const lootHint = hints?.loot?.[0];
    if (lootHint || isLoot) {
      const cell = findFreeCell(room, cx + 1, cy, occupied, cells);
      if (cell) {
        occupied.add(key(cell.x, cell.y));
        const name = lootHint?.name ?? 'Chest';
        const hideDC = lootHint?.hideDC ?? 10;
        entities.push({ id: randomUUID(), type: 'loot', x: cell.x, y: cell.y, name, discovered: false, hideDC });
      }
    }

    const trapHint = hints?.traps?.[0];
    if (trapHint) {
      const cell = findFreeCell(room, cx - 1, cy, occupied, cells);
      if (cell) {
        occupied.add(key(cell.x, cell.y));
        entities.push({ id: randomUUID(), type: 'trap', x: cell.x, y: cell.y, name: trapHint.name, discovered: false, hideDC: trapHint.hideDC });
      }
    }

    // Decorative props — unlike creatures/loot/traps above, every entry gets placed (not just [0]),
    // and always visible (discovered: true) — furniture isn't something a Perception check reveals.
    // Anchor comes from the manifest's relX/relY (clamped so the full footprint stays in-room), then
    // findFreeCell nudges it off any wall/occupied cell the same way loot/traps get nudged.
    // ponytail: footprint (width/height) is cosmetic only — collision tracking still uses just the
    // single anchor cell, same as every other entity type here. Upgrade to real multi-cell occupancy
    // if props ever need to mechanically block movement.
    for (const prop of hints?.props ?? []) {
      const size = prop.size === 'large' ? 3 : prop.size === 'small' ? 1 : 2;
      const rawX = room.x + Math.round(prop.relX * (room.width - 1));
      const rawY = room.y + Math.round(prop.relY * (room.height - 1));
      const anchorX = Math.max(room.x, Math.min(rawX, room.x + room.width - size));
      const anchorY = Math.max(room.y, Math.min(rawY, room.y + room.height - size));
      const cell = findFreeCell(room, anchorX, anchorY, occupied, cells);
      if (cell) {
        occupied.add(key(cell.x, cell.y));
        entities.push({ id: randomUUID(), type: 'object', x: cell.x, y: cell.y, width: size, height: size, name: prop.name, discovered: true });
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
