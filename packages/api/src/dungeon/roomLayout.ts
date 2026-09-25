import { randomUUID } from 'crypto';
import type { CampaignGenre, DungeonEntity, DungeonRoom, PropCategory, PropRotation, PropSpec, RoomProp } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { logDebug, logError } from '../logger.ts';
import { placeRoomProps } from './placer.ts';
import type { PropPlan } from './propDressing.ts';

/**
 * Pass 3 (prototype): one room's furniture drawn as ASCII over its own floor mask.
 *
 * The placer can decide that a counter goes against a wall, but it has no concept that the stools
 * belong to that counter — which is why a furnished room reads as objects scattered near walls
 * rather than a diner. Here the model draws the room, so relative placement (stools in a row facing
 * the counter, booths in pairs across a table) comes out of the same pass that chooses positions.
 *
 * This module is pure: rendering the mask, building the prompt and parsing/validating the reply all
 * run without a model, so the failure modes that actually bite — a row one character short, a prop
 * drawn on the void, a doorway blocked — are checkable in a selfcheck.
 */

/** Cell is carved floor and free for furniture. */
export const FLOOR = '_';
/** Cell is outside the room, or wall. Nothing may be drawn here. */
export const VOID = '.';
/** Carved floor the party has to walk through — a doorway or corridor mouth. Off-limits to props. */
export const THRESHOLD = '+';

/** Facing, one per furniture cell. '-' is an object with no meaningful direction (a bin, a table). */
export const FACINGS = ['^', 'v', '<', '>', '-'] as const;
export type Facing = (typeof FACINGS)[number];

export interface RoomMask {
  /** One string per room row, left to right, each exactly room.width long. */
  rows: string[];
  width: number;
  height: number;
}

export interface PlacedProp {
  noun: string;
  /** Top-left cell, absolute dungeon coordinates. */
  x: number;
  y: number;
  /** Footprint in cells, taken from the drawn run — not from the model's declared feet. */
  width: number;
  height: number;
  facing: Facing;
  rotation: PropRotation;
}

export interface LayoutResult {
  props: PlacedProp[];
  /** Per-row rejections, for the prototype's report — a row we refused and why. */
  rejected: { row: number; reason: string }[];
}

/**
 * Renders the room's floor as a mask the model overwrites. We draw this rather than asking the
 * model to reproduce a floor plan: its only job is replacing FLOOR characters, so a room can never
 * come back the wrong shape.
 *
 * `blocked` is every cell already claimed — creatures, loot, traps, stairs — plus doorways, which
 * become THRESHOLD so the model can see the route through the room instead of furnishing across it.
 */
export function renderRoomMask(room: DungeonRoom, cells: number[][], thresholds: Set<string>, blocked: Set<string>): RoomMask {
  const rows: string[] = [];
  for (let y = room.y; y < room.y + room.height; y++) {
    let row = '';
    for (let x = room.x; x < room.x + room.width; x++) {
      const k = `${x},${y}`;
      if (cells[y]?.[x] !== 1) row += VOID;
      else if (thresholds.has(k)) row += THRESHOLD;
      else if (blocked.has(k)) row += VOID;
      else row += FLOOR;
    }
    rows.push(row);
  }
  return { rows, width: room.width, height: room.height };
}

/**
 * A cell is a threshold when it's floor on the room's edge with floor immediately outside it — the
 * mouth of a corridor or a carved doorway. Derived from the grid rather than from door entities
 * because organic layouts carve openings with no door entity at all, and both need keeping clear.
 *
 * The cell one step inward is included: a prop flush against the opening still blocks it.
 */
export function findThresholds(room: DungeonRoom, cells: number[][]): Set<string> {
  const found = new Set<string>();
  const inside = (x: number, y: number): boolean => x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height;
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (cells[y]?.[x] !== 1) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (inside(nx, ny) || cells[ny]?.[nx] !== 1) continue;
        found.add(`${x},${y}`);
        if (inside(x - dx, y - dy)) found.add(`${x - dx},${y - dy}`);
      }
    }
  }
  return found;
}

/**
 * Categories exempt from the corner rule. The rule exists because a wall-hugging object in a corner
 * can only face one of its two walls and has its other side wedged shut. Vehicles and machinery
 * stand free of the walls — a car parked in the corner of a lot is exactly how cars get parked — so
 * dropping them emptied the Parking Lot from 8 props to 3.
 */
