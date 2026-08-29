import type { EnemyStatBlock, DungeonMaterialSpec, PropSpec, DungeonStylePack, DungeonStructureType, CreatureType, DungeonQuestStage, DungeonQuestTrigger, DungeonQuestTriggerKind } from 'shared';
import { CREATURE_TYPES, slugifyTheme } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { logError } from '../logger.ts';

export interface ManifestHazard {
  name: string;
  hideDC: number;
  /** loot only — the actual item(s) found inside, so the narrator has something concrete to reveal instead of inventing contents when it's opened. */
  contents?: string[];
}

export interface ManifestTrap {
  /** Pure flavor — what the party perceives. NEVER a DC, skill name, or method to beat it. */
  name: string;
  hideDC: number;
  kind: 'damage' | 'seal';
  // kind === 'damage' only:
  saveAbility?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  dc?: number;
  damageFormula?: string;
  damageType?: string;
  // kind === 'seal' only — hidden resolution mechanics, never echoed into `name`.
  escapeSkill?: string;
  escapeDC?: number;
  // Either kind — the Thieves' Tools DC to disarm this trap before it ever triggers. Guaranteed
  // present on the runtime TrapEffect regardless of whether the model supplies one — see
  // trapEffectFor's default-fill in placer.ts, same guarantee lockpickDC gets for doors.
  disarmDC?: number;
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
  traps?: ManifestTrap[];
  loot?: ManifestHazard[];
  props?: ManifestProp[];
  key?: string; // single-char id for the organic grid prompt — assigned here, never left to the LLM
  material?: string; // floor material key for this room — free-text, slugified on parse
  materialDescription?: string; // visual description of this room's texture — server-only, feeds the tileset prompt, never forwarded to DungeonRoom
  isHallway?: boolean; // building layouts only — a passage/circulation room, not a destination
  connectsTo?: string[]; // building layouts only — names of other rooms in this manifest it directly opens onto
  /**
   * Building layouts only — the lock state of the door(s) this room's connectsTo edges produce.
   * Only one side of an edge needs an entry; omitted entirely (or a given edge omitted `state`)
   * defaults to 'closed', matching pre-lock-feature behavior. 'locked' entries are validated in
   * fetchManifest against this dungeon's own loot names — an unresolvable keyName is downgraded
   * to 'closed' rather than shipped as an unopenable door. `lockpickDC` (locked only) is
   * default-filled if omitted — every locked door gets one either way. See buildingLayout.ts's
   * lockFor and dungeon/index.ts's requiresKeyId resolution.
   */
  doors?: { toRoom: string; state?: 'open' | 'closed' | 'locked'; keyName?: string; lockpickDC?: number }[];
  description?: string; // 1-2 sentence read-aloud description, shown verbatim the moment a party first enters
  dressing?: string[]; // ambient set-dressing, always visible, no image/discovery gate
  hiddenDressing?: { id: string; text: string; hideDC: number }[]; // set-dressing that needs a hard search — id assigned on parse, `discovered` added when converted to DungeonRoom
}

