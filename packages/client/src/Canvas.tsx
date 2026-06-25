import { useEffect, useRef, useState } from 'react';
import type { Player, EnemyStatBlock, Weapon } from 'shared';
import { dispatch, on } from './events.ts';
import './app.css';

const CELL = 64;
const TOKEN_R = 24;
const FLOAT_DUR  = 950;   // ms for floating text
const FLASH_DUR  = 220;   // ms for token flash

interface FloatEffect { id: number; x: number; y: number; text: string; isHit: boolean; startTime: number }
interface FlashEffect { tokenKey: string; startTime: number }

interface Props {
  player: Player;
  characterId: string;
  connected: Player[];
  showBattleMap?: boolean;
  encounter?: EnemyStatBlock[] | null;
  tokenUrls?: Record<string, string>;
  tokenPositions?: Record<string, { gx: number; gy: number }>;
  movementRemaining?: number;
  deadCreatureIds?: Set<string>;
  downPlayerNames?: Set<string>;
  deadPlayerNames?: Set<string>;
}

function drawToken(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  label: string, name: string,
  color: string,
  img?: HTMLImageElement,
) {
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, TOKEN_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x - TOKEN_R, y - TOKEN_R, TOKEN_R * 2, TOKEN_R * 2);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, TOKEN_R, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }
  ctx.beginPath();
  ctx.arc(x, y, TOKEN_R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name.length > 10 ? name.slice(0, 9) + '…' : name, x, y + TOKEN_R + 12);
}