export const CORNER_EXEMPT_CATEGORIES: readonly PropCategory[] = ['vehicle', 'machinery'];

const FACING_DEGREES: Record<Facing, PropRotation> = { v: 0, '<': 90, '^': 180, '>': 270, '-': 0 };

/**
 * Clockwise rotation from the sprite's canonical orientation (use side facing down, so 'v' is 0).
 *
 * The drawn footprint outranks the facing arrow where they disagree. A [1, 2] object drawn two
 * across is lying on its side whatever arrow the model put on it, and drawing it upright would
 * squash a tall sprite into a wide box — so an unrotated facing on a sideways footprint is turned
 * a quarter, and a quarter-turned facing on an upright footprint is straightened.
 */
export function rotationFor(facing: Facing, width: number, height: number, sizeXY: [number, number]): PropRotation {
  const degrees = FACING_DEGREES[facing];
  const [sx, sy] = sizeXY;
  if (sx === sy || width === height) return degrees;
  const drawnSideways = (width > height) !== (sx > sy);
  const quarterTurn = degrees === 90 || degrees === 270;
  if (drawnSideways && !quarterTurn) return 90;
  if (!drawnSideways && quarterTurn) return 0;
  return degrees;
}

/** Stable per-room legend: one character per prop. Upper then lower case gives 52 before we'd care. */
const LEGEND_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function buildLegend(props: PropSpec[]): Map<string, PropSpec> {
  const legend = new Map<string, PropSpec>();
  props.slice(0, LEGEND_CHARS.length).forEach((p, i) => legend.set(LEGEND_CHARS[i]!, p));
  return legend;
}

export function buildLayoutPrompt(room: DungeonRoom, mask: RoomMask, legend: Map<string, PropSpec>, roomDescription: string, tone: string, target: number): string {
  const legendLines = [...legend.entries()]
    .map(([ch, p]) => `  ${ch} = ${p.noun} (${p.sizeXY[0]} x ${p.sizeXY[1]} cells) — ${p.description}`)
    .join('\n');
  // Row-index prefixes: a dropped character then corrupts one row instead of shifting every cell
  // after it, so the parser can reject that row and keep the rest of the room.
  const maskBlock = mask.rows.map((r, i) => `${String(i).padStart(2, '0')}|${r}`).join('\n');

  return `You are furnishing ONE room of a top-down tabletop battle map by drawing it.

THE ROOM: "${room.name}" — ${mask.width} cells wide, ${mask.height} tall. One cell is 5 feet.
${roomDescription ? `It is described as: ${roomDescription}\n` : ''}${tone ? `Tone: ${tone}.\n` : ''}
Each line below is "<row number>|<cells>". Characters:
  ${FLOOR} = empty floor, you may place furniture here
  ${VOID} = wall, void, or a cell already taken — NEVER draw here
  ${THRESHOLD} = doorway or walkway — keep clear so the room can be walked through

${maskBlock}

FURNITURE AVAILABLE (place every one of these at least once):
${legendLines}

Return ONLY valid JSON, no markdown fences:
{
  "furniture": ["<row number>|<cells>", ... one string per row, ${mask.height} rows],
  "facing":    ["<row number>|<cells>", ... one string per row, ${mask.height} rows]
}

RULES — these are checked, and a row that breaks one is thrown away:
1. Every row must have the SAME number of cells as the row above it: exactly ${mask.width}. Count them.
2. Keep every ${VOID} and every ${THRESHOLD} exactly where it is. Only ever replace ${FLOOR}.
3. Each object's size in cells is listed above, as "x by y" — x across, y down. Draw it as exactly
   that block of its letter. A 1 x 2 object is its letter twice, stacked vertically.
   Objects that are 1 by 1 SHOULD be packed right up against each other where that is how they
   really stand — a row of the same object along a wall is its letter repeated with no gaps. Do
   not space them out into a checkerboard; furniture in a real room
   touches. Only two MULTI-cell objects of the same letter need a floor cell between them, so the
   pair doesn't read as one bigger object.
4. "facing" mirrors "furniture" cell for cell: ^ v < > for the direction the object faces, - for an
   object with no meaningful facing. Floor, void and doorway cells stay exactly as they are.
   An object turned on its side — facing < or > — has its size swapped: a 1 x 2 object lying
   sideways is drawn 2 across and 1 down.
5. Place things the way they really stand in a room like this one, in relation to EACH OTHER.
   Objects that are used together stand together, and whatever serves or is served faces the thing
   it goes with. Objects that belong against a wall stand against it, facing into the room.
   Objects scattered at random is the failure this whole step exists to avoid.
6. FILL THE ROOM: about ${target} objects. A room in use is full, not a few pieces of furniture in a
   bare hall. Repeat the same letter as many times as the room needs; a room well under ${target} objects reads as
   abandoned. Leave sensible walking routes between them, nothing more.
7. CORNERS: a cell touching walls on two sides holds either nothing or an object with no facing (-) —
   Never anything that faces a direction: it can only face one of the two walls, and nobody can get into it. A run of objects along a wall
   stops one object short of the corner. Vehicles and large machines are the exception: they stand
   free of the walls, so they may sit in a corner.

Return ONLY valid JSON, no markdown fences.`;
}