export interface DungeonManifest {
  rooms: ManifestRoom[];
  structureType: DungeonStructureType;
  theme: DungeonStylePack; // dungeon-wide art style/theme keyword — free-form, lowercased/trimmed on parse
  questChain: DungeonQuestStage[]; // ordered narrative quest chain for this dungeon — may be empty, never forced
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

function normalizeDressing(dressing: unknown): string[] | undefined {
  if (!Array.isArray(dressing)) return undefined;
  const normalized = dressing.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map(d => d.trim());
  return normalized.length ? normalized : undefined;
}

function normalizeHiddenDressing(roomIndex: number, hiddenDressing: unknown): { id: string; text: string; hideDC: number }[] | undefined {
  if (!Array.isArray(hiddenDressing)) return undefined;
  const normalized = hiddenDressing
    .filter((d): d is { text: string; hideDC: number } => !!d && typeof d === 'object' && typeof (d as { text?: unknown }).text === 'string' && (d as { text: string }).text.trim().length > 0)
    .map((d, i) => ({
      id: `room-${roomIndex}-hidden-dressing-${i}`,
      text: d.text.trim(),
      hideDC: typeof d.hideDC === 'number' && Number.isFinite(d.hideDC) ? Math.max(1, Math.min(22, d.hideDC)) : 14,
    }));
  return normalized.length ? normalized : undefined;
}

const GENERIC_WOOD_DESC = 'Worn wooden floor planks, warm honey-brown tone, faint grain, scattered scuffs.';

const GENERIC_ROOMS: ManifestRoom[] = [
  { name: 'Entrance', size: 'medium', role: 'entrance', material: 'wood', materialDescription: GENERIC_WOOD_DESC },
  { name: 'Guard Room', size: 'small', material: 'wood', materialDescription: GENERIC_WOOD_DESC, creatures: [{ id: 'guard-1', name: 'Guard', cr: 0.25, hp: 11, ac: 12, speed: 30, stats: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, attacks: [{ name: 'Spear', bonus: 3, damage: '1d6+1' }], creatureType: 'Humanoid', appearance: 'A weary human guard in scuffed leather armor, iron spear in hand, a plain steel cap pulled low.' }] },
  { name: 'Storage Room', size: 'small', material: 'wood', materialDescription: GENERIC_WOOD_DESC, loot: [{ name: 'Supplies', hideDC: 8, contents: ['a coil of rope', 'a half-empty waterskin'] }] },
  { name: 'Junction', size: 'small', material: 'wood', materialDescription: GENERIC_WOOD_DESC },
  { name: 'Vault', size: 'medium', material: 'wood', materialDescription: GENERIC_WOOD_DESC, traps: [{ name: 'Trapped Chest', hideDC: 15, kind: 'damage', saveAbility: 'dex', dc: 13, damageFormula: '1d4', damageType: 'Piercing' }], loot: [{ name: 'Treasure Chest', hideDC: 12, contents: ['a small pouch of gold coins'] }] },
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
  // Generated before this call (see session-processor's generateDungeonQuests) — this fixed opening
  // stage's id/name/description are set directly below regardless of what the model does, but it
  // has no `trigger` yet (nothing to reference — the rooms/entities it'd point at don't exist
  // until this very call creates them). The model decides stage 0's trigger AND authors the entire
  // rest of the chain (stages 1+) in the same response, so it's described in the prompt so the
  // floor plan is actually designed to serve it (a rescue stage needs a captive placed somewhere).
  predefinedChain: { id: string; name: string; description: string }[] = [],
): Promise<DungeonManifest> {
  if (isGeneric(name)) {
    // Test/debug dungeons never reach a real LLM call, so there's no way to author a trigger that
    // references this dungeon's actual (fixed, generic) content meaningfully — exit_dungeon is the
    // one trigger guaranteed to eventually fire regardless of what the stage is nominally about.
    const questChain: DungeonQuestStage[] = predefinedChain.map(s => ({ ...s, trigger: { kind: 'exit_dungeon' } }));
    return { rooms: assignKeys(GENERIC_ROOMS), structureType: 'organic', theme: 'high_fantasy', questChain, illumination: 1, materials: collectDungeonMaterials(GENERIC_ROOMS), props: collectDungeonProps(GENERIC_ROOMS) };
  }

  const contextBlock = storyContext
    ? `\nRecent story context (what's actually happening — use this to decide what belongs in each room, not just the genre label):\n${storyContext}\n`
    : '';
  const questsBlock = predefinedChain.length
    ? `\nThis dungeon's opening quest stage is already decided — do not invent a different one, and design rooms, creatures, and loot to actually serve it (a "rescue" stage needs a captive placed somewhere; a "retrieve X" stage needs X seeded as loot). Its id/name/description are fixed; YOU decide its "trigger" (below) plus every stage that follows it:\n${predefinedChain.map(q => `- ${q.id} — ${q.name}: ${q.description}`).join('\n')}\n`
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
      "doors": [{ "toRoom": "string — BUILDING ONLY, one of this room's connectsTo names. Only declare an entry for an edge that ISN'T a plain open doorway — omit connectsTo edges you want left as ordinary unlocked doors entirely.", "state": "closed|locked — 'closed' is an ordinary shut-but-unlocked door (this is already the default for every connectsTo edge, so only write 'closed' here if you want to say so explicitly). 'locked' REQUIRES keyName.", "keyName": "string — 'locked' only. Must be the EXACT \"name\" of a loot entry placed somewhere in THIS response, ideally in a different room than either side of this door. That loot entry is the key — it is always trivially found (no hard search) once discovered.", "lockpickDC": "number 10-20 — 'locked' only. The DC to bypass this specific lock with Thieves' Tools instead of the key, scaled to how sturdy/important it is. Never hinted at anywhere in room text, same discipline as a trap's hidden DC." }],
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
      "traps": [{
        "name": "string — pure sensory/flavor description of the trap. NEVER include a DC, a skill name, or how to beat it — e.g. write 'a swollen door with a rusted latch', never 'a swollen door (DC 14 Athletics to force)'.",
        "hideDC": 14,
        "kind": "damage|seal — 'damage' actually hurts whoever triggers it (a blade, a dart, a fall). 'seal' does NOT deal damage — it's an environmental consequence like a door slamming shut or an alarm sounding, meant to be worked around, not survived.",
        "saveAbility": "str|dex|con|int|wis|cha — kind:'damage' only, whichever ability makes sense for dodging/resisting it",
        "dc": "number — kind:'damage' only, the save DC",
        "damageFormula": "string, e.g. '2d10' — kind:'damage' only, scale it to the party's level, not always the maximum",
        "damageType": "string, e.g. Piercing — kind:'damage' only",
        "escapeSkill": "string, e.g. Athletics — kind:'seal' only, the skill that would resolve the consequence",
        "escapeDC": "number — kind:'seal' only, the DC for escapeSkill",
        "disarmDC": "number 10-20 — either kind. The Thieves' Tools DC to neutralize this trap before it ever triggers (a Trap Disarm Kit rolls against this). Scale it to how well-hidden/dangerous the trap is. Never hinted at anywhere, same discipline as escapeDC."
      }],
      "loot": [{ "name": "string — the container or where it's found, e.g. 'Treasure Chest', 'Loose Floorboard'", "hideDC": 8, "contents": ["string — a specific item actually inside, e.g. '15 gold pieces', 'a silver locket'. 1-3 entries. This is the ONLY source of truth for what's in it — nothing else gets improvised when a player opens it."] }],
      "props": [{
        "name": "string — short name for a piece of furniture/decor in this room, e.g. 'Wooden Table', 'Iron Chest', 'Hay Bale'. Reuse the EXACT SAME name across every room that should share the same sprite (e.g. every plain wooden table in the dungeon uses the name 'Wooden Table') rather than inventing near-duplicate names for the same object — this dungeon may use AT MOST 32 distinct prop names in total across all rooms.",
        "description": "string — vivid visual description of this exact object's appearance (materials, color, wear, shape) for an image generator, isolated on its own with no scene/background. Reuse the EXACT SAME description verbatim wherever the name is reused.",
        "relX": "number 0-1 — this prop's position within the room, left(0) to right(1).",
        "relY": "number 0-1 — this prop's position within the room, top(0) to bottom(1).",
        "size": "small|medium|large — this object's rough footprint (small: a chest/barrel, medium: a table/bed, large: a bookshelf/altar/wagon)."
      }],
      "dressing": ["string — a short ambient sensory or set-dressing detail, always visible the instant a party enters (no roll needed, no sprite generated). E.g. 'Cold draft from a cracked window', 'Faint smell of tallow smoke', 'Scorch marks streak the ceiling.'"],
      "hiddenDressing": [{
        "text": "string — a set-dressing detail that needs a hard search to notice (nothing worth a full loot/trap entry, but not ambient either — e.g. a faded symbol scratched under a shelf, a second set of footprints in the dust).",
        "hideDC": 14
      }]
    }
  ],
  "questChain": [
    {
      "id": "kebab-slug, unique",
      "name": "Short, evocative quest title (2-6 words) — a proper name for the stage, not a restatement of its description, e.g. 'The Cellar Key', 'Silence the Ritual'.",
      "description": "2-3 short bullet points, one per line, each starting with '- ' — concrete, distinct beats of what the party needs to do for this stage specifically.",
      "trigger": {
        "kind": "enter_room|discover_entity|defeat_boss|exit_dungeon — what mechanically resolves this stage and advances to the next one.",
        "roomName": "enter_room ONLY — must be the EXACT \"name\" of one of the rooms in \"rooms\" above.",
        "entityName": "discover_entity ONLY — must be the EXACT \"name\" of a creature/loot/trap/prop nested inside one of the rooms above."
      }
    }
  ]
}

