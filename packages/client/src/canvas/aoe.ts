import type { SpellArea } from './types.ts';

// ── AoE geometry (grid cells, 1 cell = 5ft) ─────────────────────────────────────
// Simplified templates: cone/line use a straight-triangle/rectangle approximation
// (5e's "cone is as wide as it is long" rule of thumb) rather than exact arcs.

export function ft2cells(feet: number) { return feet / 5; }

// Slack added to every AoE boundary check, in grid cells. A token's cell-center exactly on
// a shape's edge is a coin-flip against float/pixel noise (e.g. aiming Acid Splash at the
// corner where 4 tokens meet); this tolerance makes near-edge hits land consistently instead
// of depending on sub-pixel cursor position.
const AOE_EDGE_TOLERANCE = 0.3;

export function inArea(
  area: SpellArea,
  originGx: number, originGy: number,
  dirGx: number, dirGy: number,
  tgx: number, tgy: number,
  isSelf: boolean,
): boolean {
  if (isSelf && Math.floor(tgx) === Math.floor(originGx) && Math.floor(tgy) === Math.floor(originGy)) return false;
  const dx = tgx - originGx;
  const dy = tgy - originGy;
  const sizeCells = ft2cells(area.size) + AOE_EDGE_TOLERANCE;
  switch (area.shape) {
    case 'sphere':
    case 'cylinder':
      return Math.hypot(dx, dy) <= sizeCells;
    case 'emanation':
      // Grid-square emanation (e.g. Thunderclap "within 5 ft of you") fills every
      // surrounding square at that Chebyshev distance, not a circular sweep.
      return Math.max(Math.abs(dx), Math.abs(dy)) <= sizeCells;
    case 'cube': {
      // A self-origin cube (e.g. Thunderwave) emanates from the caster's edge toward the
      // aimed direction and rotates with the mouse, same as a cone/line — it does not
      // surround the caster. A point-placed cube (e.g. Fireball) stays a centered square.
      if (isSelf) {
        const len = Math.hypot(dirGx - originGx, dirGy - originGy) || 1;
        const ux = (dirGx - originGx) / len;
        const uy = (dirGy - originGy) / len;
        const forward = dx * ux + dy * uy;
        const perp = Math.abs(dx * uy - dy * ux);
        return forward >= -AOE_EDGE_TOLERANCE && forward <= sizeCells && perp <= sizeCells / 2;
      }
      const half = sizeCells / 2;
      return Math.abs(dx) <= half && Math.abs(dy) <= half;
    }
    case 'line': {
      const len = Math.hypot(dirGx - originGx, dirGy - originGy) || 1;
      const ux = (dirGx - originGx) / len;
      const uy = (dirGy - originGy) / len;
      const forward = dx * ux + dy * uy;
      const perp = Math.abs(dx * uy - dy * ux);
      const widthCells = ft2cells(area.width ?? 5) + AOE_EDGE_TOLERANCE;
      return forward >= -AOE_EDGE_TOLERANCE && forward <= sizeCells && perp <= widthCells / 2;
    }
    case 'cone': {
      const len = Math.hypot(dirGx - originGx, dirGy - originGy) || 1;
      const ux = (dirGx - originGx) / len;
      const uy = (dirGy - originGy) / len;
      const forward = dx * ux + dy * uy;
      const perp = Math.abs(dx * uy - dy * ux);
      return forward >= -AOE_EDGE_TOLERANCE && forward <= sizeCells && perp <= forward / 2 + AOE_EDGE_TOLERANCE;
    }
  }
}

/**
 * Where an AoE template currently sits: self-origin follows the caster and points at the
 * mouse (cone/line/cube rotation); point-origin follows the mouse, clamped to spell range.
 * A spell counts as self-origin whenever its range is Self, regardless of the area's own
 * `origin` tag — compendium data mistags several directional spells (e.g. Burning Hands)
 * as 'point', which would otherwise collapse the direction vector to zero and fill the
 * entire padded box.
 */
