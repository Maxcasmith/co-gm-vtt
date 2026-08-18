import type { Dungeon, SenseKind } from 'shared';
import { DARKVISION_THRESHOLD } from './constants.ts';
import type { SenseCells } from './types.ts';

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

/** Ambient light level + which sense tiers are actually doing anything this frame — shared by the ground overlay and every non-player token's per-draw filter below. */
export function computeLighting(dungeon: Dungeon | undefined, senses: SenseCells | null): LightingState {
  const illum = dungeon?.illumination ?? 1;
  return {
    illum,
    trueSightActive: illum < 1 && hasAny(senses, TRUE_SIGHT_KINDS),
    lowLightActive: illum <= DARKVISION_THRESHOLD && hasAny(senses, LOW_LIGHT_KINDS),
  };
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

  if (illum < 1) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - illum})`;
    if ((litCells && litCells.size > 0) || trueSightActive || lowLightActive) {
      for (let gy = 0; gy < dungeon.height; gy++) {
        for (let gx = 0; gx < dungeon.width; gx++) {
          const key = `${gx},${gy}`;
          if (litCells?.has(key)) continue;
          if (trueSightActive && coveredBy(senses, TRUE_SIGHT_KINDS, gx, gy)) continue;
          if (lowLightActive && coveredBy(senses, LOW_LIGHT_KINDS, gx, gy)) continue;
          ctx.fillRect(gx * cellSz + panX, gy * cellSz + panY, cellSz, cellSz);
        }
      }
    } else {
      ctx.fillRect(panX, panY, dungeon.width * cellSz, dungeon.height * cellSz);
    }
    ctx.restore();
  }

  if (lowLightActive) {
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgb(128,128,128)';
    for (let gy = 0; gy < dungeon.height; gy++) {
      for (let gx = 0; gx < dungeon.width; gx++) {
        const key = `${gx},${gy}`;
        if (litCells?.has(key)) continue;
        // True sight overrides low-light on a cell a character senses both ways — full color wins.
        if (trueSightActive && coveredBy(senses, TRUE_SIGHT_KINDS, gx, gy)) continue;
        if (!coveredBy(senses, LOW_LIGHT_KINDS, gx, gy)) continue;
        ctx.fillRect(gx * cellSz + panX, gy * cellSz + panY, cellSz, cellSz);
      }
    }
    ctx.restore();
  }
}

/**
 * Canvas `filter` string for a token standing at (gx,gy): empty (full color/bright) inside a real
 * light source or an active true-sight sense, 'grayscale(1)' inside an active low-light sense
 * (monochrome, not darkened), or brightness(illum) otherwise. brightness(illum) is the per-pixel
 * equivalent of the ground's black-alpha-over-at-(1-illum) trick (source-over black at alpha a
 * over color c == c*(1-a) == c*illum), so a token standing in an unlit cell darkens the same
 * amount its floor tile does. Own token is the only one exempt — never calls this, see
 * Canvas.tsx/drawScene.ts.
 */
export function tokenLightFilter(
  gx: number, gy: number,
  litCells: Set<string> | null, senses: SenseCells | null,
  state: LightingState,
): string {
  const { illum, trueSightActive, lowLightActive } = state;
  const key = `${gx},${gy}`;
  if (litCells?.has(key)) return '';
  if (trueSightActive && coveredBy(senses, TRUE_SIGHT_KINDS, gx, gy)) return '';
  if (lowLightActive && coveredBy(senses, LOW_LIGHT_KINDS, gx, gy)) return 'grayscale(1)';
  if (illum < 1) return `brightness(${illum})`;
  return '';
}
