import { randomUUID } from 'crypto';
import type { Dungeon, DungeonRoom, EnemyStatBlock } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { fetchManifest } from './manifest.ts';
import { generateGrid } from './generator.ts';
import { generateOrganicGrid } from './organicGrid.ts';
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
  const { cells, rooms } = await generateOrganicGrid(manifest, adapter, opts, onToken);
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
  const { cells, rooms } = generateGrid({ rooms: [{ name: 'Battle', size: 'large' }] });
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