interface RawLayout { furniture?: unknown; facing?: unknown }

/** Strips the "NN|" prefix, returning null if it's missing or points at the wrong row. */
function stripPrefix(line: unknown, expectedRow: number): string | null {
  if (typeof line !== 'string') return null;
  const m = /^\s*(\d{1,3})\s*\|(.*)$/.exec(line);
  if (!m) return null;
  return Number(m[1]) === expectedRow ? m[2]! : null;
}

/**
 * Validates the reply row by row and converts it into placed props.
 *
 * Every rejection is per-row and local: a row of the wrong width, or one that painted over a wall or
 * a doorway, is dropped and the rest of the room still lands. The alternative — trusting the grid
 * wholesale — means one miscounted line silently shifts every prop after it, which is exactly the
 * failure this shape is designed to contain.
 */
export function parseLayout(raw: RawLayout, room: DungeonRoom, mask: RoomMask, legend: Map<string, PropSpec>): LayoutResult {
  const rejected: { row: number; reason: string }[] = [];
  const furniture = Array.isArray(raw.furniture) ? raw.furniture : [];
  const facing = Array.isArray(raw.facing) ? raw.facing : [];

  const grid: string[] = [];
  const faces: string[] = [];
  for (let r = 0; r < mask.height; r++) {
    const blank = VOID.repeat(mask.width);
    const f = stripPrefix(furniture[r], r);
    const o = stripPrefix(facing[r], r);
    if (f === null) { rejected.push({ row: r, reason: 'missing or misnumbered furniture row' }); grid.push(blank); faces.push(blank); continue; }
    if (f.length !== mask.width) { rejected.push({ row: r, reason: `width ${f.length}, expected ${mask.width}` }); grid.push(blank); faces.push(blank); continue; }
    const maskRow = mask.rows[r]!;
    let bad = '';
    for (let c = 0; c < mask.width; c++) {
      const drawn = f[c]!;
      if (drawn === FLOOR || drawn === VOID || drawn === THRESHOLD) continue;
      if (!legend.has(drawn)) { bad = `unknown legend character "${drawn}"`; break; }
      if (maskRow[c] !== FLOOR) { bad = `drew "${drawn}" on a ${maskRow[c] === THRESHOLD ? 'doorway' : 'wall'} cell`; break; }
    }
    if (bad) { rejected.push({ row: r, reason: bad }); grid.push(blank); faces.push(blank); continue; }
    grid.push(f);
    faces.push(o !== null && o.length === mask.width ? o : VOID.repeat(mask.width));
  }

  // Runs become single entities: horizontal first, then any leftover column runs. A 4-cell counter
  // is one object 4 cells wide, so the footprint comes from what was drawn rather than from the
  // declared feet the model was never good at.
  const claimed = new Set<string>();
  const props: PlacedProp[] = [];

  const facingAt = (r: number, c: number): Facing => {
    const ch = faces[r]?.[c];
    return (FACINGS as readonly string[]).includes(ch ?? '') ? (ch as Facing) : '-';
  };

  for (let r = 0; r < mask.height; r++) {
    for (let c = 0; c < mask.width; c++) {
      const ch = grid[r]?.[c];
      if (!ch || !legend.has(ch) || claimed.has(`${r},${c}`)) continue;

      const free = (y: number, x: number): boolean => grid[y]?.[x] === ch && !claimed.has(`${y},${x}`);

      // The block of this character starting here — a rectangle, not a line. A truck drawn 2 cells
      // wide and 4 tall is one truck; reading only along a row or a column slices it lengthwise into
      // two, which is exactly how a 7x18ft pickup came back as a pair of 5x20ft ones.
      let rectW = 1;
      while (c + rectW < mask.width && free(r, c + rectW)) rectW++;
      let rectH = 1;
      while (r + rectH < mask.height && Array.from({ length: rectW }, (_, i) => free(r + rectH, c + i)).every(Boolean)) rectH++;

      // How many objects that block holds. The declared feet give one object's footprint, the block
      // gives the arrangement: four booth-sized cells in a row is four booths, one truck-sized
      // rectangle is one truck. Whichever orientation tiles the block more evenly wins, so a counter
      // declared 3ft x 12ft is still recognised when it's drawn lying along a wall.
      const spec = legend.get(ch)!;
      const [fw, fh] = spec.sizeXY;
      const waste = (uw: number, uh: number): number => (rectW % uw) + (rectH % uh);
      const [unitW, unitH] = waste(fw, fh) <= waste(fh, fw) ? [fw, fh] : [fh, fw];

      // Floor, so a block that doesn't divide cleanly becomes fewer, slightly larger objects rather
      // than leaving an offcut: three cells of a 12ft counter is one counter drawn a bit long.
      const cols = Math.max(1, Math.floor(rectW / unitW));
      const rows = Math.max(1, Math.floor(rectH / unitH));
      const span = (total: number, n: number, i: number): number => Math.floor(total / n) + (i < total % n ? 1 : 0);

      for (let iy = 0, oy = 0; iy < rows; iy++) {
        const h = span(rectH, rows, iy);
        for (let ix = 0, ox = 0; ix < cols; ix++) {
          const w = span(rectW, cols, ix);
          const px = c + ox, py = r + oy;
          for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) claimed.add(`${py + dy},${px + dx}`);
          const facing = facingAt(py, px);
          props.push({ noun: spec.noun, x: room.x + px, y: room.y + py, width: w, height: h, facing, rotation: rotationFor(facing, w, h, spec.sizeXY) });
          ox += w;
        }
        oy += h;
      }
    }
  }

  // Backstop for rule 7: an object with a facing may not sit in a corner, however the model drew it.
  // It can only face one of the two walls, the other side is wedged shut, and where two wall runs
  // meet the facings contradict each other. Dropping the one object is cheaper than a corner-variant
  // prop per noun, and the prompt rule means this should rarely fire.
  // ponytail: mask VOID also covers creature/loot cells, so a prop beside a creature can read as
  // cornered — derive walls from the real grid if that starts dropping props that looked fine.
  const wall = (r: number, c: number): boolean => (mask.rows[r]?.[c] ?? VOID) === VOID;
  const isCorner = (r: number, c: number): boolean => (wall(r - 1, c) || wall(r + 1, c)) && (wall(r, c - 1) || wall(r, c + 1));
  const exempt = new Set([...legend.values()].filter(s => CORNER_EXEMPT_CATEGORIES.includes(s.category)).map(s => s.noun));
  const kept = props.filter(p => {
    if (p.facing === '-' || exempt.has(p.noun)) return true;
    for (let dy = 0; dy < p.height; dy++) {
      for (let dx = 0; dx < p.width; dx++) {
        const r = p.y - room.y + dy, c = p.x - room.x + dx;
        if (!isCorner(r, c)) continue;
        rejected.push({ row: r, reason: `dropped ${p.noun} facing ${p.facing} from a corner` });
        return false;
      }
    }
    return true;
  });

  return { props: kept, rejected };
}

