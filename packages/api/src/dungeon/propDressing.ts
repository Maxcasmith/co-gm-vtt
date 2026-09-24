import type { CampaignGenre, DungeonRoom, PropCategory, PropCatalogueEntry, PropCategoryMap, PropSpec, PropZone, RoomProp } from 'shared';
import { PROP_CATEGORIES, PROP_ZONES, WALL_MOUNTED_CATEGORIES, propSizeXY, slugifyTheme } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import type { ManifestRoom } from './manifest.ts';
import { buildPropNounBlock } from './propCatalogue.ts';
import { logDebug, logError } from '../logger.ts';

/** The prop sprite atlas's real-content limit (see props.ts's REAL_CAP) — a dungeon may introduce
 * at most this many DISTINCT types. Instances are unlimited and free: 30 booths is one type. */
const MAX_PROP_TYPES = 32;

/** Floor cells per prop. A 13x13 room (~169 cells, the largest generateGrid produces) lands around
 * 28 props, a 4x4 closet around 3 — which is what a furnished room actually looks like from above.
 * The old prompt asked for "1-4 props" per room regardless of size, which is where the two-booth
 * diner came from. */
const CELLS_PER_PROP = 6;
const MIN_PROPS_PER_ROOM = 2;
const MAX_PROPS_PER_ROOM = 40;

export interface PropPlan {
  /** Dungeon-wide distinct prop types — feeds the catalogue lookup and the sprite generator. */
  props: PropSpec[];
  /** Room name -> what that room wants and where. Keyed by name to match ManifestRoom/DungeonRoom. */
  byRoom: Map<string, RoomProp[]>;
}

export const EMPTY_PROP_PLAN: PropPlan = { props: [], byRoom: new Map() };

function floorCells(room: DungeonRoom, cells: number[][]): number {
  let count = 0;
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (cells[y]?.[x] === 1) count++;
    }
  }
  return count;
}

/** Target prop count for one room, from its ACTUAL carved floor area rather than the manifest's
 * 'small|medium|large' label — an irregular organic room can be far smaller than its bounding box. */
export function propTargetFor(room: DungeonRoom, cells: number[][]): number {
  const area = floorCells(room, cells);
  return Math.max(MIN_PROPS_PER_ROOM, Math.min(MAX_PROPS_PER_ROOM, Math.round(area / CELLS_PER_PROP)));
}

/** The categories a prop may actually be — everything that stands on the floor. */
export const FLOOR_PROP_CATEGORIES = PROP_CATEGORIES.filter(c => !WALL_MOUNTED_CATEGORIES.includes(c));

function normalizeCategory(c: unknown): PropCategory {
  return (FLOOR_PROP_CATEGORIES as readonly unknown[]).includes(c) ? (c as PropCategory) : 'decor';
}

function normalizeZone(z: unknown): PropZone {
  return (PROP_ZONES as readonly unknown[]).includes(z) ? (z as PropZone) : 'floor';
}

// 1-6 cells per axis. The floor keeps a small object from collapsing to nothing; the ceiling stops
// a hallucinated 100-cell table from swallowing a room. Both ends are defensive only — real
// furniture sits well inside them, and the largest room is 13 cells across.
function normalizeAxis(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(6, Math.round(v))) : 1;
}

function normalizeSize(v: unknown): [number, number] {
  return Array.isArray(v) ? [normalizeAxis(v[0]), normalizeAxis(v[1])] : [1, 1];
}

interface RawPropPlan {
  props?: { prop?: unknown; category?: unknown; description?: unknown; sizeXY?: unknown }[];
  rooms?: { name?: unknown; props?: { prop?: unknown; count?: unknown; zone?: unknown }[] }[];
}

/**
 * Parses and normalizes the dressing call's JSON. Pure, so the whole contract — dimension clamping,
 * catalogue dimensions winning over the model's, and the drop of any room request naming a prop that
 * was never declared — is checkable without an LLM (see propDressing.selfcheck.ts).
 *
 * `catalogue` is this campaign's bucket: when a noun already has art, its RECORDED dimensions win
 * over whatever the model just said. Otherwise the same `crate` would be 3ft wide in one dungeon and
 * 6ft in the next while sharing one sprite, and the sprite is drawn to one fixed aspect ratio.
 */
