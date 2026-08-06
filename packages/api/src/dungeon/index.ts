import { randomUUID } from 'crypto';
import type { Dungeon, DungeonEntity, DungeonRoom, EnemyStatBlock, Quest } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { fetchManifest } from './manifest.ts';
import { generateGrid } from './generator.ts';
import { generateBuildingLayout } from './buildingLayout.ts';
import { placeEntities, placeEncounterEntities } from './placer.ts';

export async function generateDungeon(
  name: string,
  dungeonType: string,
  adapter: StoryProviderAdapter,
  storyContext = '',
  opts?: { width?: number; height?: number; roomRange?: [number, number] },
  onToken: (t: string) => void = () => {},
): Promise<Dungeon> {
  const manifest = await fetchManifest(name, dungeonType, adapter, storyContext, opts?.roomRange, onToken);
  // Man-made structures get a deterministic floor-plan layout driven by the manifest's adjacency
  // graph; natural/carved spaces (cave, crypt, tomb) go straight to the procedural row-packer —
  // no LLM geometry call, and no attempt to force building-shaped rooms onto a cave.
  const { cells, rooms } = manifest.structureType === 'building'
    ? generateBuildingLayout(manifest, opts)
    : generateGrid(manifest, opts);
  const entities = placeEntities(rooms, manifest, cells);

  return {
    id: randomUUID(),
    name,
    width: opts?.width ?? 50,
    height: opts?.height ?? 50,
    cells,
    rooms,
    entities,
    goals: manifest.goals,
    theme: manifest.theme,
    structureType: manifest.structureType,
  };
}

// Quests a freshly-generated dungeon should seed, merged into whatever quests already exist for
// the campaign. Narrative goals come from the manifest (LLM-authored, may be empty). "Defeat
// <boss>" and "Escape <dungeon>" are generated here in code, not by the LLM, so they carry a
// deterministic id the mechanical systems (boss death, DUNGEON_EXIT) can resolve without any
// narration having to remember to. No I/O here — deliberately pure, callers own read/write
// (dungeon/index.ts has no storage.ts dependency, and storage.ts already depends on this file).
export function buildDungeonQuests(dungeon: Dungeon, existingQuests: Quest[]): Quest[] {
  const today = new Date().toISOString().slice(0, 10);
  const toAdd: Quest[] = [];

  for (const goal of dungeon.goals ?? []) {
    toAdd.push({ id: goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name: goal, description: goal, status: 'open', log: [], addedAt: today });
  }

  const boss = dungeon.entities.find(e => e.type === 'creature' && e.statBlock?.isBoss);
  if (boss) {
    toAdd.push({ id: `boss-${boss.id}`, name: `Defeat ${boss.name}`, description: `Defeat ${boss.name}.`, status: 'open', log: [], addedAt: today });
  }

  toAdd.push({ id: 'exit-dungeon', name: `Escape ${dungeon.name}`, description: `Find a way out of ${dungeon.name}.`, status: 'open', log: [], addedAt: today });

  const merged = [...existingQuests];
  for (const quest of toAdd) {
    const existing = merged.find(q => q.id === quest.id);
    if (existing) existing.status = 'open';
    else merged.push(quest);
  }
  return merged;
}

// Combat-arena dungeon: one bare room sized for the encounter, no LLM calls — who spawns is
// already decided (the stat blocks), this only needs geometry to drop them into.
export function generateEncounterDungeon(statBlocks: EnemyStatBlock[]): Dungeon {
  const { cells, rooms } = generateGrid({ rooms: [{ name: 'Battle', size: 'large' }], structureType: 'organic', theme: 'high_fantasy', goals: [] });
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

  const legend = dungeon.rooms.map((r, i) => `${String.fromCharCode(65 + (i % 26))} = ${r.name}`).join('\n');
  const rows = dungeon.cells.map((row, y) =>
    row.map((cell, x) => {
      if (cell !== 1) return '-';
      const owner = ownerOf[y]![x]!;
      return owner === -1 ? '.' : String.fromCharCode(65 + (owner % 26));
    }).join('')
  );

  return `${legend}\n\n${rows.join('\n')}\n`;
}

// Server keeps the full dungeon (hidden entities included) in storage/memory —
// this strips anything not yet discovered before it goes out over the wire.
export function toClientDungeon(dungeon: Dungeon): Dungeon {
  return { ...dungeon, entities: dungeon.entities.filter(e => e.discovered) };
}

function roomAt(dungeon: Dungeon, gx: number, gy: number): DungeonRoom | undefined {
  return dungeon.rooms.find(r => gx >= r.x && gx < r.x + r.width && gy >= r.y && gy < r.y + r.height);
}

// Connector corridors between rooms are carved as raw floor cells (buildingLayout's corridorTo
// repair) and never get their own DungeonRoom entry, so a position mid-corridor has no exact room
// owner. Snap it to the nearest room by center distance instead of surfacing "an unmapped area".
function resolveRoom(dungeon: Dungeon, gx: number, gy: number): { room?: DungeonRoom; label: string } {
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

function entityStatus(e: DungeonEntity): string {
  return e.discovered ? 'discovered' : `undiscovered, hideDC ${e.hideDC ?? '?'}`;
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
  if (!byRoom.size) return '';

  const lines = [`Currently exploring: ${dungeon.name}`];
  for (const [roomName, players] of byRoom) {
    lines.push(`- ${players.join(', ')} in ${roomName}`);
    const room = dungeon.rooms.find(r => r.name === roomName);
    if (!room) continue;
    const here = dungeon.entities.filter(e => e.discovered && e.x >= room.x && e.x < room.x + room.width && e.y >= room.y && e.y < room.y + room.height);
    for (const e of here) lines.push(`  - already discovered here: ${e.name}`);
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
  }

  lines.push('Rooms:');
  for (const room of dungeon.rooms) {
    const kind = room.isHallway ? ' (hallway)' : '';
    const role = room.role ? ` (${room.role})` : '';
    const connects = room.connectsTo?.length ? ` — connects to: ${room.connectsTo.join(', ')}` : '';
    lines.push(`- ${room.name}${kind}${role}${connects}`);
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