/** Re-renders what we actually accepted, so a prototype run can be eyeballed against the reply. */
export function renderPlaced(mask: RoomMask, props: PlacedProp[], room: DungeonRoom, legend: Map<string, PropSpec>): string {
  const charFor = new Map([...legend.entries()].map(([ch, spec]) => [spec.noun, ch]));
  const grid = mask.rows.map(r => r.split(''));
  for (const p of props) {
    const ch = charFor.get(p.noun) ?? '?';
    for (let dy = 0; dy < p.height; dy++) {
      for (let dx = 0; dx < p.width; dx++) {
        const r = p.y - room.y + dy, c = p.x - room.x + dx;
        if (grid[r]?.[c] !== undefined) grid[r]![c] = ch;
      }
    }
  }
  return grid.map((r, i) => `${String(i).padStart(2, '0')}|${r.join('')}`).join('\n');
}

/**
 * Pass 3 for one room: the model draws it, we validate and parse. Throws on a transport or JSON
 * failure; the caller decides what a failed room falls back to.
 *
 * Streamed for the same reason passes 1 and 2 are — a non-streaming request that sits silent past
 * undici's 300s headers timeout is killed and retried, paying for the answer each time.
 */
/** Enough of a failed layout reply to tell a wrong shape (other keys, one long string) from a
 * miscounted grid. The model is the workflow's first one unless a providers/index:chain error for
 * this call appears above it in the log. */
