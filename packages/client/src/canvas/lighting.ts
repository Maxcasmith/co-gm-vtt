import type { Dungeon, SenseKind } from 'shared';
import { CELL, DARKVISION_THRESHOLD } from './constants.ts';
import type { SenseCells, TokenDim } from './types.ts';

// Senses that only tell you "something's there," not what it looks like — 5e still blocks them by
// total cover (walls), and they don't grant real color vision, so they render exactly like
// darkvision: full-bright but monochrome, and only once it's actually dark (illum <= threshold;
// merely dim light needs no special sense at all). tremorsense's only difference from the other
// two is geometric (no wall-blocking — see useVision.ts), not how it renders here.
const LOW_LIGHT_KINDS: SenseKind[] = ['darkvision', 'blindsight', 'tremorsense'];
// Senses that see normally regardless of darkness — full color, no dimming, at any illum < 1
// (unlike the low-light group, there's no threshold: "see normally in darkness" means no
// degradation even in merely dim light, not just once it's pitch black).
const TRUE_SIGHT_KINDS: SenseKind[] = ['truesight', 'devilsSight'];

function hasAny(senses: SenseCells | null, kinds: SenseKind[]): boolean {
  return kinds.some(k => (senses?.[k]?.size ?? 0) > 0);
}

function coveredBy(senses: SenseCells | null, kinds: SenseKind[], gx: number, gy: number): boolean {
  const key = `${gx},${gy}`;
  return kinds.some(k => senses?.[k]?.has(key));
}

export interface LightingState {
  illum: number;
  /** True-sight-kind coverage exists and it's at least dim (illum < 1) — no threshold gate, see TRUE_SIGHT_KINDS. */
  trueSightActive: boolean;
  /** Low-light-kind coverage exists and it's actually dark (illum <= DARKVISION_THRESHOLD). */
  lowLightActive: boolean;
}

// Dev toggles (DevModal) — module-level like showPerfOverlay above; DevModal fires
// 'vtt:dev:redraw' after flipping either so the next draw picks it up immediately.
// lightingEnabled off: forces full-bright, no ground dimming/desaturation, regardless of dungeon
// illumination. darkvisionEnabled off: sense tiers (darkvision/blindsight/truesight/...) never
// activate, regardless of what the character has — dungeon illum still applies as normal.
let lightingEnabled = true;
let darkvisionEnabled = true;
export function setLightingEnabled(on: boolean): void {
  lightingEnabled = on;
}
export function isLightingEnabled(): boolean {
  return lightingEnabled;
}
export function setDarkvisionEnabled(on: boolean): void {
  darkvisionEnabled = on;
}
export function isDarkvisionEnabled(): boolean {
  return darkvisionEnabled;
}

/** Ambient light level + which sense tiers are actually doing anything this frame — shared by the ground overlay and every non-player token's per-draw filter below. */
export function computeLighting(dungeon: Dungeon | undefined, senses: SenseCells | null): LightingState {
  const illum = lightingEnabled ? (dungeon?.illumination ?? 1) : 1;
  return {
    illum,
    trueSightActive: darkvisionEnabled && illum < 1 && hasAny(senses, TRUE_SIGHT_KINDS),
    lowLightActive: darkvisionEnabled && illum <= DARKVISION_THRESHOLD && hasAny(senses, LOW_LIGHT_KINDS),
  };
}

function collectCells(target: Set<string>, senses: SenseCells | null, kinds: SenseKind[]): void {
  for (const kind of kinds) {
    const s = senses?.[kind];
    if (!s) continue;
    for (const key of s) target.add(key);
  }
}

interface LightingPathCache {
  litCells: Set<string> | null;
  senses: SenseCells | null;
  illum: number;
  trueSightActive: boolean;
  lowLightActive: boolean;
  darkFullRect: boolean;
  /**
   * Grid-local (CELL-px/cell, no pan/zoom baked in) — see applyGroundLighting's translate+scale.
   * Hole rects only, no outer rect — the outer rect is rebuilt every frame cropped to the current
   * viewport instead (see applyGroundLighting), since a fixed full-dungeon outer rect measured as
   * costing real time to fill under a zoom transform even for the ~90%+ that's off-screen.
   */
  darkHolesPath: Path2D | null;
  satPath: Path2D | null;
}

// litCells/senses are already memoized upstream (useVision.ts) — new references only when the
// player actually moves or the dungeon/species changes, not on every redraw. Rebuilding these
// paths from scratch every frame regardless was wasted work: reference-equal inputs reuse the
// cached paths, so a stationary attack sequence or a token drag (neither moves the player) skips
// re-walking every sensed cell each frame. (Rasterizing the evenodd fill itself still costs
// per-frame — Canvas.tsx's rAF-coalesced draw scheduling is what bounds that to once per frame
// instead of once per state change; see the draw effect there.)
let cache: LightingPathCache | null = null;