IF BUILDING: produce the ${minRooms}-${maxRooms} REAL rooms a location of this exact type would actually have — plain functional names only, never evocative or archaic diction (write "Chapel", never "Weeping Narthex"; write "Storage Closet", never "Sacristy of Moth-Eaten Vestments"). Reuse a letter/number suffix for repeated room types the way a real building would (e.g. "Classroom A".."Classroom E", "Boys Locker Room" / "Girls Locker Room"). Include hallway(s) as their own room(s) in the list whenever the building has more than a couple rooms — do not fold circulation space silently into other rooms. Every room needs "connectsTo".

IF ORGANIC: produce ${minRooms}-${maxRooms} rooms with location-authentic, atmospheric names fitting a natural/dug space (e.g. for a crypt: "Ossuary", "Collapsed Passage"). Omit "isHallway" and "connectsTo" entirely for organic rooms — layout is handled separately.

Omit "creatures"/"traps"/"loot"/"props" for rooms that don't have any — not every room needs them. Match creature types and stat blocks (use official 5e monster stat blocks as reference) to the genre. hideDC ranges 1-22 (higher = harder to spot); scale it to how well-concealed the trap/item narratively is. If the story context implies a non-hostile purpose (e.g. sneaking in to gather information), it's fine for rooms to have no creatures at all — don't force combat that doesn't fit.
Most traps should be "seal" kind, not "damage" — an environmental obstacle (a door that slams shut, a passage that collapses, an alarm) makes for better play than a random damage roll on discovery. Reach for "damage" only when the trap's whole concept is physically hurting whoever sets it off (a dart trap, a pressure-plate blade). Never let "name" hint at the DC or the way past it — that's the players' problem to solve, not something you hand them.

