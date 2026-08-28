import { randomUUID } from 'crypto';
import type { AppConfig, Dungeon, DungeonEntity, DungeonRoom, EnemyStatBlock } from 'shared';
import { slugifyTheme } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { fetchManifest } from './manifest.ts';
import { generateGrid } from './generator.ts';
import { generateBuildingLayout } from './buildingLayout.ts';
import { placeEntities, placeEncounterEntities } from './placer.ts';
import { ensureTilesetSupport } from './tilesets.ts';
import { assignPortraitSrcs, generateCreaturePortraits } from './creaturePortraits.ts';
import { assignPropSpriteSrcs, generatePropSprites } from './props.ts';

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
     * these ARE dungeon.goals (set directly below, not whatever the manifest LLM call echoes back)
     * — the floor plan is designed to serve them, not invent its own on top. */
    predefinedQuests?: { name: string; description: string }[];
  },
  onToken: (t: string) => void = () => {},
  config?: AppConfig,
): Promise<Dungeon> {
  const manifest = await fetchManifest(name, dungeonType, adapter, storyContext, opts?.roomRange, opts?.partySize, opts?.partyLevel, onToken, opts?.predefinedQuests);
  // Man-made structures get a deterministic floor-plan layout driven by the manifest's adjacency
  // graph; natural/carved spaces (cave, crypt, tomb) go straight to the procedural row-packer —
  // no LLM geometry call, and no attempt to force building-shaped rooms onto a cave.
  const { cells, rooms, doors } = manifest.structureType === 'building'
    ? generateBuildingLayout(manifest, opts)
    : generateGrid(manifest, opts);
  const entities = placeEntities(rooms, manifest, cells);
  // Every carved doorway (building layouts only — organic spaces carve plain gaps, no literal
  // door fits the genre) becomes its own Door entity: closed, opaque, unlocked by default.
  for (const door of doors ?? []) {
    entities.push({
      id: randomUUID(), type: 'door', x: door.x, y: door.y, width: door.width, height: door.height,
      name: 'Door', discovered: true, doorState: 'closed', transparency: 0,
    });
  }
  // Synchronous/deterministic — every creature entity gets a portraitSrc before this function
  // returns, regardless of whether the file exists yet (see creaturePortraits.ts).
  assignPortraitSrcs(entities);
  // Same contract for decorative prop entities' spriteSrc — see props.ts.
  assignPropSpriteSrcs(entities);

  // Creatures never gate dungeon return — fired first, resolves in the background regardless of
  // how long tilesets/props take (errors caught/logged inside generateCreaturePortraits itself).
  if (config) void generateCreaturePortraits(entities, config);

  // Tilesets and props both must exist before the dungeon ships (the client draws them
  // synchronously — no background-fill/retry pattern like creature portraits get), so the dungeon
  // is paused behind these two. Fired together via Promise.all rather than sequentially, so their
  // atlas requests overlap instead of queueing one behind the other.
  const [tilesetSlug] = await Promise.all([
    config ? ensureTilesetSupport(manifest.theme, manifest.materials, config) : Promise.resolve(slugifyTheme(manifest.theme)),
    config ? generatePropSprites(manifest.props, config) : Promise.resolve(),
  ]);

  const dungeon: Dungeon = {
    id: opts?.id ?? randomUUID(),
    name,
    width: opts?.width ?? 50,
    height: opts?.height ?? 50,
    cells,
    rooms,
    entities,
    goals: manifest.goals,
    theme: manifest.theme,
    tilesetSlug,
    structureType: manifest.structureType,
    illumination: manifest.illumination,
    baseIllumination: manifest.illumination,
  };

  return dungeon;
}

// Combat-arena dungeon: one bare room sized for the encounter, no LLM calls — who spawns is
// already decided (the stat blocks), this only needs geometry to drop them into.
export function generateEncounterDungeon(statBlocks: EnemyStatBlock[]): Dungeon {
  const { cells, rooms } = generateGrid({ rooms: [{ name: 'Battle', size: 'large' }], structureType: 'organic', theme: 'high_fantasy', goals: [], illumination: 1, materials: [], props: [] });
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
export function toClientDungeon(dungeon: Dungeon): Dungeon {
  // Party-placed traps skip the discovered gate — you always know where your own trap is.
  return { ...dungeon, entities: dungeon.entities.filter(e => e.discovered || e.placedBy) };
}

export function roomAt(dungeon: Dungeon, gx: number, gy: number): DungeonRoom | undefined {
  return dungeon.rooms.find(r => gx >= r.x && gx < r.x + r.width && gy >= r.y && gy < r.y + r.height);
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
 * defeated creatures' own positions — see combat/runtime.ts's victory handler), not wherever the
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
  if (e.type === 'door') return `discovered — ${e.doorState ?? 'closed'}`;
  if (e.type === 'loot' && e.contents?.length) return `discovered — contains: ${e.contents.join(', ')}`;
  if (e.type === 'trap' && e.trap?.kind === 'seal' && e.trap.escapeDC) {
    return `discovered — sealed shut (DM eyes only, NEVER state this: resolves on a DC ${e.trap.escapeDC} ${e.trap.escapeSkill ?? 'Athletics'} check when a player attempts something that would plausibly force/bypass it)`;
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
    const kind = room.isHallway ? ' (hallway)' : '';
    const role = room.role ? ` (${room.role})` : '';
    const connects = room.connectsTo?.length ? ` — connects to: ${room.connectsTo.join(', ')}` : '';
    lines.push(`- ${room.name}${kind}${role}${connects}`);
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
