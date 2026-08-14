/**
 * Fills one grid cell with a lasting map hazard's look — Entangle's vines, Grease/Fog Cloud's
 * flat smudge. `x`/`y` are the cell's top-left corner in canvas space (already pan/zoom-applied),
 * `size` the cell's on-screen side length. The vine curls are seeded off the cell's own
 * coordinates so they stay put across re-renders instead of re-randomizing every frame.
 */
export function drawHazardCell(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  x: number,
  y: number,
  size: number,
  style: 'vines' | 'smudge' | undefined,
  color: string,
): void {
  ctx.save();
  ctx.globalAlpha = style === 'vines' ? 0.25 : 0.35;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);

  if (style === 'vines') {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, size * 0.05);
    const seed = ((gx * 928371 + gy * 12977) % 1000) / 1000;
    for (let i = 0; i < 2; i++) {
      const t = (seed + i / 2) % 1;
      const baseX = x + size * (0.2 + 0.5 * ((gx + i) % 2));
      ctx.beginPath();
      ctx.moveTo(baseX, y + size * 0.95);
      ctx.bezierCurveTo(
        baseX + size * (0.25 - t * 0.5), y + size * 0.65,
        baseX - size * (0.2 - t * 0.4), y + size * 0.35,
        baseX + size * (0.15 - t * 0.3), y + size * 0.05,
      );
      ctx.stroke();
    }
  }
  ctx.restore();
}
