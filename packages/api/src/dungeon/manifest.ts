import type { EnemyStatBlock, DungeonTheme, CreatureType } from 'shared';
import { DUNGEON_THEMES, CREATURE_TYPES } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { logError } from '../logger.ts';

export interface ManifestHazard {
  name: string;
  hideDC: number;
}

export interface ManifestRoom {
  name: string;
  size: 'small' | 'medium' | 'large';
  role?: 'entrance' | 'exit';
  creatures?: EnemyStatBlock[];
  traps?: ManifestHazard[];
  loot?: ManifestHazard[];
  key?: string; // single-char id for the organic grid prompt — assigned here, never left to the LLM
  theme?: DungeonTheme; // for procedural floor/wall/prop rendering — clamped to DUNGEON_THEMES on parse
  isHallway?: boolean; // building layouts only — a passage/circulation room, not a destination
  connectsTo?: string[]; // building layouts only — names of other rooms in this manifest it directly opens onto
}

export type StructureType = 'building' | 'organic';

export interface DungeonManifest {
  rooms: ManifestRoom[];
  structureType: StructureType;
}

// Single generic words get no LLM call — falls back to a hand-authored generic layout
const GENERIC_RE = /^(dungeon|cave|crypt|tomb|cavern|ruins|tunnel|maze|lair|cellar|basement)$/i;

function isGeneric(name: string): boolean {
  return GENERIC_RE.test(name.trim());
}

function normalizeCreatureType(t: unknown): CreatureType {
  return CREATURE_TYPES.includes(t as CreatureType) ? (t as CreatureType) : 'Humanoid';
}

const GENERIC_ROOMS: ManifestRoom[] = [
  { name: 'Entrance', size: 'medium', role: 'entrance', theme: 'stone' },
  { name: 'Guard Room', size: 'small', theme: 'armory', creatures: [{ id: 'guard-1', name: 'Guard', cr: 0.25, hp: 11, ac: 12, speed: 30, stats: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, attacks: [{ name: 'Spear', bonus: 3, damage: '1d6+1' }], creatureType: 'Humanoid' }] },
  { name: 'Storage Room', size: 'small', theme: 'stone', loot: [{ name: 'Supplies', hideDC: 8 }] },
  { name: 'Junction', size: 'small', theme: 'cave' },
  { name: 'Vault', size: 'medium', theme: 'stone', traps: [{ name: 'Trapped Chest', hideDC: 15 }], loot: [{ name: 'Treasure Chest', hideDC: 12 }] },
  { name: 'Inner Chamber', size: 'large', theme: 'throne', creatures: [{ id: 'boss-1', name: 'Boss', cr: 1, hp: 27, ac: 14, speed: 30, stats: { str: 15, dex: 13, con: 14, int: 10, wis: 11, cha: 12 }, attacks: [{ name: 'Greatsword', bonus: 5, damage: '2d6+3' }], creatureType: 'Humanoid' }], role: 'exit' },
];

// A-Z, deterministic — up to 26 rooms, well past the largest room range we ask for (20).
function assignKeys(rooms: ManifestRoom[]): ManifestRoom[] {
  return rooms.map((room, i) => ({ ...room, key: String.fromCharCode(65 + (i % 26)) }));
}

