/**
 * Small stackable badges drawn above a token to represent transient battle state (marks,
 * conditions, ...). Add a new one by giving it a TokenIconKey and a drawer in ICON_DRAWERS, then
 * push that key into the list a caller passes to drawTokenIconStack — drawScene.ts builds that
 * list per token and this file just lays the icons out and draws them, so a new status never
 * needs its own hand-placed offset the way drawConcentrationBadge (drawToken.ts, kept as-is for
 * the one existing caller) had to.
 */

export type TokenIconKey = 'marked';

/** Crosshair-in-a-circle — reads as "target-locked" at a glance. */
function drawCrosshairIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10,8,16,0.85)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.strokeStyle = '#ff3b3b';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.55, y);
  ctx.moveTo(x + r * 0.55, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 0.55);
  ctx.moveTo(x, y + r * 0.55); ctx.lineTo(x, y + r);
  ctx.stroke();
}

const ICON_DRAWERS: Record<TokenIconKey, (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => void> = {
  marked: drawCrosshairIcon,
};

/** Which icon (if any) a `combat:mark` spellName maps to — extend as more target-locking curses get registered. */
export function markIconFor(spellName: string): TokenIconKey | undefined {
  return spellName === "Hunter's Mark" || spellName === 'Hex' ? 'marked' : undefined;
}

/**
 * Draws a token's active status icons as a small row centered above it. The framework entry
 * point — callers just build a `keys` array (order = draw order) and everything about spacing/
 * sizing is handled here, so a token with two or three simultaneous statuses stacks cleanly
 * instead of overlapping.
 */
export function drawTokenIconStack(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number, keys: TokenIconKey[]): void {
  if (!keys.length) return;
  const r = Math.max(6, tokenR * 0.26);
  const gap = r * 2.3;
  const rowY = y - tokenR - r - 3;
  const startX = x - ((keys.length - 1) * gap) / 2;
  keys.forEach((key, i) => {
    ctx.save();
    ICON_DRAWERS[key](ctx, startX + i * gap, rowY, r);
    ctx.restore();
  });
}