export function parsePropPlan(raw: RawPropPlan, catalogue: PropCategoryMap): PropPlan {
  const props: PropSpec[] = [];
  const seen = new Set<string>();

  for (const p of raw.props ?? []) {
    const noun = typeof p.prop === 'string' ? slugifyTheme(p.prop) : '';
    if (!noun || seen.has(noun) || props.length >= MAX_PROP_TYPES) continue;
    const category = normalizeCategory(p.category);
    const existing: PropCatalogueEntry | undefined = catalogue[category]?.[noun];
    seen.add(noun);
    props.push({
      noun,
      category,
      description: typeof p.description === 'string' && p.description.trim() ? p.description.trim() : noun.replace(/-/g, ' '),
      sizeXY: (existing && propSizeXY(existing)) ?? normalizeSize(p.sizeXY),
    });
  }

  const byRoom = new Map<string, RoomProp[]>();
  for (const room of raw.rooms ?? []) {
    const name = typeof room.name === 'string' ? room.name.trim() : '';
    if (!name) continue;
    const requests: RoomProp[] = [];
    for (const r of room.props ?? []) {
      const noun = typeof r.prop === 'string' ? slugifyTheme(r.prop) : '';
      // A request for a type that was never declared has no description and no dimensions, so it
      // can neither be drawn nor sized — dropped rather than guessed at.
      if (!noun || !seen.has(noun)) continue;
      const count = typeof r.count === 'number' && Number.isFinite(r.count) ? Math.max(1, Math.min(MAX_PROPS_PER_ROOM, Math.round(r.count))) : 1;
      requests.push({ noun, count, zone: normalizeZone(r.zone) });
    }
    if (requests.length) byRoom.set(name, requests);
  }

  return { props, byRoom };
}

/**
 * Pass 2 of dungeon generation: decides what furniture actually fills each room, and how much.
 *
 * Split out of the manifest call deliberately. The manifest response already carries rooms,
 * stat blocks, traps, loot, doors and a quest chain; asking it for twenty-odd props per room on top
 * of that is why rooms came back with a booth, a second booth, and a jukebox. This call spends its
 * whole budget on clutter, and it runs after the layout so it can be told each room's real size.
 *
 * Never throws — a failure returns an empty plan, which renders exactly like a dungeon generated
 * before props existed.
 */
