import { randomUUID } from 'crypto';
import type { Dungeon, DungeonRoom, EnemyStatBlock } from 'shared';
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
  };
}

// Combat-arena dungeon: one bare room sized for the encounter, no LLM calls — who spawns is
// already decided (the stat blocks), this only needs geometry to drop them into.
export function generateEncounterDungeon(statBlocks: EnemyStatBlock[]): Dungeon {
  const { cells, rooms } = generateGrid({ rooms: [{ name: 'Battle', size: 'large' }], structureType: 'organic' });
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
export function describeDungeonGroundTruth(dungeon: Dungeon, positions: Record<string, { gx: number; gy: number }>): string {
  const lines = [`Full floor plan — ${dungeon.name} (ground truth, not what players have necessarily perceived):`];

  lines.push('Rooms:');
  for (const room of dungeon.rooms) {
    const kind = room.isHallway ? ', hallway' : '';
    const role = room.role ? `, ${room.role}` : '';
    const connects = room.connectsTo?.length ? ` — connects to: ${room.connectsTo.join(', ')}` : '';
    lines.push(`- ${room.name} (${room.x},${room.y} ${room.width}x${room.height}${kind}${role})${connects}`);
  }

  const byRoom = new Map<string, string[]>();
  for (const [name, pos] of Object.entries(positions)) {
    const room = roomAt(dungeon, pos.gx, pos.gy);
    const label = room ? room.name : 'an unmapped area';
    const names = byRoom.get(label) ?? [];
    names.push(`${name} at (${pos.gx},${pos.gy})`);
    byRoom.set(label, names);
  }
  lines.push('Player positions:');
  for (const [roomName, players] of byRoom) lines.push(`- ${players.join(', ')} in ${roomName}`);

  if (dungeon.entities.length) {
    lines.push('Entities (includes undiscovered — hideDC is the Perception/Investigation DC to spot it; never state an undiscovered entity outright in narration):');
    for (const e of dungeon.entities) {
      const room = roomAt(dungeon, e.x, e.y);
      const status = e.discovered ? 'discovered' : `undiscovered, hideDC ${e.hideDC ?? '?'}`;
      lines.push(`- ${e.name} (${e.type}) at (${e.x},${e.y}) in ${room?.name ?? 'an unmapped area'} — ${status}`);
    }
  }

  return lines.join('\n');
}
