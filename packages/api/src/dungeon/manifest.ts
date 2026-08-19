import type { EnemyStatBlock, DungeonMaterialSpec, PropSpec, DungeonStylePack, DungeonStructureType, CreatureType } from 'shared';
import { CREATURE_TYPES, slugifyTheme } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { logError } from '../logger.ts';

export interface ManifestHazard {
  name: string;
  hideDC: number;
}

export interface ManifestProp {
  name: string;
  description: string; // visual description for the sprite generator — feeds buildPropSpritePrompt, never forwarded to DungeonRoom
  relX: number; // 0-1, position within the room's eventual bounding box (left-right) — clamped on parse
  relY: number; // 0-1, position within the room's eventual bounding box (top-bottom) — clamped on parse
  size: 'small' | 'medium' | 'large'; // footprint hint, mapped to grid cells by placer.ts
}

export interface ManifestRoom {
  name: string;
  size: 'small' | 'medium' | 'large';
  role?: 'entrance' | 'exit';
  creatures?: EnemyStatBlock[];
  traps?: ManifestHazard[];
  loot?: ManifestHazard[];
  props?: ManifestProp[];
  key?: string; // single-char id for the organic grid prompt — assigned here, never left to the LLM
  material?: string; // floor material key for this room — free-text, slugified on parse
  materialDescription?: string; // visual description of this room's texture — server-only, feeds the tileset prompt, never forwarded to DungeonRoom
  isHallway?: boolean; // building layouts only — a passage/circulation room, not a destination
  connectsTo?: string[]; // building layouts only — names of other rooms in this manifest it directly opens onto
  description?: string; // 1-2 sentence read-aloud description, shown verbatim the moment a party first enters
}

export interface DungeonManifest {
  rooms: ManifestRoom[];
  structureType: DungeonStructureType;
  theme: DungeonStylePack; // dungeon-wide art style/theme keyword — free-form, lowercased/trimmed on parse
  goals: string[]; // short narrative objectives for this dungeon — may be empty, never forced
  illumination: number; // 0-1 ambient light level for the whole location — clamped on parse
  materials: DungeonMaterialSpec[]; // deduped, first-seen-order floor materials this dungeon's rooms actually reference — up to 16, feeds the tileset generator
  props: PropSpec[]; // deduped, first-seen-order prop types this dungeon's rooms actually reference — up to 32, feeds the prop sprite generator
}

// Dedupes by normalized key (first-seen description wins), preserves first-seen order. The 16-item
// cap is primarily enforced by the manifest prompt itself (rooms are told to reuse keys); this
// slice is just a defensive backstop against a model that ignores the instruction.
function collectDungeonMaterials(rooms: ManifestRoom[]): DungeonMaterialSpec[] {
  const seen = new Map<string, string>();
  for (const room of rooms) {
    if (!room.material || seen.has(room.material)) continue;
    seen.set(room.material, room.materialDescription?.trim() || room.material);
  }
  return [...seen.entries()].slice(0, 16).map(([key, description]) => ({ key, description }));
}

// Same shape as collectDungeonMaterials — dedupes by normalized name (first-seen description
// wins), preserves first-seen order, caps at 32 (the prop sprite atlas's real-content limit; see
// dungeon/props.ts). The cap here is a defensive backstop, not the primary enforcement — the
// manifest prompt itself asks rooms to reuse names.
function collectDungeonProps(rooms: ManifestRoom[]): PropSpec[] {
  const seen = new Map<string, string>();
  for (const room of rooms) {
    for (const prop of room.props ?? []) {
      const key = slugifyTheme(prop.name);
      if (!key || seen.has(key)) continue;
      seen.set(key, prop.description?.trim() || prop.name);
    }
  }
  return [...seen.entries()].slice(0, 32).map(([key, description]) => ({ key, description }));
}

// Single generic words get no LLM call — falls back to a hand-authored generic layout
const GENERIC_RE = /^(dungeon|cave|crypt|tomb|cavern|ruins|tunnel|maze|lair|cellar|basement)$/i;

function isGeneric(name: string): boolean {
  return GENERIC_RE.test(name.trim());
}

function normalizeCreatureType(t: unknown): CreatureType {
  return CREATURE_TYPES.includes(t as CreatureType) ? (t as CreatureType) : 'Humanoid';
}

const PROP_SIZES = ['small', 'medium', 'large'] as const;

function normalizeProps(props: unknown): ManifestProp[] | undefined {
  if (!Array.isArray(props)) return undefined;
  const normalized = props
    .filter((p): p is ManifestProp => !!p && typeof p === 'object' && typeof (p as ManifestProp).name === 'string' && (p as ManifestProp).name.trim().length > 0)
    .map(p => ({
      name: p.name.trim(),
      description: typeof p.description === 'string' && p.description.trim() ? p.description.trim() : p.name.trim(),
      relX: typeof p.relX === 'number' && Number.isFinite(p.relX) ? Math.max(0, Math.min(1, p.relX)) : 0.5,
      relY: typeof p.relY === 'number' && Number.isFinite(p.relY) ? Math.max(0, Math.min(1, p.relY)) : 0.5,
      size: (PROP_SIZES as readonly string[]).includes(p.size) ? p.size : 'medium',
    }));
  return normalized.length ? normalized : undefined;
}