export async function fetchManifest(
  name: string,
  dungeonType: string,
  adapter: StoryProviderAdapter,
  storyContext = '',
  roomRange: [number, number] = [6, 10],
  onToken: (t: string) => void = () => {},
): Promise<DungeonManifest> {
  if (isGeneric(name)) return { rooms: assignKeys(GENERIC_ROOMS), structureType: 'organic' };

  const contextBlock = storyContext
    ? `\nRecent story context (what's actually happening — use this to decide what belongs in each room, not just the genre label):\n${storyContext}\n`
    : '';

  const [minRooms, maxRooms] = roomRange;
  const prompt = `You are a location architect. First decide whether "${name}" is a BUILDING (a man-made structure with an intentional floor plan — house, school, church, office, ship, station, mansion, prison, police precinct, etc.) or ORGANIC (a natural or crudely-dug space with no designed floor plan — cave, natural crypt, tomb carved into rock, sewer, ruins). This decision changes how you produce rooms below.

Return ONLY valid JSON, no markdown fences, no explanation:
{
  "structureType": "building|organic",
  "rooms": [
    {
      "name": "string",
      "size": "small|medium|large",
      "role": "entrance|exit — omit for a normal room. Mark exactly as many entrance/exit rooms as make sense for this location (usually one of each, sometimes more).",
      "isHallway": "boolean — BUILDING ONLY. true if this room's job is passage/circulation (a corridor, hallway, stairwell) rather than being a destination in itself.",
      "connectsTo": "string[] — BUILDING ONLY, REQUIRED for every room. Names of the other rooms in THIS list that this room directly opens onto (a door or opening exists there). Every room must be reachable from the entrance room through this graph — no isolated rooms.",
      "theme": "one of: ${DUNGEON_THEMES.join('|')} — pick whichever best fits this room's actual purpose. Keep themes consistent with one coherent setting across the whole location.",
      "creatures": [{
        "id": "string, unique per creature",
        "name": "string",
        "cr": 0.25,
        "hp": 11,
        "ac": 12,
        "speed": 30,
        "stats": { "str": 11, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 10 },
        "attacks": [{ "name": "string", "bonus": 3, "damage": "1d6+1" }],
        "creatureType": "one of: ${CREATURE_TYPES.join('|')}"
      }],
      "traps": [{ "name": "string — trap description", "hideDC": 14 }],
      "loot": [{ "name": "string — item or treasure", "hideDC": 8 }]
    }
  ]
}

IF BUILDING: produce the ${minRooms}-${maxRooms} REAL rooms a location of this exact type would actually have — plain functional names only, never evocative or archaic diction (write "Chapel", never "Weeping Narthex"; write "Storage Closet", never "Sacristy of Moth-Eaten Vestments"). Reuse a letter/number suffix for repeated room types the way a real building would (e.g. "Classroom A".."Classroom E", "Boys Locker Room" / "Girls Locker Room"). Include hallway(s) as their own room(s) in the list whenever the building has more than a couple rooms — do not fold circulation space silently into other rooms. Every room needs "connectsTo".

IF ORGANIC: produce ${minRooms}-${maxRooms} rooms with location-authentic, atmospheric names fitting a natural/dug space (e.g. for a crypt: "Ossuary", "Collapsed Passage"). Omit "isHallway" and "connectsTo" entirely for organic rooms — layout is handled separately.

Omit "creatures"/"traps"/"loot" for rooms that don't have any — not every room needs them. Match creature types and stat blocks (use official 5e monster stat blocks as reference) to the genre. hideDC ranges 1-22 (higher = harder to spot); scale it to how well-concealed the trap/item narratively is. If the story context implies a non-hostile purpose (e.g. sneaking in to gather information), it's fine for rooms to have no creatures at all — don't force combat that doesn't fit.
${contextBlock}
Location: ${name}
Genre: ${dungeonType}`;

  try {
    const raw = await adapter.stream(prompt, onToken);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<DungeonManifest>;
    const structureType: StructureType = parsed.structureType === 'building' ? 'building' : 'organic';
    const rooms: ManifestRoom[] = (parsed.rooms?.length ? parsed.rooms : GENERIC_ROOMS).map(r => {
      const { theme, creatures, ...rest } = r;
      const themed = DUNGEON_THEMES.includes(theme as DungeonTheme) ? { ...rest, theme: theme as DungeonTheme } : rest;
      if (!creatures?.length) return themed;
      return { ...themed, creatures: creatures.map(c => ({ ...c, creatureType: normalizeCreatureType(c.creatureType) })) };
    });
    return { rooms: assignKeys(rooms), structureType };
  } catch (err) {
    logError('dungeon/manifest:fetchManifest', err);
    return { rooms: assignKeys(GENERIC_ROOMS), structureType: 'organic' };
  }
}
