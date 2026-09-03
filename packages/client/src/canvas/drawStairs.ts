/**
 * Stairs map marker — a small square icon button centered on the stairs entity's 2x2 footprint,
 * same fixed-size-button convention as drawDoorMarker (this is a button to click, not a drawn
 * object to scale). No state variants — stairs have no open/closed/locked concept, just click to
 * warp (see useStairs, runtime.ts).
 */
export function drawStairsMarker(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, hovered: boolean,
): void {
  ctx.save();

  ctx.beginPath();
  ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.25);
  ctx.fillStyle = hovered ? 'rgba(255,255,255,0.35)' : 'rgba(20,16,10,0.55)';
  ctx.fill();

  // Ascending-step glyph: three stacked bars, each shorter and higher than the last.
  const steps = 3;
  const barH = r * 0.32;
  const barMaxW = r * 1.2;
  ctx.fillStyle = '#fff';
  for (let i = 0; i < steps; i++) {
    const w = barMaxW * ((steps - i) / steps);
    const y = cy + r * 0.6 - (i + 1) * barH;
    ctx.fillRect(cx - w / 2, y, w, barH * 0.82);
  }

  ctx.restore();
}