export default function Canvas({ player, characterId, connected, showBattleMap, encounter, tokenUrls, tokenPositions, movementRemaining = 0, deadCreatureIds, downPlayerNames, deadPlayerNames }: Props) {
  const ref            = useRef<HTMLCanvasElement>(null);
  const tokenImgCache  = useRef<Record<string, HTMLImageElement>>({});
  const [tokenCacheVer, setTokenCacheVer] = useState(0);

  // Refs to give window-level handlers (empty deps) access to latest prop values
  const playerRef           = useRef(player);
  const tokenPositionsRef   = useRef(tokenPositions);
  const movementRef         = useRef(movementRemaining);
  useEffect(() => { playerRef.current = player; },               [player]);
  useEffect(() => { tokenPositionsRef.current = tokenPositions; }, [tokenPositions]);
  useEffect(() => { movementRef.current = movementRemaining; },   [movementRemaining]);

  // Hit/miss visual effects
  const floatEffectsRef = useRef<FloatEffect[]>([]);
  const flashEffectsRef = useRef<FlashEffect[]>([]);
  const [animTick, setAnimTick] = useState(0);
  const animRafRef = useRef<number | null>(null);

  function kickAnimLoop() {
    if (animRafRef.current !== null) return;
    function tick() {
      const now = Date.now();
      floatEffectsRef.current = floatEffectsRef.current.filter(e => now - e.startTime < FLOAT_DUR);
      flashEffectsRef.current = flashEffectsRef.current.filter(e => now - e.startTime < FLASH_DUR);
      setAnimTick(t => t + 1);
      if (floatEffectsRef.current.length > 0 || flashEffectsRef.current.length > 0) {
        animRafRef.current = requestAnimationFrame(tick);
      } else {
        animRafRef.current = null;
      }
    }
    animRafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => on('vtt:combat:attack:result', result => {
    const posById   = tokenPositionsRef.current?.[result.targetId];
    const posByName = tokenPositionsRef.current?.[result.targetName];
    const pos       = posById ?? posByName;
    const tokenKey  = posById ? result.targetId : result.targetName;
    if (!pos) return;
    const x = pos.gx * CELL + CELL / 2;
    const y = pos.gy * CELL + CELL / 2;
    const now = Date.now();
    if (result.hit && result.damage != null) {
      flashEffectsRef.current.push({ tokenKey, startTime: now });
      floatEffectsRef.current.push({ id: now, x, y, text: `-${result.damage}`, isHit: true, startTime: now });
    } else if (!result.hit) {
      floatEffectsRef.current.push({ id: now, x, y, text: 'Miss', isHit: false, startTime: now });
    }
    kickAnimLoop();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag state — refs keep closures fresh inside window listeners
  const dragRef     = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragOffset  = useRef({ x: 0, y: 0 });
  const [dragTick, setDragTick] = useState(0);

  // Targeting state — ref for window handlers, state for draw trigger
  const targetingRef = useRef<Weapon | null>(null);
  const [targeting, setTargeting] = useState<Weapon | null>(null);

  // Turn state — true when no combat active (free movement) or when it's this player's turn
  const isMyTurnRef = useRef(true);
  useEffect(() => on('vtt:combat:state', ({ active }) => { if (!active) isMyTurnRef.current = true; }), []);
  useEffect(() => on('vtt:combat:turn', ({ actorName }) => { isMyTurnRef.current = actorName === playerRef.current; }), []);

  useEffect(() => {
    if (!tokenUrls) return;
    let pending = Object.keys(tokenUrls).length;
    if (pending === 0) return;
    Object.entries(tokenUrls).forEach(([name, url]) => {
      if (tokenImgCache.current[name]) { pending--; return; }
      const img = new Image();
      img.onload = () => { tokenImgCache.current[name] = img; pending--; if (pending === 0) setTokenCacheVer(v => v + 1); };
      img.onerror = () => { pending--; };
      img.src = url;
    });
  }, [tokenUrls]);

  // Subscribe to targeting events (registered once)
  useEffect(() => {
    const u1 = on('vtt:targeting:start', ({ weapon }) => {
      targetingRef.current = weapon;
      setTargeting(weapon);
    });
    const u2 = on('vtt:targeting:cancel', () => {
      targetingRef.current = null;
      setTargeting(null);
      if (ref.current) ref.current.style.cursor = 'default';
    });
    const u3 = on('vtt:combat:attack', () => {
      targetingRef.current = null;
      setTargeting(null);
    });
    return () => { u1(); u2(); u3(); };
  }, []);

  // Window-level drag move + drop + Esc-cancel (registered once)
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = { ...drag, x: e.clientX - rect.left - dragOffset.current.x, y: e.clientY - rect.top - dragOffset.current.y };
      setDragTick(t => t + 1);
    }

    function onUp() {
      const drag = dragRef.current;
      if (!drag) return;
      const gx = Math.max(0, Math.floor(drag.x / CELL));
      const gy = Math.max(0, Math.floor(drag.y / CELL));

      // Movement accounting for the player's own token
      if (drag.id === playerRef.current) {
        const oldPos = tokenPositionsRef.current?.[drag.id];
        if (oldPos && movementRef.current === 0) {
          // No movement left — snap back to last stationary position
          dispatch('vtt:token:move', { tokenId: drag.id, gx: oldPos.gx, gy: oldPos.gy });
          dragRef.current = null;
          if (ref.current) ref.current.style.cursor = 'default';
          setDragTick(t => t + 1);
          return;
        }
        if (oldPos) {
          const dist = Math.max(Math.abs(gx - oldPos.gx), Math.abs(gy - oldPos.gy));
          if (dist > 0) dispatch('vtt:movement:used', { ft: dist * 5 });
        }
      }

      dispatch('vtt:token:move', { tokenId: drag.id, gx, gy });
      dragRef.current = null;
      if (ref.current) ref.current.style.cursor = 'default';
      setDragTick(t => t + 1);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && targetingRef.current) {
        targetingRef.current = null;
        setTargeting(null);
        dispatch('vtt:targeting:cancel', {});
        if (ref.current) ref.current.style.cursor = 'default';
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Draw
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== canvas.offsetWidth)  canvas.width  = canvas.offsetWidth;
    if (canvas.height !== canvas.offsetHeight) canvas.height = canvas.offsetHeight;

    if (showBattleMap) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= canvas.width;  x += CELL) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvas.height); }
      for (let y = 0; y <= canvas.height; y += CELL) { ctx.moveTo(0, y + 0.5); ctx.lineTo(canvas.width, y + 0.5); }
      ctx.stroke();

      if (encounter && tokenPositions) {
        const drag = dragRef.current;
        const playerPos = tokenPositions[player];

        // Movement range highlight — shown while dragging own token
        if (drag?.id === player && playerPos && movementRemaining > 0) {
          const reach = Math.floor(movementRemaining / 5);
          ctx.fillStyle = 'rgba(255, 200, 50, 0.13)';
          for (let dx = -reach; dx <= reach; dx++) {
            for (let dy = -reach; dy <= reach; dy++) {
              if (dx === 0 && dy === 0) continue;
              const tx = playerPos.gx + dx;
              const ty = playerPos.gy + dy;
              if (tx < 0 || ty < 0) continue;
              ctx.fillRect(tx * CELL, ty * CELL, CELL, CELL);
            }
          }
          // Subtle border around the range edge
          ctx.strokeStyle = 'rgba(255, 200, 50, 0.3)';
          ctx.lineWidth = 1;
          for (let dx = -reach; dx <= reach; dx++) {
            for (let dy = -reach; dy <= reach; dy++) {
              const tx = playerPos.gx + dx;
              const ty = playerPos.gy + dy;
              if (tx < 0 || ty < 0) continue;
              const onEdge = Math.abs(dx) === reach || Math.abs(dy) === reach;
              if (!onEdge) continue;
              ctx.strokeRect(tx * CELL + 0.5, ty * CELL + 0.5, CELL - 1, CELL - 1);
            }
          }
        }

        // Targeting range highlights (drawn under tokens)
        if (targeting && playerPos) {
          const rangeCells = Math.floor(targeting.range / 5);
          const extRangeCells = targeting.extendedRange ? Math.floor(targeting.extendedRange / 5) : 0;

          // Extended range cells (dimmer) — drawn first so normal range overpaints them
          if (extRangeCells > rangeCells) {
            for (let dx = -extRangeCells; dx <= extRangeCells; dx++) {
              for (let dy = -extRangeCells; dy <= extRangeCells; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (Math.abs(dx) <= rangeCells && Math.abs(dy) <= rangeCells) continue;
                const tx = playerPos.gx + dx;
                const ty = playerPos.gy + dy;
                if (tx < 0 || ty < 0) continue;
                ctx.fillStyle = 'rgba(255, 200, 50, 0.06)';
                ctx.fillRect(tx * CELL, ty * CELL, CELL, CELL);
                ctx.strokeStyle = 'rgba(255, 200, 50, 0.18)';
                ctx.lineWidth = 1;
                ctx.strokeRect(tx * CELL + 1, ty * CELL + 1, CELL - 2, CELL - 2);
              }
            }
          }

          // Normal range cells (brighter)
          for (let dx = -rangeCells; dx <= rangeCells; dx++) {
            for (let dy = -rangeCells; dy <= rangeCells; dy++) {
              if (dx === 0 && dy === 0) continue;
              const tx = playerPos.gx + dx;
              const ty = playerPos.gy + dy;
              if (tx < 0 || ty < 0) continue;
              ctx.fillStyle = 'rgba(255, 200, 50, 0.18)';
              ctx.fillRect(tx * CELL, ty * CELL, CELL, CELL);
              ctx.strokeStyle = 'rgba(255, 200, 50, 0.55)';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(tx * CELL + 1, ty * CELL + 1, CELL - 2, CELL - 2);
            }
          }
        }

        // Party tokens
        connected.forEach(name => {
          const pos = tokenPositions[name];
          if (!pos) return;
          const isDragged = drag?.id === name;
          const x = isDragged ? drag!.x : pos.gx * CELL + CELL / 2;
          const y = isDragged ? drag!.y : pos.gy * CELL + CELL / 2;
          const img = tokenImgCache.current[name];
          const isDead = deadPlayerNames?.has(name) ?? false;
          const isDown = !isDead && (downPlayerNames?.has(name) ?? false);

          if (name === player && !isDown && !isDead) {
            ctx.beginPath();
            ctx.arc(x, y, TOKEN_R + 4, 0, Math.PI * 2);
            ctx.strokeStyle = isDragged ? 'rgba(255,220,50,0.9)' : 'rgba(255,220,50,0.4)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          if (isDead) ctx.filter = 'grayscale(1) opacity(0.25)';
          else if (isDown) ctx.filter = 'grayscale(1) opacity(0.55)';
          drawToken(ctx, x, y, (name[0] ?? '?').toUpperCase(), name, name === player ? '#3a7bd5' : '#5a9ff5', img);
          ctx.filter = 'none';

          // Hit flash overlay
          const playerFlash = flashEffectsRef.current.find(f => f.tokenKey === name);
          if (playerFlash) {
            const ft = (Date.now() - playerFlash.startTime) / FLASH_DUR;
            ctx.save();
            ctx.globalAlpha = Math.sin(ft * Math.PI) * 0.6;
            ctx.fillStyle = '#ff2222';
            ctx.beginPath(); ctx.arc(x, y, TOKEN_R, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }

          // Dead marker: a red × over the token
          if (isDead) {
            const r = TOKEN_R * 0.45;
            ctx.save();
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = '#c0392b';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
            ctx.restore();
          }
        });

        // Enemy tokens
        encounter.forEach(enemy => {
          const pos = tokenPositions[enemy.id];
          if (!pos) return;
          const isDragged = drag?.id === enemy.id;
          const x = isDragged ? drag!.x : pos.gx * CELL + CELL / 2;
          const y = isDragged ? drag!.y : pos.gy * CELL + CELL / 2;

          // Red targeting ring for enemies in weapon range
          if (targeting && playerPos) {
            const dist = Math.max(Math.abs(pos.gx - playerPos.gx), Math.abs(pos.gy - playerPos.gy));
            const inNormal = dist <= Math.floor(targeting.range / 5);
            const inExtended = !inNormal && !!targeting.extendedRange && dist <= Math.floor(targeting.extendedRange / 5);
            if (inNormal) {
              ctx.beginPath();
              ctx.arc(x, y, TOKEN_R + 6, 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
              ctx.lineWidth = 2.5;
              ctx.stroke();
            } else if (inExtended) {
              ctx.save();
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.arc(x, y, TOKEN_R + 6, 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(255, 60, 60, 0.45)';
              ctx.lineWidth = 2;
              ctx.stroke();
              ctx.restore();
            }
          }

          const isDead = deadCreatureIds?.has(enemy.id);
          if (isDead) ctx.filter = 'grayscale(1) opacity(0.45)';
          drawToken(ctx, x, y, (enemy.name[0] ?? '?').toUpperCase(), enemy.name, isDead ? '#555' : '#c0392b');
          if (isDead) ctx.filter = 'none';

          // Hit flash overlay
          const enemyFlash = flashEffectsRef.current.find(f => f.tokenKey === enemy.id);
          if (enemyFlash) {
            const ft = (Date.now() - enemyFlash.startTime) / FLASH_DUR;
            ctx.save();
            ctx.globalAlpha = Math.sin(ft * Math.PI) * 0.6;
            ctx.fillStyle = '#ff2222';
            ctx.beginPath(); ctx.arc(x, y, TOKEN_R, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
        });

        // Drag line: origin → cursor with distance label at midpoint
        if (drag?.id === player && playerPos) {
          const ox = playerPos.gx * CELL + CELL / 2;
          const oy = playerPos.gy * CELL + CELL / 2;
          const cx = drag.x;
          const cy = drag.y;
          const snapGx = Math.max(0, Math.floor(cx / CELL));
          const snapGy = Math.max(0, Math.floor(cy / CELL));
          const dist = Math.max(Math.abs(snapGx - playerPos.gx), Math.abs(snapGy - playerPos.gy)) * 5;

          if (dist > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(ox, oy);
            ctx.lineTo(cx, cy);
            ctx.strokeStyle = 'rgba(255, 200, 50, 0.55)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);

            const mx = (ox + cx) / 2;
            const my = (oy + cy) / 2;
            const label = `${dist}ft`;
            ctx.font = 'bold 11px monospace';
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(14, 12, 20, 0.75)';
            ctx.beginPath();
            ctx.roundRect(mx - tw / 2 - 5, my - 9, tw + 10, 18, 4);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 200, 50, 0.95)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, mx, my);
            ctx.restore();
          }
        }
      }
        // Floating hit/miss text
        const now = Date.now();
        for (const eff of floatEffectsRef.current) {
          const t = Math.min((now - eff.startTime) / FLOAT_DUR, 1);
          const scale   = t < 0.2 ? 0.3 + (t / 0.2) * 0.85 : 1.15 - t * 0.15; // pop up, slight shrink
          const yOff    = -t * 55;
          const alpha   = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
          const rot     = Math.sin(t * Math.PI * 2.5) * 0.13;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(eff.x, eff.y + yOff);
          ctx.rotate(rot);
          ctx.scale(scale, scale);
          ctx.font = 'bold 21px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.95)';
          ctx.shadowBlur = 7;
          ctx.fillStyle = eff.isHit ? '#ff4040' : '#ffffff';
          ctx.fillText(eff.text, 0, 0);
          ctx.restore();
        }
    } else {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e0e0e0';
      ctx.font = '14px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`You: ${player}`, 20, 40);
      ctx.fillStyle = '#888';
      ctx.fillText('Connected:', 20, 80);
      connected.forEach((p, i) => {
        ctx.fillStyle = p === player ? '#7eb8f7' : '#c0c0c0';
        ctx.fillText(`• ${p}`, 20, 100 + i * 24);
      });
    }
  }, [player, connected, showBattleMap, encounter, tokenCacheVer, tokenPositions, dragTick, targeting, movementRemaining, downPlayerNames, deadPlayerNames, animTick]);

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!showBattleMap || !encounter || !tokenPositions) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Block all interaction when it's not this player's turn
    if (!isMyTurnRef.current) return;

    // Targeting mode: resolve attack or cancel
    if (targetingRef.current) {
      const weapon = targetingRef.current;
      const playerPos = tokenPositions[player];
      if (playerPos) {
        const maxRangeCells = weapon.extendedRange
          ? Math.floor(weapon.extendedRange / 5)
          : Math.floor(weapon.range / 5);
        for (const enemy of encounter) {
          const epos = tokenPositions[enemy.id];
          if (!epos) continue;
          if (Math.max(Math.abs(epos.gx - playerPos.gx), Math.abs(epos.gy - playerPos.gy)) > maxRangeCells) continue;
          const ex = epos.gx * CELL + CELL / 2;
          const ey = epos.gy * CELL + CELL / 2;
          if (Math.hypot(mx - ex, my - ey) <= TOKEN_R) {
            dispatch('vtt:combat:attack', { attackerName: player, attackerId: characterId, targetId: enemy.id, targetName: enemy.name, weapon });
            e.preventDefault();
            return;
          }
        }
      }
      // Clicked empty — cancel targeting
      dispatch('vtt:targeting:cancel', {});
      e.preventDefault();
      return;
    }

    // Drag mode: own token only
    const pos = tokenPositions[player];
    if (!pos) return;
    const cx = pos.gx * CELL + CELL / 2;
    const cy = pos.gy * CELL + CELL / 2;
    if (Math.hypot(mx - cx, my - cy) <= TOKEN_R) {
      dragRef.current = { id: player, x: cx, y: cy };
      dragOffset.current = { x: mx - cx, y: my - cy };
      e.currentTarget.style.cursor = 'grabbing';
      e.preventDefault();
    }
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!tokenPositions) return;
    const pos = tokenPositions[player];
    if (!pos) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cx = pos.gx * CELL + CELL / 2;
    const cy = pos.gy * CELL + CELL / 2;
    if (Math.hypot(mx - cx, my - cy) <= TOKEN_R) {
      dispatch('vtt:sheet:opened', { characterId });
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dragRef.current) return;

    // Targeting mode cursor
    if (targetingRef.current && showBattleMap && encounter && tokenPositions) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const playerPos = tokenPositions[player];
      if (playerPos) {
        const maxRangeCells = targetingRef.current.extendedRange
          ? Math.floor(targetingRef.current.extendedRange / 5)
          : Math.floor(targetingRef.current.range / 5);
        for (const enemy of encounter) {
          const epos = tokenPositions[enemy.id];
          if (!epos || Math.max(Math.abs(epos.gx - playerPos.gx), Math.abs(epos.gy - playerPos.gy)) > maxRangeCells) continue;
          const ex = epos.gx * CELL + CELL / 2;
          const ey = epos.gy * CELL + CELL / 2;
          if (Math.hypot(mx - ex, my - ey) <= TOKEN_R) {
            e.currentTarget.style.cursor = 'crosshair';
            return;
          }
        }
      }
      e.currentTarget.style.cursor = 'default';
      return;
    }

    // Normal: grab cursor over own token
    if (!showBattleMap || !tokenPositions) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pos = tokenPositions[player];
    if (!pos) return;
    const cx = pos.gx * CELL + CELL / 2;
    const cy = pos.gy * CELL + CELL / 2;
    e.currentTarget.style.cursor = Math.hypot(mx - cx, my - cy) <= TOKEN_R ? 'grab' : 'default';
  }

  return (
    <canvas
      ref={ref}
      className="canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onDoubleClick={handleDoubleClick}
    />
  );
}