export async function generatePropDressing(
  rooms: DungeonRoom[],
  manifestRooms: ManifestRoom[],
  cells: number[][],
  theme: string,
  adapter: StoryProviderAdapter,
  catalogue: PropCategoryMap,
  genre?: CampaignGenre,
  onToken: (t: string) => void = () => {},
): Promise<PropPlan> {
  const categoriesByRoom = new Map(manifestRooms.map(r => [r.name, r.propCategories ?? []]));
  // Stairwells are a fixed 2x2 passage whose whole footprint is taken by the stairs entity — the
  // placer drops anything put there, so asking for props at all would be paying for sprites nobody
  // can see (same exclusion placeEntities already makes).
  //
  // Everything else IS dressed, with or without categories. propCategories only narrows which slice
  // of the catalogue this call is shown; treating it as a prerequisite made one optional field the
  // model might not emit into an all-or-nothing gate on the entire feature — which is exactly how
  // an 18-room dungeon came back with no furniture at all and nothing logged. A room with no
  // categories is dressed against the whole bucket instead, which is also what happens on a brand
  // new catalogue, where there is nothing to narrow.
  const dressable = rooms.filter(r => !r.isStairwell);
  if (!dressable.length) return EMPTY_PROP_PLAN;

  const wanted = [...new Set(dressable.flatMap(r => categoriesByRoom.get(r.name) ?? []))];
  const withCategories = dressable.filter(r => (categoriesByRoom.get(r.name) ?? []).length > 0).length;
  logDebug(`prop dressing: ${dressable.length} rooms (${withCategories} with categories), ${wanted.length} categories, catalogue has ${Object.keys(catalogue).length}`);
  const nounBlock = buildPropNounBlock(catalogue, wanted);
  const toneLine = genre ? `This is a ${genre.setting} setting with a ${genre.tone} tone — every prop's description must read that way (a ${genre.tone} table is not a neutral one).` : '';

  const roomLines = dressable.map(r => {
    const categories = (categoriesByRoom.get(r.name) ?? []).join(', ');
    const target = propTargetFor(r, cells);
    const manifestRoom = manifestRooms.find(m => m.name === r.name);
    const description = manifestRoom?.description ?? '';
    // The dressing lines are the densest prop brief we have — the manifest call already named the
    // concrete objects ("several car doors hang open", "a paper cup blows across the asphalt") while
    // it had the room's whole design in context. Categories say which SHELF of the catalogue to look
    // at; these say what is actually standing there. Without them "vehicle, signage, lighting" is a
    // furniture department, not a parking lot.
    const dressing = manifestRoom?.dressing ?? [];
    return `- "${r.name}" — ${r.width}x${r.height} cells (${r.width * 5}ft x ${r.height * 5}ft). ${categories ? `Categories: ${categories}. ` : ''}Target: about ${target} props total.${description ? ` The room: ${description}` : ''}${dressing.length ? `\n  Details already established here: ${dressing.map(d => `"${d}"`).join('; ')}` : ''}`;
  }).join('\n');

  const prompt = `You are furnishing the rooms of a "${theme}" location for a top-down tabletop map. Return ONLY valid JSON, no markdown fences, no explanation:
{
  "props": [{
    "prop": "string — kebab-case name for ONE type of object, e.g. diner-booth, wooden-crate, helm-console. Declare each type ONCE here no matter how many rooms use it or how many copies exist.",
    "category": "one of: ${FLOOR_PROP_CATEGORIES.join('|')}",
    "description": "string — vivid visual description of this object seen FROM DIRECTLY ABOVE (its top surface, materials, colour, wear), isolated with no background or scenery. This feeds an image generator.",
    "sizeXY": "[x, y] — footprint in GRID CELLS, one cell being 5 feet. x is across, y is down, measured with the object's LONG AXIS VERTICAL. Scale against a person, who stands in exactly one cell: something one person sits on is [1,1], a table four people sit round is [1,2], a bed [1,2], anything the size of a cart or a car [2,4]. Never bigger than [6,6]."
  }],
  "rooms": [{
    "name": "string — must be the EXACT name of one of the rooms listed below",
    "props": [{
      "prop": "string — one of the props declared in \\"props\\" above",
      "count": "number — how many copies of it stand in this room. This is how a room gets full: repeat an object as many times as the room really holds it, rather than listing one of each.",
      "zone": "one of: ${PROP_ZONES.join('|')} — where they sit. 'wall' hugs a wall (beds, shelves, counters, lockers); 'corner' tucks into a corner; 'centre' stands in the middle (a dining table, an altar, a machine); 'floor' means anywhere sensible."
    }]
  }]
}
${toneLine}
Fill each room to roughly its stated target count. That target comes from the room's real floor area, and a room well under it reads as abandoned rather than lived-in. Use "count" to get there; repeating one type is normal and costs nothing.
Where a room lists categories, stay within them — they say what KINDS of object belong there, not which ones; the room's description and its established details say which. Anything those name as physically present must appear as a prop (a room described with cars in the lot gets cars; one with a buzzing neon sign gets that sign), then fill the rest of the target with what else really stands in a place like that. Where a room lists no categories, furnish it with whatever a real room of that name and description would hold. Stay inside the room's stated size — the props must physically fit in the floor area given.
FLOOR-STANDING OBJECTS ONLY. Nothing mounted on a wall or hanging from a ceiling — no signs, posters, pictures, clocks, mirrors, wall brackets or hooks. Seen from directly overhead a wall-mounted object is edge-on or hidden entirely, so it reads as a sign lying flat on the floor.
OBJECTS ONLY, NEVER BEINGS. Nothing alive, undead or able to act — no people, animals, monsters, zombies or statues-that-move. Those are creatures, placed and run separately; as props they would stand frozen as scenery. Corpses, bones and remains are fine — they are objects.
At most ${MAX_PROP_TYPES} distinct props across the entire location. Reuse the same prop across rooms wherever the object would really be the same.
${nounBlock}
ROOMS TO FURNISH:
${roomLines}

Return ONLY valid JSON, no markdown fences, no explanation.`;

  try {
    // Streamed, not completed, for the same reason pass 1 is (manifest.ts): a 20-room dressing
    // request can sit for minutes before the model emits its first byte, and a non-streaming
    // request that idle-long gets its connection dropped upstream — three `fetch failed` retries
    // at ~300s each is how one run burned 16 minutes and returned nothing.
    const raw = await adapter.stream(prompt, onToken);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const plan = parsePropPlan(JSON.parse(cleaned) as RawPropPlan, catalogue);
    // Logged rather than silent: an empty plan renders identically to the feature being switched
    // off, so without this a model that answered `{}` and a model that was never called look the
    // same from disk afterwards. The raw length distinguishes "said nothing" from "said something
    // unusable" without dumping a multi-KB response into the log.
    const instances = [...plan.byRoom.values()].flat().reduce((n, r) => n + r.count, 0);
    if (!plan.props.length) logError('dungeon/propDressing:emptyPlan', new Error(`model returned no usable props (${raw.length} chars, ${dressable.length} rooms asked)`));
    else logDebug(`prop dressing: ${plan.props.length} types, ${instances} instances across ${plan.byRoom.size} rooms`);
    return plan;
  } catch (err) {
    logError('dungeon/propDressing:generatePropDressing', err);
    return EMPTY_PROP_PLAN;
  }
}
