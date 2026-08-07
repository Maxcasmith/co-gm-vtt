import { TOKEN_R, FLASH_DUR } from './constants.ts';
import type { FlashEffect } from './types.ts';

export function drawToken(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  label: string, name: string,
  color: string,
  tokenR: number,
  hovered: boolean,
  img?: HTMLImageElement,
) {
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, tokenR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x - tokenR, y - tokenR, tokenR * 2, tokenR * 2);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, tokenR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(18 * (tokenR / TOKEN_R))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }
  ctx.beginPath();
  ctx.arc(x, y, tokenR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (hovered) {
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(11 * (tokenR / TOKEN_R))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name.length > 10 ? name.slice(0, 9) + '…' : name, x, y + tokenR + 12 * (tokenR / TOKEN_R));
  }
}

/** Pulsing red flash overlay on a token that just took a hit. No-op if this token has no active flash. */
export function drawHitFlash(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number, flash: FlashEffect | undefined) {
  if (!flash) return;
  const ft = (Date.now() - flash.startTime) / FLASH_DUR;
  ctx.save();
  ctx.globalAlpha = Math.sin(ft * Math.PI) * 0.6;
  ctx.fillStyle = '#ff2222';
  ctx.beginPath(); ctx.arc(x, y, tokenR, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Red targeting/AoE ring drawn around a token caught in an attack's range or template. */
export function drawTargetRing(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number) {
  ctx.beginPath();
  ctx.arc(x, y, tokenR + 6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/** Red × over a dead token. */
export function drawDeadMarker(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number) {
  const r = tokenR * 0.45;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
  ctx.restore();
}
