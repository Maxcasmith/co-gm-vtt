import type { Dungeon, SenseKind } from 'shared';
import { CELL, DARKVISION_THRESHOLD } from './constants.ts';
import type { SenseCells, TokenDim, LightSourceCells } from './types.ts';

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
  /** Per-torch vignette clip (grid-local, same convention as darkHolesPath) — see buildSourceVignettes. */
  sourceVignettes: SourceVignette[] | null;
}

interface SourceVignette {
  /** Grid-local center (CELL-px units) for the radial gradient. */
  cx: number;
  cy: number;
  /** Where the erase gradient stops holding full-strength and starts easing toward 0 — the hard mechanical cutoff. */
  holdRadius: number;
  /** Where the erase gradient reaches 0 (no lightening at all) — the cosmetic glow edge, past the hard cutoff. */
  glowRadius: number;
  /** Union of this source's own wall-blocked cells out to glowRadius, grid-local — clips the erase so it can't bleed through a wall the hard-cutoff radius already respects. */
  clip: Path2D;
  /** Per-source phase so torches in the same room don't flicker in lockstep. */
  seed: number;
}

// A soft, irregular multiplier around 1 — two out-of-phase sine waves rather than one, so the
// pulse doesn't read as a metronome. Small amplitude: this feathers a torch's already-correct
// hard-cutoff radius, it isn't meant to be a visible pulsing circle.
function flickerScale(seed: number, now: number): number {
  return 1 + 0.05 * Math.sin(now / 220 + seed) + 0.025 * Math.sin(now / 97 + seed * 2.3);
}

function buildSourceVignettes(lightSources: LightSourceCells[] | null): SourceVignette[] | null {
  if (!lightSources?.length) return null;
  const out: SourceVignette[] = [];
  for (const src of lightSources) {
    const clip = new Path2D();
    for (const key of src.glowCells) {
      const [gx, gy] = key.split(',').map(Number) as [number, number];
      clip.rect(gx * CELL, gy * CELL, CELL, CELL);
    }
    out.push({
      cx: (src.gx + 0.5) * CELL,
      cy: (src.gy + 0.5) * CELL,
      holdRadius: src.radiusCells * CELL,
      glowRadius: src.glowRadiusCells * CELL,
      clip,
      seed: src.gx * 13 + src.gy * 7,
    });
  }
  return out;
}

// litCells/senses are already memoized upstream (useVision.ts) — new references only when the
// player actually moves or the dungeon/species changes, not on every redraw. Rebuilding these
// paths from scratch every frame regardless was wasted work: reference-equal inputs reuse the
// cached paths, so a stationary attack sequence or a token drag (neither moves the player) skips
// re-walking every sensed cell each frame. (Rasterizing the evenodd fill itself still costs
// per-frame — Canvas.tsx's rAF-coalesced draw scheduling is what bounds that to once per frame
// instead of once per state change; see the draw effect there.)
let cache: LightingPathCache | null = null;

function buildCache(dungeon: Dungeon, litCells: Set<string> | null, lightSources: LightSourceCells[] | null, senses: SenseCells | null, illum: number, trueSightActive: boolean, lowLightActive: boolean): LightingPathCache {
  let darkFullRect = false;
  let darkHolesPath: Path2D | null = null;
  const sourceVignettes = illum < 1 ? buildSourceVignettes(lightSources) : null;
  if (illum < 1) {
    const excluded = new Set<string>();
    // Holed out to each source's glowCells, not just its hard-cutoff cells (litCells) — the
    // vignette pass below needs this ring left unpainted so it can shade it in itself with a
    // proper falloff rather than fighting flat-black already sitting there. litCells is a subset
    // of this per source, so it doesn't need its own pass.
    if (lightSources) for (const src of lightSources) for (const key of src.glowCells) excluded.add(key);
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

  return { litCells, senses, illum, trueSightActive, lowLightActive, darkFullRect, darkHolesPath, satPath, sourceVignettes };
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
  litCells: Set<string> | null, lightSources: LightSourceCells[] | null, senses: SenseCells | null,
  state: LightingState,
): void {
  const { illum, trueSightActive, lowLightActive } = state;

  if (!cache || cache.litCells !== litCells || cache.senses !== senses || cache.illum !== illum || cache.trueSightActive !== trueSightActive || cache.lowLightActive !== lowLightActive) {
    cache = buildCache(dungeon, litCells, lightSources, senses, illum, trueSightActive, lowLightActive);
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

  // Vignette: the flat rect above was holed out to each source's full glowCells (see buildCache),
  // so this ring is currently unpainted, not pre-blackened — this pass shades it in itself with a
  // proper falloff instead of stamping flat black over already-lit tiles. Fully transparent (no
  // darkening at all) out to the hard mechanical cutoff, then eases up to (1-illum) — matching the
  // surrounding darkness exactly — at the cosmetic glow edge past it. Reads as the light itself
  // spilling a little further and thinning out, not a black smudge painted over the tiles around
  // it.
  //
  // The gradient's own geometry (fillRect + radius) stays pinned to the static glowRadius that
  // matches the hole cut in buildCache — never animated. Shrinking that geometry with flicker
  // used to uncover a strip of glowCells the flat rect had already permanently excluded, which
  // had nothing painted over it that frame and so flashed straight to full brightness. Flicker
  // instead just slides where the transparent→dark transition sits *within* that fixed radius.
  if (cache.sourceVignettes && hasViewport) {
    const now = Date.now();
    for (const v of cache.sourceVignettes) {
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);
      ctx.clip(v.clip);
      // clip is a union of whole cell squares out to glowRadius (Chebyshev cell distance), so its
      // outer edge cells reach glowRadius + half a cell past center, not glowRadius itself — the
      // gradient/fillRect need that same margin or that outer half-tile ring is clipped-in but
      // never painted, leaving it fully bright.
      const outer = v.glowRadius + CELL / 2;
      const scale = flickerScale(v.seed, now);
      const holdFrac = Math.min(1, (v.holdRadius * scale) / outer);
      const gradient = ctx.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, outer);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(holdFrac, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, `rgba(0, 0, 0, ${1 - illum})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(v.cx - outer, v.cy - outer, outer * 2, outer * 2);
      ctx.restore();
    }
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