function buildCache(dungeon: Dungeon, litCells: Set<string> | null, senses: SenseCells | null, illum: number, trueSightActive: boolean, lowLightActive: boolean): LightingPathCache {
  let darkFullRect = false;
  let darkHolesPath: Path2D | null = null;
  if (illum < 1) {
    const excluded = new Set<string>();
    if (litCells) for (const key of litCells) excluded.add(key);
    if (trueSightActive) collectCells(excluded, senses, TRUE_SIGHT_KINDS);
    if (lowLightActive) collectCells(excluded, senses, LOW_LIGHT_KINDS);

    if (excluded.size === 0) {
      darkFullRect = true;
    } else {
      darkHolesPath = new Path2D();
      for (const key of excluded) {
        const [gx, gy] = key.split(',').map(Number) as [number, number];
        darkHolesPath.rect(gx * CELL, gy * CELL, CELL, CELL);
      }
    }
  }

  let satPath: Path2D | null = null;
  if (lowLightActive) {
    const lowLight = new Set<string>();
    collectCells(lowLight, senses, LOW_LIGHT_KINDS);
    const trueSight = trueSightActive ? new Set<string>() : null;
    if (trueSight) collectCells(trueSight, senses, TRUE_SIGHT_KINDS);

    const path = new Path2D();
    let any = false;
    for (const key of lowLight) {
      if (litCells?.has(key)) continue;
      // True sight overrides low-light on a cell a character senses both ways — full color wins.
      if (trueSight?.has(key)) continue;
      const [gx, gy] = key.split(',').map(Number) as [number, number];
      path.rect(gx * CELL, gy * CELL, CELL, CELL);
      any = true;
    }
    if (any) satPath = path;
  }

  return { litCells, senses, illum, trueSightActive, lowLightActive, darkFullRect, darkHolesPath, satPath };
}

/**
 * Dims/desaturates the ground layer (floor, walls, hazards, non-creature entity markers) already
 * painted into `ctx` — a black rect at `1-illum` alpha per cell not covered by a light source or
 * an active sense, skipping true-sight-covered cells entirely (full color, no pass at all) and
 * low-light-covered cells' darkening (they get a separate 'saturation'-composite gray pass instead,
 * so they read as monochrome rather than full color — 5e's "see in darkness as if dim light").
 * Ground only — token dimming is per-token, see tokenLightFilter.
 */
export function applyGroundLighting(
  ctx: CanvasRenderingContext2D,
  dungeon: Dungeon,
  cellSz: number, panX: number, panY: number,
  litCells: Set<string> | null, senses: SenseCells | null,
  state: LightingState,
): void {
  const { illum, trueSightActive, lowLightActive } = state;

  if (!cache || cache.litCells !== litCells || cache.senses !== senses || cache.illum !== illum || cache.trueSightActive !== trueSightActive || cache.lowLightActive !== lowLightActive) {
    cache = buildCache(dungeon, litCells, senses, illum, trueSightActive, lowLightActive);
  }
  const zoom = cellSz / CELL;

  // Viewport crop, screen-space (before any translate/scale below) — reused by darkFullRect and
  // satPath, both of which used to paint/fill unbounded by pan/zoom (darkFullRect: the whole
  // dungeon; satPath: every sensed cell, however far off-screen — see the perf report that traced
  // lighting+darkvision-together cost to these two). darkHolesPath already cropped its outer rect
  // this way; left as-is.
  const canvasEl = ctx.canvas;
  const visX0 = Math.max(0, Math.floor(-panX / cellSz));
  const visY0 = Math.max(0, Math.floor(-panY / cellSz));
  const visX1 = Math.min(dungeon.width, Math.ceil((canvasEl.width - panX) / cellSz));
  const visY1 = Math.min(dungeon.height, Math.ceil((canvasEl.height - panY) / cellSz));
  const hasViewport = visX1 > visX0 && visY1 > visY0;

  if (illum < 1 && hasViewport) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - illum})`;
    if (cache.darkFullRect) {
      ctx.fillRect(visX0 * cellSz + panX, visY0 * cellSz + panY, (visX1 - visX0) * cellSz, (visY1 - visY0) * cellSz);
    } else if (cache.darkHolesPath) {
      // Outer rect cropped to the current viewport (not the full dungeon) + the cached hole rects,
      // filled 'evenodd' — same donut technique the fog-of-war polygon below uses.
      const path = new Path2D();
      path.rect(visX0 * CELL, visY0 * CELL, (visX1 - visX0) * CELL, (visY1 - visY0) * CELL);
      path.addPath(cache.darkHolesPath);
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);
      ctx.fill(path, 'evenodd');
    }
    ctx.restore();
  }

  if (cache.satPath && hasViewport) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(visX0 * cellSz + panX, visY0 * cellSz + panY, (visX1 - visX0) * cellSz, (visY1 - visY0) * cellSz);
    ctx.clip();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.fill(cache.satPath);
    ctx.restore();
  }
}

/**
 * How a token standing at (gx,gy) should be dimmed: no dimming inside a real light source or an
 * active true-sight sense, grayscale inside an active low-light sense (monochrome, not darkened),
 * or brightness(illum) otherwise. brightness(illum) is the per-pixel equivalent of the ground's
 * black-alpha-over-at-(1-illum) trick (source-over black at alpha a over color c == c*(1-a) ==
 * c*illum), so a token standing in an unlit cell darkens the same amount its floor tile does. Own
 * token is the only one exempt — never calls this, see Canvas.tsx/drawScene.ts.
 *
 * Returns structured TokenDim, not a CSS filter string — see types.ts for why.
 */
export function tokenLightFilter(
  gx: number, gy: number,
  litCells: Set<string> | null, senses: SenseCells | null,
  state: LightingState,
): TokenDim {
  const { illum, trueSightActive, lowLightActive } = state;
  const key = `${gx},${gy}`;
  if (litCells?.has(key)) return {};
  if (trueSightActive && coveredBy(senses, TRUE_SIGHT_KINDS, gx, gy)) return {};
  if (lowLightActive && coveredBy(senses, LOW_LIGHT_KINDS, gx, gy)) return { grayscale: true };
  if (illum < 1) return { brightness: illum };
  return {};
}
