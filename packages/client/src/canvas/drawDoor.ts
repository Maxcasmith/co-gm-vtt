import type { DungeonEntity } from 'shared';

/** Closed-door glyph: a plain door shape with a handle dot, white strokes/fill on transparent. */
function drawClosedIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const w = r * 1.1, h = r * 1.5;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx + w * 0.28, cy, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
}

/** Open-door glyph: the same frame, but the door itself swung back against one jamb — reads as "ajar" at a glance. */
function drawOpenIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const w = r * 1.1, h = r * 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1, r * 0.1);
  // Frame
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  // Door swung open against the left jamb, seen edge-on as a thin diagonal
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy - h / 2);
  ctx.lineTo(cx - w / 2 + w * 0.22, cy + h * 0.1);
  ctx.stroke();
}

/**
 * Door map marker — a small square icon button centered on the door's footprint (which may be
 * fractional, e.g. a 1x2 doorway's true center sits between cells — see drawScene.ts's caller).
 * Fixed small size regardless of the footprint's actual cell span, unlike a decorative prop's
 * to-scale sprite: this is a button to click, not a drawn object to scale.
 */
export function drawDoorMarker(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number,
  state: DungeonEntity['doorState'], hovered: boolean,
): void {
  ctx.save();

  ctx.beginPath();
  ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.25);
  // Barely-there background once open (the doorway itself is what matters, not the button) —
  // a real fill only while closed/locked, where the button is standing in for a solid door.
  // Hover swaps in a lighter, white-tinted fill instead of an outline — reads as "pressable"
  // without adding a hard edge to an otherwise soft, semi-transparent shape.
  ctx.fillStyle = hovered
    ? 'rgba(255,255,255,0.35)'
    : state === 'open' ? 'rgba(20,16,10,0.15)' : 'rgba(20,16,10,0.55)';
  ctx.fill();

  if (state === 'open') drawOpenIcon(ctx, cx, cy, r * 0.72);
  else drawClosedIcon(ctx, cx, cy, r * 0.72);

  if (state === 'locked') {
    const lr = r * 0.4;
    const px = cx + r - lr * 0.9, py = cy - r + lr * 0.9;
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(px, py, lr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffd24d';
    ctx.lineWidth = Math.max(1, lr * 0.28);
    ctx.beginPath();
    ctx.arc(px, py - lr * 0.15, lr * 0.5, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#ffd24d';
    ctx.fillRect(px - lr * 0.35, py - lr * 0.1, lr * 0.7, lr * 0.6);
  }

  ctx.restore();
}