Give most rooms 1-4 props fitting their function (a bedroom gets a bed and a dresser, a kitchen gets a stove and shelves) — this is what makes a room feel real, not empty. Skip props only for rooms that are genuinely bare (hallways, a stripped cell, a collapsed passage).

Give most rooms 2-5 "dressing" entries and, where it fits, 0-2 "hiddenDressing" entries — mundane, concrete sensory texture (temperature, smell, sound, wear, small clutter) that makes the room feel inhabited without needing an image or a stat block. Dressing must never imply a named person, faction, event, or plot thread that isn't already established by the story context or "questChain" below — an unresolvable hint left dangling in a dungeon with no way to follow up on it misleads the players, it's not atmosphere. "Scorch marks on the ceiling" is fine anywhere; "scorch marks matching the Ashcult's ritual brand" is only fine if the Ashcult is actually part of this dungeon's story context.

This dungeon is built for a party of ${partySize} level ${partyLevel} player characters. Scale creature counts and CRs per room to that party size and level using standard 5e encounter-building guidance — a larger party can handle more/tougher creatures per room, a smaller party needs fewer/weaker ones. The final room (or wherever the boss sits) should be a genuine threat for ${partySize} characters, not a single trivial monster.

At most ONE creature in the entire dungeon may have "isBoss": true — only set it when the scenario genuinely supports a climactic final threat (a named leader, the thing the story context is building toward). Leave every other creature without the field entirely; not every dungeon needs a boss.

"questChain" (0+ stages, ordered — this is the sequence a party actually plays through, not a flat wishlist): a mutating quest, each stage replacing the last as it resolves. Design the ROOMS/CREATURES/LOOT above and this CHAIN together, as one coherent plan — a stage's trigger must reference something you actually placed (a real room name, or a real creature/loot/trap/prop name), never something invented only in the quest text. "defeat_boss" is only valid if you actually set a creature "isBoss": true above. Keep stages concrete and distinct from each other — never generic filler like "explore the dungeon" or "find the exit" as their own stage (a real "escape" stage should mean something specific happened first: supplies gathered, a threat that wasn't there before). An empty array is correct for a dungeon with no specific narrative hook beyond exploring it — do not force a chain onto a location the story context gives no reason to want one for.