export function resolveAoeOrigin(
  area: SpellArea,
  playerPos: { gx: number; gy: number },
  mouse: { gx: number; gy: number } | null,
  rangeFeet: number,
): { originGx: number; originGy: number; dirGx: number; dirGy: number; isSelf: boolean } {
  const isSelf = area.origin === 'self' || rangeFeet <= 0;
  if (isSelf) {
    const originGx = playerPos.gx + 0.5;
    const originGy = playerPos.gy + 0.5;
    const m = mouse ?? { gx: playerPos.gx + 1, gy: playerPos.gy };
    return { originGx, originGy, dirGx: m.gx, dirGy: m.gy, isSelf: true };
  }
  const rangeCells = ft2cells(rangeFeet);
  const m = mouse ?? { gx: playerPos.gx, gy: playerPos.gy };
  const dx = m.gx - playerPos.gx;
  const dy = m.gy - playerPos.gy;
  const dist = Math.hypot(dx, dy);
  const clamped = Number.isFinite(rangeCells) && dist > rangeCells && dist > 0
    ? { gx: playerPos.gx + (dx / dist) * rangeCells, gy: playerPos.gy + (dy / dist) * rangeCells }
    : m;
  return { originGx: clamped.gx, originGy: clamped.gy, dirGx: clamped.gx, dirGy: clamped.gy, isSelf: false };
}

/** Draws the AoE's true continuous geometry (circle/wedge/rectangle) over the cell highlight,
 *  so the grid approximation's edges are legible against the exact shape it's covering. */
export function drawAoeShape(
  ctx: CanvasRenderingContext2D,
  area: SpellArea,
  originGx: number, originGy: number,
  dirGx: number, dirGy: number,
  isSelf: boolean,
  cellSz: number, panX: number, panY: number,
) {
  const ox = originGx * cellSz + panX;
  const oy = originGy * cellSz + panY;
  const sizePx = ft2cells(area.size) * cellSz;
  const len = Math.hypot(dirGx - originGx, dirGy - originGy) || 1;
  const ux = (dirGx - originGx) / len;
  const uy = (dirGy - originGy) / len;
  const px = -uy;
  const py = ux;

  ctx.save();
  ctx.fillStyle = 'rgba(180, 90, 255, 0.28)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (area.shape) {
    case 'sphere':
    case 'cylinder':
      ctx.arc(ox, oy, sizePx, 0, Math.PI * 2);
      break;
    case 'emanation':
      ctx.rect(ox - sizePx, oy - sizePx, sizePx * 2, sizePx * 2);
      break;
    case 'cube': {
      if (isSelf) {
        const half = sizePx / 2;
        const p1 = { x: ox + px * half, y: oy + py * half };
        const p2 = { x: ox - px * half, y: oy - py * half };
        const p3 = { x: p2.x + ux * sizePx, y: p2.y + uy * sizePx };
        const p4 = { x: p1.x + ux * sizePx, y: p1.y + uy * sizePx };
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
      } else {
        const half = sizePx / 2;
        ctx.rect(ox - half, oy - half, sizePx, sizePx);
      }
      break;
    }
    case 'line': {
      const halfW = (ft2cells(area.width ?? 5) * cellSz) / 2;
      const p1 = { x: ox + px * halfW, y: oy + py * halfW };
      const p2 = { x: ox - px * halfW, y: oy - py * halfW };
      const p3 = { x: p2.x + ux * sizePx, y: p2.y + uy * sizePx };
      const p4 = { x: p1.x + ux * sizePx, y: p1.y + uy * sizePx };
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
      break;
    }
    case 'cone': {
      const halfW = sizePx / 2;
      const base1 = { x: ox + ux * sizePx + px * halfW, y: oy + uy * sizePx + py * halfW };
      const base2 = { x: ox + ux * sizePx - px * halfW, y: oy + uy * sizePx - py * halfW };
      ctx.moveTo(ox, oy); ctx.lineTo(base1.x, base1.y); ctx.lineTo(base2.x, base2.y); ctx.closePath();
      break;
    }
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
