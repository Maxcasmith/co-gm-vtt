import { SWING_DUR } from './constants.ts';

/** Stylized slash mark near the target: tan-yellow blade with a deep red outline, fixed top-left → bottom-right diagonal, growing out from its top-left tip before fading. */
function drawSlashing(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, t: number) {
  const dx = toX - fromX, dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const cx = fromX + (dx / dist) * dist * 0.7;
  const cy = fromY + (dy / dist) * dist * 0.7;
  const half = 24; // half-length of the blade
  const angle = Math.PI / 4; // fixed diagonal, independent of attack direction
  const grow = Math.min(t / 0.35, 1); // quick extend from the top-left tip
  const fade = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
  const x0 = cx - Math.cos(angle) * half; // top-left tip, fixed
  const y0 = cy - Math.sin(angle) * half;
  const x1 = x0 + Math.cos(angle) * half * 2 * grow; // grows toward the bottom-right tip
  const y1 = y0 + Math.sin(angle) * half * 2 * grow;
  const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
  const bulge = 9;
  const px = -Math.sin(angle), py = Math.cos(angle); // perpendicular unit vector
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(midX + px * bulge, midY + py * bulge, x1, y1);
  ctx.quadraticCurveTo(midX - px * bulge, midY - py * bulge, x0, y0);
  ctx.closePath();
  ctx.fillStyle = '#e0b84a';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#7a1414';
  ctx.stroke();
  ctx.restore();
}

/** Blunt impact crater near the target: a stone-gray disc with radiating crack lines, punching out then fading. */
function drawBludgeoning(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, t: number) {
  const dx = toX - fromX, dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const cx = fromX + (dx / dist) * dist * 0.75;
  const cy = fromY + (dy / dist) * dist * 0.75;
  const grow = Math.min(t / 0.3, 1);
  const fade = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
  const r = 15 * grow;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#a9825f';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a281c';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.3;
    const len = r * (1.6 + (i % 2) * 0.5);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * r * 0.6, cy + Math.sin(ang) * r * 0.6);
    ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/** Thin steel lance streaking attacker → target with a tapered point — punches in fast, then fades. */
function drawPiercing(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, t: number) {
  const dx = toX - fromX, dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const lead = Math.min(t * 1.6, 1);
  const tipX = fromX + dx * lead, tipY = fromY + dy * lead;
  const tailX = fromX + dx * Math.max(lead - 0.28, 0), tailY = fromY + dy * Math.max(lead - 0.28, 0);
  const px = -uy, py = ux;
  const fade = 1 - Math.max(t - 0.5, 0) / 0.5;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#eef0f5';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tailX + px * 2.5, tailY + py * 2.5);
  ctx.lineTo(tailX - px * 2.5, tailY - py * 2.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a8a9a';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** A weapon attack's baseline swing effect between attacker and target, keyed by damage type — fading over SWING_DUR. */
export function drawSwing(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number, toX: number, toY: number,
  kind: 'slashing' | 'bludgeoning' | 'piercing',
  startTime: number,
) {
  const t = Math.min((Date.now() - startTime) / SWING_DUR, 1);
  if (kind === 'slashing') drawSlashing(ctx, fromX, fromY, toX, toY, t);
  else if (kind === 'bludgeoning') drawBludgeoning(ctx, fromX, fromY, toX, toY, t);
  else drawPiercing(ctx, fromX, fromY, toX, toY, t);
}