function rawSample(raw: string): string {
  return `raw reply (${raw.length} chars): ${raw.slice(0, 500)}${raw.length > 500 ? '…' : ''}`;
}

export async function furnishRoom(
  room: DungeonRoom,
  requests: RoomProp[],
  specs: Map<string, PropSpec>,
  cells: number[][],
  blocked: Set<string>,
  adapter: StoryProviderAdapter,
  description: string,
  tone: string,
): Promise<LayoutResult & { raw: string }> {
  const nouns = [...new Set(requests.map(r => r.noun))];
  const legend = buildLegend(nouns.map(n => specs.get(n)).filter((s): s is PropSpec => !!s));
  const mask = renderRoomMask(room, cells, findThresholds(room, cells), blocked);
  // Pass 2 already decided how much this room holds; the layout call arranges that, it doesn't
  // re-decide it.
  const target = requests.reduce((n, r) => n + r.count, 0);
  const raw = await adapter.stream(buildLayoutPrompt(room, mask, legend, description, tone, target), () => {});
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  let parsed: RawLayout;
  try {
    parsed = JSON.parse(cleaned) as RawLayout;
  } catch {
    throw new Error(`reply is not JSON — ${rawSample(raw)}`);
  }
  return { ...parseLayout(parsed, room, mask, legend), raw };
}

/**
 * Pass 3 for the whole dungeon: every furnished room laid out in parallel, one small call each.
 *
 * Rooms are independent, so seventeen of these finish in roughly the time of the slowest one
 * rather than the sum — which is why this is per-room rather than one large call like pass 2.
 *
 * A room whose call fails, or returns nothing usable, falls back to the zone placer: never an empty
 * room because one layout call went wrong. The fallback is told about doorways too, so it can't
 * park a desk across one either.
 *
 * `entities` must already hold everything non-prop (creatures, loot, traps, stairs, doors) — their
 * cells are shown to the model as taken.
 */
export async function furnishRooms(
  rooms: DungeonRoom[],
  plan: PropPlan,
  cells: number[][],
  entities: DungeonEntity[],
  adapter: StoryProviderAdapter,
  descriptions: Map<string, string>,
  genre?: CampaignGenre,
): Promise<DungeonEntity[]> {
  const specs = new Map(plan.props.map(p => [p.noun, p]));
  const taken = new Set<string>();
  for (const e of entities) {
    for (let dy = 0; dy < (e.height ?? 1); dy++) for (let dx = 0; dx < (e.width ?? 1); dx++) taken.add(`${e.x + dx},${e.y + dy}`);
  }
  const tone = genre ? `${genre.setting} setting, ${genre.tone} tone` : '';
  const toEntity = (p: PlacedProp): DungeonEntity => ({
    id: randomUUID(), type: 'object', x: p.x, y: p.y, width: p.width, height: p.height, name: p.noun, discovered: true,
    ...(p.rotation ? { rotation: p.rotation } : {}),
  });

  const perRoom = await Promise.all(rooms.filter(r => !r.isStairwell).map(async room => {
    const requests = plan.byRoom.get(room.name) ?? [];
    if (!requests.length) return [];
    try {
      const result = await furnishRoom(room, requests, specs, cells, taken, adapter, descriptions.get(room.name) ?? '', tone);
      if (result.rejected.length) logDebug(`room layout "${room.name}": ${result.rejected.length} rejections — ${result.rejected.map(r => `row ${r.row}: ${r.reason}`).join('; ')}`);
      if (result.props.length) {
        logDebug(`room layout "${room.name}": ${result.props.length} props`);
        return result.props.map(toEntity);
      }
      logError('dungeon/roomLayout:empty', new Error(`"${room.name}" laid out nothing usable — falling back to the zone placer. ${rawSample(result.raw)}`));
    } catch (err) {
      logError(`dungeon/roomLayout:${room.name}`, err);
    }
    const occupied = new Set([...taken, ...findThresholds(room, cells)]);
    return placeRoomProps(room, requests, specs, occupied, cells);
  }));

  return perRoom.flat();
}