"doors" (BUILDING ONLY) is where you gate a connectsTo edge instead of leaving it a plain doorway — use it deliberately, tied to the chain above, not scattered at random (a good use: an early "enter_room" stage's target room is "locked" so the party needs the earlier stage's key first; most edges should stay plain doorways with no "doors" entry at all). Whenever you write a "locked" entry, its keyName's loot item must actually be reachable — place it somewhere the party can get to WITHOUT needing to go through this same locked door, and never behind a second lock whose own key sits behind this one (no circular locks). A key is always trivially found once its loot is discovered, so don't hesitate to place it plainly — the difficulty is in finding the room, not in the search roll once there.
${questsBlock}${contextBlock}
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
    const rooms: ManifestRoom[] = (parsed.rooms?.length ? parsed.rooms : GENERIC_ROOMS).map((r, i) => {
      const { material, materialDescription, creatures, props, dressing, hiddenDressing, ...rest } = r;
      const materialed = typeof material === 'string' && material.trim()
        ? { ...rest, material: slugifyTheme(material), ...(typeof materialDescription === 'string' && materialDescription.trim() ? { materialDescription: materialDescription.trim() } : {}) }
        : rest;
      const normalizedProps = normalizeProps(props);
      const propped = normalizedProps ? { ...materialed, props: normalizedProps } : materialed;
      const normalizedDressing = normalizeDressing(dressing);
      const dressed = normalizedDressing ? { ...propped, dressing: normalizedDressing } : propped;
      const normalizedHiddenDressing = normalizeHiddenDressing(i, hiddenDressing);
      const hiddenDressed = normalizedHiddenDressing ? { ...dressed, hiddenDressing: normalizedHiddenDressing } : dressed;
      if (!creatures?.length) return hiddenDressed;
      return {
        ...hiddenDressed,
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
    const lockedRooms = resolveDoorLocks(rooms);
    const roomNames = new Set(lockedRooms.map(r => r.name));
    const entityNames = new Set(lockedRooms.flatMap(r => [
      ...(r.creatures ?? []).map(c => c.name),
      ...(r.loot ?? []).map(l => l.name),
      ...(r.traps ?? []).map(t => t.name),
      ...(r.props ?? []).map(p => p.name),
    ]));
    const questChain = parseQuestChain(parsed.questChain, predefinedChain, roomNames, entityNames, bossSeen);
    const illumination = typeof parsed.illumination === 'number' && Number.isFinite(parsed.illumination) ? Math.max(0, Math.min(1, parsed.illumination)) : 1;
    return { rooms: assignKeys(lockedRooms), structureType, theme, questChain, illumination, materials: collectDungeonMaterials(lockedRooms), props: collectDungeonProps(lockedRooms) };
  } catch (err) {
    logError('dungeon/manifest:fetchManifest', err);
    const questChain: DungeonQuestStage[] = predefinedChain.map(s => ({ ...s, trigger: { kind: 'exit_dungeon' } }));
    return { rooms: assignKeys(GENERIC_ROOMS), structureType: 'organic', theme: 'high_fantasy', questChain, illumination: 1, materials: collectDungeonMaterials(GENERIC_ROOMS), props: collectDungeonProps(GENERIC_ROOMS) };
  }
}

const VALID_TRIGGER_KINDS: readonly DungeonQuestTriggerKind[] = ['enter_room', 'discover_entity', 'defeat_boss', 'exit_dungeon'];

// Validates the model's proposed chain against what it actually placed in this same response —
// a stage whose trigger references a room/entity name that doesn't exist (or a defeat_boss stage
// when no creature was marked isBoss) is dropped rather than repaired, same conservative-parsing
// convention the rest of this file uses. predefinedChain[0]'s id/name/description are authoritative
// (see fetchManifest's predefinedChain param doc) — only its trigger comes from the model, since
// nothing existed to reference when that stage's text was decided; falls back to exit_dungeon
// (always eventually true) rather than ever silently dropping the upfront quest.
function parseQuestChain(
  raw: unknown,
  predefinedChain: { id: string; name: string; description: string }[],
  roomNames: Set<string>,
  entityNames: Set<string>,
  hasBoss: boolean,
): DungeonQuestStage[] {
  const rawStages = Array.isArray(raw) ? raw as Partial<DungeonQuestStage>[] : [];
  const seenIds = new Set<string>();
  const parsedStages: DungeonQuestStage[] = [];
  for (const s of rawStages) {
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    const description = typeof s.description === 'string' ? s.description.trim() : '';
    const trigger = s.trigger;
    if (!id || !name || !description || !trigger || seenIds.has(id)) continue;
    const kind = trigger.kind;
    if (!VALID_TRIGGER_KINDS.includes(kind)) continue;
    const roomName = typeof trigger.roomName === 'string' ? trigger.roomName : undefined;
    const entityName = typeof trigger.entityName === 'string' ? trigger.entityName : undefined;
    if (kind === 'enter_room' && !(roomName && roomNames.has(roomName))) continue;
    if (kind === 'discover_entity' && !(entityName && entityNames.has(entityName))) continue;
    if (kind === 'defeat_boss' && !hasBoss) continue;
    seenIds.add(id);
    const cleanTrigger: DungeonQuestTrigger = kind === 'enter_room' ? { kind, roomName: roomName! }
      : kind === 'discover_entity' ? { kind, entityName: entityName! }
      : { kind };
    parsedStages.push({ id, name, description, trigger: cleanTrigger });
  }
  if (!predefinedChain.length) return parsedStages;

  const seed = predefinedChain[0]!;
  const matched = parsedStages.find(s => s.id === seed.id);
  const seedStage: DungeonQuestStage = { id: seed.id, name: seed.name, description: seed.description, trigger: matched?.trigger ?? { kind: 'exit_dungeon' } };
  return [seedStage, ...parsedStages.filter(s => s.id !== seed.id)];
}

const VALID_DOOR_STATES: readonly ('open' | 'closed' | 'locked')[] = ['open', 'closed', 'locked'];

// Every locked door not otherwise given one gets this Thieves' Tools DC — "every locked door has
// a lockpick DC" is a hard guarantee, not something the model can skip by omission.
const DEFAULT_LOCKPICK_DC = 15;

// Validates every room's `doors` entries the same conservative way as parseQuestChain: an entry
// pointing at a room that doesn't exist is dropped outright; a 'locked' entry whose keyName
// doesn't match a real loot item anywhere in this dungeon is downgraded to 'closed' rather than
// shipped as a door nothing can ever open. Every loot item that DOES end up as a real key has its
// hideDC forced to -99 here — a key is never gated behind a hard search, regardless of whatever
// the model proposed for it. Every door that stays 'locked' gets a valid lockpickDC either way.
export function resolveDoorLocks(rooms: ManifestRoom[]): ManifestRoom[] {
  const roomNames = new Set(rooms.map(r => r.name));
  const lootNames = new Set(rooms.flatMap(r => (r.loot ?? []).map(l => l.name)));

  const keysUsed = new Set<string>();
  const fixedRooms = rooms.map(r => {
    if (!r.doors?.length) return r;
    const doors = r.doors
      .filter(d => typeof d.toRoom === 'string' && roomNames.has(d.toRoom))
      .map(d => {
        const state = VALID_DOOR_STATES.includes(d.state!) ? d.state! : 'closed';
        if (state !== 'locked') return { toRoom: d.toRoom, state };
        if (typeof d.keyName !== 'string' || !lootNames.has(d.keyName)) return { toRoom: d.toRoom, state: 'closed' as const };
        keysUsed.add(d.keyName);
        const lockpickDC = typeof d.lockpickDC === 'number' && Number.isFinite(d.lockpickDC) ? Math.max(1, Math.min(30, Math.round(d.lockpickDC))) : DEFAULT_LOCKPICK_DC;
        return { toRoom: d.toRoom, state, keyName: d.keyName, lockpickDC };
      });
    return { ...r, doors };
  });

  if (!keysUsed.size) return fixedRooms;
  return fixedRooms.map(r => {
    if (!r.loot?.some(l => keysUsed.has(l.name))) return r;
    return { ...r, loot: r.loot.map(l => keysUsed.has(l.name) ? { ...l, hideDC: -99 } : l) };
  });
}
