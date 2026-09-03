import { randomUUID } from 'crypto';
import type { DungeonRoom, DungeonEntity, EnemyStatBlock, TrapEffect } from 'shared';
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

    for (const creatureHint of skipContent ? [] : hints?.creatures ?? []) {
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

    // Decorative props — unlike creatures/loot/traps above, every entry gets placed (not just [0]),
    // and always visible (discovered: true) — furniture isn't something a Perception check reveals.
    // Anchor comes from the manifest's relX/relY (clamped so the full footprint stays in-room), then
    // findFreeCell nudges it off any wall/occupied cell the same way loot/traps get nudged.
    // ponytail: footprint (width/height) is cosmetic only — collision tracking still uses just the
    // single anchor cell, same as every other entity type here. Upgrade to real multi-cell occupancy
    // if props ever need to mechanically block movement.
    for (const prop of isStairwellRoom ? [] : hints?.props ?? []) {
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