const GENERIC_WOOD_DESC = 'Worn wooden floor planks, warm honey-brown tone, faint grain, scattered scuffs.';

const GENERIC_ROOMS: ManifestRoom[] = [
  { name: 'Entrance', size: 'medium', role: 'entrance', material: 'wood', materialDescription: GENERIC_WOOD_DESC },
  { name: 'Guard Room', size: 'small', material: 'wood', materialDescription: GENERIC_WOOD_DESC, creatures: [{ id: 'guard-1', name: 'Guard', cr: 0.25, hp: 11, ac: 12, speed: 30, stats: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, attacks: [{ name: 'Spear', bonus: 3, damage: '1d6+1' }], creatureType: 'Humanoid', appearance: 'A weary human guard in scuffed leather armor, iron spear in hand, a plain steel cap pulled low.' }] },
  { name: 'Storage Room', size: 'small', material: 'wood', materialDescription: GENERIC_WOOD_DESC, loot: [{ name: 'Supplies', hideDC: 8 }] },
  { name: 'Junction', size: 'small', material: 'wood', materialDescription: GENERIC_WOOD_DESC },
  { name: 'Vault', size: 'medium', material: 'wood', materialDescription: GENERIC_WOOD_DESC, traps: [{ name: 'Trapped Chest', hideDC: 15 }], loot: [{ name: 'Treasure Chest', hideDC: 12 }] },
  { name: 'Inner Chamber', size: 'large', material: 'wood', materialDescription: GENERIC_WOOD_DESC, creatures: [{ id: 'boss-1', name: 'Boss', cr: 1, hp: 27, ac: 14, speed: 30, stats: { str: 15, dex: 13, con: 14, int: 10, wis: 11, cha: 12 }, attacks: [{ name: 'Greatsword', bonus: 5, damage: '2d6+3' }], creatureType: 'Humanoid', isBoss: true, appearance: 'A towering armored warlord, a notched greatsword resting on one shoulder, a battle-scarred face set in a cold glare.' }], role: 'exit' },
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
  partySize = 4,
  partyLevel = 1,
  onToken: (t: string) => void = () => {},
): Promise<DungeonManifest> {
  if (isGeneric(name)) return { rooms: assignKeys(GENERIC_ROOMS), structureType: 'organic', theme: 'high_fantasy', goals: [], illumination: 1, materials: collectDungeonMaterials(GENERIC_ROOMS), props: collectDungeonProps(GENERIC_ROOMS) };

  const contextBlock = storyContext
    ? `\nRecent story context (what's actually happening — use this to decide what belongs in each room, not just the genre label):\n${storyContext}\n`
    : '';

  const [minRooms, maxRooms] = roomRange;
  const prompt = `You are a location architect. First decide whether "${name}" is a BUILDING (a man-made structure with an intentional floor plan — house, school, church, office, ship, station, mansion, prison, police precinct, etc.) or ORGANIC (a natural or crudely-dug space with no designed floor plan — cave, natural crypt, tomb carved into rock, sewer, ruins). This decision changes how you produce rooms below.

Return ONLY valid JSON, no markdown fences, no explanation:
{
  "structureType": "building|organic",
  "theme": "string — a short lowercase keyword for this location's overall art style/setting, e.g. high_fantasy. Pick whatever actually fits the genre; if nothing fits, use high_fantasy.",
  "illumination": "number 0-1 — this location's ambient light level. 1 = well lit throughout (daylight, torches/lamps everywhere), 0.5 = dim (dusk, sparse torchlight, moonlight), 0 = pitch black (unlit cave/crypt, no ambient light source). Judge from what the location actually is, not from genre alone.",
  "rooms": [
    {
      "name": "string",
      "size": "small|medium|large",
      "role": "entrance|exit — omit for a normal room. Mark exactly as many entrance/exit rooms as make sense for this location (usually one of each, sometimes more).",
      "isHallway": "boolean — BUILDING ONLY. true if this room's job is passage/circulation (a corridor, hallway, stairwell) rather than being a destination in itself.",
      "connectsTo": "string[] — BUILDING ONLY, REQUIRED for every room. Names of the other rooms in THIS list that this room directly opens onto (a door or opening exists there). Every room must be reachable from the entrance room through this graph — no isolated rooms.",
      "material": "string — short lowercase key (1-2 words, e.g. wood, cracked-stone, wet-sand) naming this room's floor material, fitting its actual purpose (grass for an outdoor/dirt-floored space, wood for an indoor wood-floored room, stone for an indoor stone-floored room like a dungeon or crypt).",
      "materialDescription": "string — vivid visual description of this exact floor texture's appearance (color, wear, pattern) for an image generator. Reuse the EXACT SAME material key AND description verbatim across every room that should share the same texture (e.g. two plain-stone rooms both use key 'stone' with identical wording) rather than inventing near-duplicate keys for the same material — this dungeon may use AT MOST 16 distinct material keys in total across all rooms.",
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
        "creatureType": "one of: ${CREATURE_TYPES.join('|')}",
        "appearance": "string — 1-2 sentence physical description (build, coloring, notable features, worn/carried gear). No narrative framing, just what it looks like — this feeds an image generator, not the read-aloud text."
      }],
      "traps": [{ "name": "string — trap description", "hideDC": 14 }],
      "loot": [{ "name": "string — item or treasure", "hideDC": 8 }],
      "props": [{
        "name": "string — short name for a piece of furniture/decor in this room, e.g. 'Wooden Table', 'Iron Chest', 'Hay Bale'. Reuse the EXACT SAME name across every room that should share the same sprite (e.g. every plain wooden table in the dungeon uses the name 'Wooden Table') rather than inventing near-duplicate names for the same object — this dungeon may use AT MOST 32 distinct prop names in total across all rooms.",
        "description": "string — vivid visual description of this exact object's appearance (materials, color, wear, shape) for an image generator, isolated on its own with no scene/background. Reuse the EXACT SAME description verbatim wherever the name is reused.",
        "relX": "number 0-1 — this prop's position within the room, left(0) to right(1).",
        "relY": "number 0-1 — this prop's position within the room, top(0) to bottom(1).",
        "size": "small|medium|large — this object's rough footprint (small: a chest/barrel, medium: a table/bed, large: a bookshelf/altar/wagon)."
      }]
    }
  ],
  "goals": ["string — a short, concrete narrative objective for this dungeon, e.g. 'Find evidence of the ritual', 'Rescue the missing acolyte'"]
}

IF BUILDING: produce the ${minRooms}-${maxRooms} REAL rooms a location of this exact type would actually have — plain functional names only, never evocative or archaic diction (write "Chapel", never "Weeping Narthex"; write "Storage Closet", never "Sacristy of Moth-Eaten Vestments"). Reuse a letter/number suffix for repeated room types the way a real building would (e.g. "Classroom A".."Classroom E", "Boys Locker Room" / "Girls Locker Room"). Include hallway(s) as their own room(s) in the list whenever the building has more than a couple rooms — do not fold circulation space silently into other rooms. Every room needs "connectsTo".

IF ORGANIC: produce ${minRooms}-${maxRooms} rooms with location-authentic, atmospheric names fitting a natural/dug space (e.g. for a crypt: "Ossuary", "Collapsed Passage"). Omit "isHallway" and "connectsTo" entirely for organic rooms — layout is handled separately.

Omit "creatures"/"traps"/"loot"/"props" for rooms that don't have any — not every room needs them. Match creature types and stat blocks (use official 5e monster stat blocks as reference) to the genre. hideDC ranges 1-22 (higher = harder to spot); scale it to how well-concealed the trap/item narratively is. If the story context implies a non-hostile purpose (e.g. sneaking in to gather information), it's fine for rooms to have no creatures at all — don't force combat that doesn't fit.

Give most rooms 1-4 props fitting their function (a bedroom gets a bed and a dresser, a kitchen gets a stove and shelves) — this is what makes a room feel real, not empty. Skip props only for rooms that are genuinely bare (hallways, a stripped cell, a collapsed passage).

This dungeon is built for a party of ${partySize} level ${partyLevel} player characters. Scale creature counts and CRs per room to that party size and level using standard 5e encounter-building guidance — a larger party can handle more/tougher creatures per room, a smaller party needs fewer/weaker ones. The final room (or wherever the boss sits) should be a genuine threat for ${partySize} characters, not a single trivial monster.

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
    const theme: DungeonStylePack = rawTheme || 'high_fantasy';
    let bossSeen = false;
    const rooms: ManifestRoom[] = (parsed.rooms?.length ? parsed.rooms : GENERIC_ROOMS).map(r => {
      const { material, materialDescription, creatures, props, ...rest } = r;
      const materialed = typeof material === 'string' && material.trim()
        ? { ...rest, material: slugifyTheme(material), ...(typeof materialDescription === 'string' && materialDescription.trim() ? { materialDescription: materialDescription.trim() } : {}) }
        : rest;
      const normalizedProps = normalizeProps(props);
      const propped = normalizedProps ? { ...materialed, props: normalizedProps } : materialed;
      if (!creatures?.length) return propped;
      return {
        ...propped,
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
    const illumination = typeof parsed.illumination === 'number' && Number.isFinite(parsed.illumination) ? Math.max(0, Math.min(1, parsed.illumination)) : 1;
    return { rooms: assignKeys(rooms), structureType, theme, goals, illumination, materials: collectDungeonMaterials(rooms), props: collectDungeonProps(rooms) };
  } catch (err) {
    logError('dungeon/manifest:fetchManifest', err);
    return { rooms: assignKeys(GENERIC_ROOMS), structureType: 'organic', theme: 'high_fantasy', goals: [], illumination: 1, materials: collectDungeonMaterials(GENERIC_ROOMS), props: collectDungeonProps(GENERIC_ROOMS) };
  }
}
