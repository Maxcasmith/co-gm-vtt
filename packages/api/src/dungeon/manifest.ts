import type { EnemyStatBlock, DungeonMaterial, DungeonStylePack, DungeonStructureType, CreatureType } from 'shared';
import { DUNGEON_MATERIALS, DUNGEON_STYLE_PACKS, CREATURE_TYPES } from 'shared';
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
  material?: DungeonMaterial; // floor tile material for this room — clamped to DUNGEON_MATERIALS on parse
  isHallway?: boolean; // building layouts only — a passage/circulation room, not a destination
  connectsTo?: string[]; // building layouts only — names of other rooms in this manifest it directly opens onto
  description?: string; // 1-2 sentence read-aloud description, shown verbatim the moment a party first enters
}

export interface DungeonManifest {
  rooms: ManifestRoom[];
  structureType: DungeonStructureType;
  theme: DungeonStylePack; // dungeon-wide art style pack — clamped to DUNGEON_STYLE_PACKS on parse
  goals: string[]; // short narrative objectives for this dungeon — may be empty, never forced
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
  { name: 'Entrance', size: 'medium', role: 'entrance', material: 'wood' },
  { name: 'Guard Room', size: 'small', material: 'wood', creatures: [{ id: 'guard-1', name: 'Guard', cr: 0.25, hp: 11, ac: 12, speed: 30, stats: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, attacks: [{ name: 'Spear', bonus: 3, damage: '1d6+1' }], creatureType: 'Humanoid' }] },
  { name: 'Storage Room', size: 'small', material: 'wood', loot: [{ name: 'Supplies', hideDC: 8 }] },
  { name: 'Junction', size: 'small', material: 'wood' },
  { name: 'Vault', size: 'medium', material: 'wood', traps: [{ name: 'Trapped Chest', hideDC: 15 }], loot: [{ name: 'Treasure Chest', hideDC: 12 }] },
  { name: 'Inner Chamber', size: 'large', material: 'wood', creatures: [{ id: 'boss-1', name: 'Boss', cr: 1, hp: 27, ac: 14, speed: 30, stats: { str: 15, dex: 13, con: 14, int: 10, wis: 11, cha: 12 }, attacks: [{ name: 'Greatsword', bonus: 5, damage: '2d6+3' }], creatureType: 'Humanoid', isBoss: true }], role: 'exit' },
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
  if (isGeneric(name)) return { rooms: assignKeys(GENERIC_ROOMS), structureType: 'organic', theme: 'high_fantasy', goals: [] };

  const contextBlock = storyContext
    ? `\nRecent story context (what's actually happening — use this to decide what belongs in each room, not just the genre label):\n${storyContext}\n`
    : '';

