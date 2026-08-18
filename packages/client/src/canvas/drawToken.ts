import { TOKEN_R, FLASH_DUR, BUFF_PULSE_PERIOD, IMPACT_DUR } from './constants.ts';
import type { FlashEffect, TokenSpecialEffect } from './types.ts';

/** Jagged-tooth ring with a crossed trigger plate — reads as a snare/trap at a glance. White outline only. */
function drawTrapIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const teeth = 8;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const ang = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r * 0.85 : r * 0.5;
    const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  const cr = r * 0.22;
  ctx.beginPath();
  ctx.moveTo(x - cr, y - cr); ctx.lineTo(x + cr, y + cr);
  ctx.moveTo(x + cr, y - cr); ctx.lineTo(x - cr, y + cr);
  ctx.stroke();
}

export function drawToken(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  label: string, name: string,
  color: string,
  tokenR: number,
  hovered: boolean,
  zoom: number,
  img?: HTMLImageElement,
  icon?: 'trap',
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
    if (icon === 'trap') {
      drawTrapIcon(ctx, x, y, tokenR * 0.8);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(18 * (tokenR / TOKEN_R))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y);
    }
  }
  ctx.beginPath();
  ctx.arc(x, y, tokenR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (hovered) {
    // Sized off zoom, not tokenR/TOKEN_R — a trap's marker circle (DUNGEON_ENTITY_R) is smaller
    // than a player token's (TOKEN_R), but its hover nameplate should read at the exact same
    // pixel size as hovering a player token at the same zoom, not scaled down with the circle.
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(11 * zoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name.length > 10 ? name.slice(0, 9) + '…' : name, x, y + tokenR + 12 * zoom);
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

const AURA_RING_COUNT = 2; // two staggered rings of the same color, for a continuous pulse
const SHARD_COUNT = 10; // radiating shards on impact burst

/** Jagged star-ring path, used for both the aura crackle and the impact shockwave. */
function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, spikes: number, outerR: number, innerR: number, rotation: number) {
  ctx.beginPath();
  let rot = rotation - Math.PI / 2;
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes; i++) {
    const ox = x + Math.cos(rot) * outerR, oy = y + Math.sin(rot) * outerR;
    if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
    rot += step;
    const ix = x + Math.cos(rot) * innerR, iy = y + Math.sin(rot) * innerR;
    ctx.lineTo(ix, iy);
    rot += step;
  }
  ctx.closePath();
}

/** Two staggered, slowly-rotating jagged rings, same color — a crackling energy pulse, loops for as long as the effect exists. */
function drawAura(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number, color: string, startTime: number) {
  const elapsed = Date.now() - startTime;
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  for (let i = 0; i < AURA_RING_COUNT; i++) {
    const phase = ((elapsed + (i * BUFF_PULSE_PERIOD) / AURA_RING_COUNT) % BUFF_PULSE_PERIOD) / BUFF_PULSE_PERIOD;
    const rotation = elapsed / 900 + i * Math.PI;
    const outerR = tokenR + 4 + phase * tokenR * 1.1;
    starPath(ctx, x, y, 7, outerR, outerR * 0.72, rotation);
    ctx.strokeStyle = color;
    ctx.globalAlpha = (1 - phase) * 0.85;
    ctx.stroke();
  }
  ctx.restore();
}

/** One-shot explosion — flash core, jagged shockwave ring, and radiating shards — the armed buff's power released into the hit that just landed. */
function drawImpact(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number, color: string, startTime: number) {
  const t = Math.min((Date.now() - startTime) / IMPACT_DUR, 1);
  const fade = 1 - t;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;

  ctx.globalAlpha = fade * 0.9;
  const flashR = tokenR * (0.4 + t * 0.6);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, flashR);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.4, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, flashR, 0, Math.PI * 2); ctx.fill();

  ctx.globalAlpha = fade * 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  starPath(ctx, x, y, 9, tokenR + 6 + t * tokenR * 1.6, tokenR * 0.5 + t * tokenR, t * 3);
  ctx.stroke();

  ctx.globalAlpha = fade;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const ang = (i / SHARD_COUNT) * Math.PI * 2 + t * 0.5;
    const innerR = tokenR * 0.7 + t * tokenR * 0.4;
    const outerR = tokenR + t * tokenR * (1.8 + (i % 3) * 0.3);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * innerR, y + Math.sin(ang) * innerR);
    ctx.lineTo(x + Math.cos(ang) * outerR, y + Math.sin(ang) * outerR);
    ctx.stroke();
  }
  ctx.restore();
}

const FLAME_COUNT = 8;