  const [minRooms, maxRooms] = roomRange;
  const prompt = `You are a location architect. First decide whether "${name}" is a BUILDING (a man-made structure with an intentional floor plan — house, school, church, office, ship, station, mansion, prison, police precinct, etc.) or ORGANIC (a natural or crudely-dug space with no designed floor plan — cave, natural crypt, tomb carved into rock, sewer, ruins). This decision changes how you produce rooms below.

Return ONLY valid JSON, no markdown fences, no explanation:
{
  "structureType": "building|organic",
  "theme": "string — a short lowercase keyword for this location's overall art style/setting, e.g. high_fantasy. Pick whatever actually fits the genre; if nothing fits, use high_fantasy.",
  "rooms": [
    {
      "name": "string",
      "size": "small|medium|large",
      "role": "entrance|exit — omit for a normal room. Mark exactly as many entrance/exit rooms as make sense for this location (usually one of each, sometimes more).",
      "isHallway": "boolean — BUILDING ONLY. true if this room's job is passage/circulation (a corridor, hallway, stairwell) rather than being a destination in itself.",
      "connectsTo": "string[] — BUILDING ONLY, REQUIRED for every room. Names of the other rooms in THIS list that this room directly opens onto (a door or opening exists there). Every room must be reachable from the entrance room through this graph — no isolated rooms.",
      "material": "one of: ${DUNGEON_MATERIALS.join('|')} — floor material fitting this room's actual purpose (grass for an outdoor/dirt-floored space, wood for an indoor wood-floored room, stone for an indoor stone-floored room like a dungeon or crypt).",
      "description": "string — 1-2 sentence read-aloud description for the moment a party first steps into this room. Evocative, sensory, scene-setting. Never mention who is present or what they do — this text is shown verbatim regardless of which characters enter or when.",
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
  ],
  "goals": ["string — a short, concrete narrative objective for this dungeon, e.g. 'Find evidence of the ritual', 'Rescue the missing acolyte'"]
}

IF BUILDING: produce the ${minRooms}-${maxRooms} REAL rooms a location of this exact type would actually have — plain functional names only, never evocative or archaic diction (write "Chapel", never "Weeping Narthex"; write "Storage Closet", never "Sacristy of Moth-Eaten Vestments"). Reuse a letter/number suffix for repeated room types the way a real building would (e.g. "Classroom A".."Classroom E", "Boys Locker Room" / "Girls Locker Room"). Include hallway(s) as their own room(s) in the list whenever the building has more than a couple rooms — do not fold circulation space silently into other rooms. Every room needs "connectsTo".

IF ORGANIC: produce ${minRooms}-${maxRooms} rooms with location-authentic, atmospheric names fitting a natural/dug space (e.g. for a crypt: "Ossuary", "Collapsed Passage"). Omit "isHallway" and "connectsTo" entirely for organic rooms — layout is handled separately.

Omit "creatures"/"traps"/"loot" for rooms that don't have any — not every room needs them. Match creature types and stat blocks (use official 5e monster stat blocks as reference) to the genre. hideDC ranges 1-22 (higher = harder to spot); scale it to how well-concealed the trap/item narratively is. If the story context implies a non-hostile purpose (e.g. sneaking in to gather information), it's fine for rooms to have no creatures at all — don't force combat that doesn't fit.

At most ONE creature in the entire dungeon may have "isBoss": true — only set it when the scenario genuinely supports a climactic final threat (a named leader, the thing the story context is building toward). Leave every other creature without the field entirely; not every dungeon needs a boss.

"goals" (0-3 entries): concrete, player-facing narrative objectives specific to this location and story context — not generic filler like "explore the dungeon" or "defeat the boss" or "find the exit" (those are tracked separately by the game itself). Only include a goal when the story context actually motivates one; an empty array is correct for a dungeon with no specific narrative hook beyond exploring it.
${contextBlock}
Location: ${name}
Genre: ${dungeonType}`;

  try {
    const raw = await adapter.stream(prompt, onToken);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<DungeonManifest>;
    const structureType: DungeonStructureType = parsed.structureType === 'building' ? 'building' : 'organic';
    const rawTheme = typeof parsed.theme === 'string' ? parsed.theme.trim().toLowerCase() : '';
    const theme: DungeonStylePack = DUNGEON_STYLE_PACKS.includes(rawTheme as DungeonStylePack) ? (rawTheme as DungeonStylePack) : 'high_fantasy';
    let bossSeen = false;
    const rooms: ManifestRoom[] = (parsed.rooms?.length ? parsed.rooms : GENERIC_ROOMS).map(r => {
      const { material, creatures, ...rest } = r;
      const materialed = DUNGEON_MATERIALS.includes(material as DungeonMaterial) ? { ...rest, material: material as DungeonMaterial } : rest;
      if (!creatures?.length) return materialed;
      return {
        ...materialed,
        creatures: creatures.map(c => {
          // Trust the model for at most one boss dungeon-wide — anything past the first is downgraded
          // rather than dropped, so a model that over-marks doesn't lose the creature entirely.
          const isBoss = !!c.isBoss && !bossSeen;
          if (isBoss) bossSeen = true;
          const { isBoss: _rawIsBoss, ...normalized } = { ...c, creatureType: normalizeCreatureType(c.creatureType) };
          return isBoss ? { ...normalized, isBoss: true } : normalized;
        }),
      };
    });
    const goals = Array.isArray(parsed.goals) ? parsed.goals.filter((g): g is string => typeof g === 'string' && g.trim().length > 0) : [];
    return { rooms: assignKeys(rooms), structureType, theme, goals };
  } catch (err) {
    logError('dungeon/manifest:fetchManifest', err);
    return { rooms: assignKeys(GENERIC_ROOMS), structureType: 'organic', theme: 'high_fantasy', goals: [] };
  }
}