/** One flickering flame lick, base at (bx,by) pointing outward along `ang`, tapering to a tip over height `h`. */
function drawFlameLick(ctx: CanvasRenderingContext2D, bx: number, by: number, ang: number, h: number, w: number) {
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const px = -uy, py = ux;
  const tipX = bx + ux * h, tipY = by + uy * h;
  const midX = bx + ux * h * 0.55, midY = by + uy * h * 0.55;
  const grad = ctx.createLinearGradient(bx, by, tipX, tipY);
  grad.addColorStop(0, '#fff3b0');
  grad.addColorStop(0.4, '#ffb020');
  grad.addColorStop(1, '#c81e0a');
  ctx.beginPath();
  ctx.moveTo(bx - px * w, by - py * w);
  ctx.quadraticCurveTo(midX - px * w * 0.6, midY - py * w * 0.6, tipX, tipY);
  ctx.quadraticCurveTo(midX + px * w * 0.6, midY + py * w * 0.6, bx + px * w, by + py * w);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

/** Flickering flame licks ringing the token — loops for as long as the effect exists. */
function drawFireAura(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number, startTime: number) {
  const elapsed = Date.now() - startTime;
  ctx.save();
  ctx.shadowColor = '#ff6a00';
  ctx.shadowBlur = 12;
  ctx.globalAlpha = 0.9;
  for (let i = 0; i < FLAME_COUNT; i++) {
    const ang = (i / FLAME_COUNT) * Math.PI * 2;
    const flicker = Math.sin(elapsed / 120 + i * 1.7) * 0.5 + 0.5;
    const sway = Math.sin(elapsed / 180 + i * 2.3) * 0.25;
    const bx = x + Math.cos(ang) * (tokenR - 2), by = y + Math.sin(ang) * (tokenR - 2);
    drawFlameLick(ctx, bx, by, ang + sway, 10 + flicker * 14, 5 + flicker * 3);
  }
  ctx.restore();
}

/** One-shot fireball explosion — white-hot core fading through orange to red, with flame licks blasting outward. */
function drawFireImpact(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number, startTime: number) {
  const t = Math.min((Date.now() - startTime) / IMPACT_DUR, 1);
  ctx.save();
  ctx.shadowColor = '#ff5500';
  ctx.shadowBlur = 20;
  ctx.globalAlpha = 1 - t;

  const coreR = tokenR * (0.5 + t * 0.5);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, coreR);
  grad.addColorStop(0, '#fff8dc');
  grad.addColorStop(0.35, '#ffb020');
  grad.addColorStop(0.7, '#ff4400');
  grad.addColorStop(1, 'rgba(120,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, coreR, 0, Math.PI * 2); ctx.fill();

  for (let i = 0; i < FLAME_COUNT; i++) {
    const ang = (i / FLAME_COUNT) * Math.PI * 2 + t * 1.2;
    const baseR = tokenR * 0.5 + t * tokenR * 0.5;
    const bx = x + Math.cos(ang) * baseR, by = y + Math.sin(ang) * baseR;
    const h = tokenR * (0.6 + t * 0.9) * (0.7 + (i % 3) * 0.15);
    drawFlameLick(ctx, bx, by, ang, h, 6 + t * 4);
  }
  ctx.restore();
}

/** Dispatches a token's active special effect (armed-buff aura or hit-landed impact burst) to its renderer. No-op if this token has no active effect. */
export function drawTokenEffect(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number, effect: TokenSpecialEffect | undefined) {
  if (!effect) return;
  if (effect.kind === 'aura') {
    if (effect.style === 'fire') drawFireAura(ctx, x, y, tokenR, effect.startTime);
    else drawAura(ctx, x, y, tokenR, effect.color, effect.startTime);
  } else {
    if (effect.style === 'fire') drawFireImpact(ctx, x, y, tokenR, effect.startTime);
    else drawImpact(ctx, x, y, tokenR, effect.color, effect.startTime);
  }
}

/** Small gold diamond badge on a token's edge — marks whoever is concentrating on a spell. */
export function drawConcentrationBadge(ctx: CanvasRenderingContext2D, x: number, y: number, tokenR: number) {
  const bx = x + tokenR * 0.72, by = y - tokenR * 0.72;
  const r = Math.max(4, tokenR * 0.22);
  ctx.save();
  ctx.shadowColor = '#d4af37';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(bx, by - r); ctx.lineTo(bx + r, by); ctx.lineTo(bx, by + r); ctx.lineTo(bx - r, by);
  ctx.closePath();
  ctx.fillStyle = '#d4af37';
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,8,16,0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
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
