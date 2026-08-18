import type { RefObject } from 'react';
import type { Dungeon, EnemyStatBlock, Player, TurnOrderEntry } from 'shared';
import { parseRangeFeet, spellTargetCount } from 'shared';
import type { TargetingStartPayload } from '../events.ts';
import { texturesFor, getImage, FLOOR_FALLBACK_COLOR } from '../dungeonThemes.ts';
import { CELL, TOKEN_R, DUNGEON_ENTITY_R, FLOAT_DUR, DUNGEON_BG, FOG_OF_WAR_COLOR } from './constants.ts';
import { bfsReachable } from './geometry.ts';
import { inArea, resolveAoeOrigin, drawAoeShape, nearestRingCell } from './aoe.ts';
import { drawToken, drawHitFlash, drawTargetRing, drawDeadMarker, drawTokenEffect, drawConcentrationBadge } from './drawToken.ts';
import { drawHazardCell } from './drawHazard.ts';
import { drawSwing } from './drawSwing.ts';
import { computeLighting, applyGroundLighting, tokenLightFilter } from './lighting.ts';
import type { FloatEffect, FlashEffect, TokenSpecialEffect, SwingEffect, SenseCells } from './types.ts';

export interface DrawSceneParams {
  showBattleMap?: boolean;
  dungeon?: Dungeon;
  encounter?: EnemyStatBlock[] | null;
  hoveredTokenKey: string | null;
  tokenPositions?: Record<string, { gx: number; gy: number }>;
  player: Player;
  movementRemaining: number;
  targeting: TargetingStartPayload | null;
  connected: Player[];
  deadPlayerNames?: Set<string>;
  downPlayerNames?: Set<string>;
  concentrating: Record<string, string>;
  deadCreatureIds?: Set<string>;
  companions: TurnOrderEntry[];
  visiblePolygon: { x: number; y: number }[] | null;
  litCells: Set<string> | null;
  senses: SenseCells | null;
  elevations: Record<string, number>;
  visibleCells: Set<string> | null;
  hoverHitChance: { percent: number; x: number; y: number } | null;
  multiTargetCursor: { x: number; y: number } | null;
  multiTargetsPicked: number;
  floorVariantRef: RefObject<{ dungeonId: string | null; picks: Map<string, number> }>;
  dungeonZoomRef: RefObject<number>;
  dungeonPanRef: RefObject<{ x: number; y: number }>;
  dragRef: RefObject<{ id: string; x: number; y: number } | null>;
  reachableRef: RefObject<Set<string> | null>;
  aoeMouseRef: RefObject<{ gx: number; gy: number } | null>;
  tokenImgCache: RefObject<Record<string, HTMLImageElement>>;
  flashEffectsRef: RefObject<FlashEffect[]>;
  tokenEffectsRef: RefObject<TokenSpecialEffect[]>;
  floatEffectsRef: RefObject<FloatEffect[]>;
  swingEffectsRef: RefObject<SwingEffect[]>;
}

/**
 * The whole battle-map render — one call per draw effect run in Canvas.tsx. Pulled out of the
 * component because it's pure imperative canvas painting with no React hooks inside; the params
 * object is just every piece of state/ref the original inline effect closed over, unchanged.
 *
 * Painted in explicit layers, back to front: ground (map/hazards/entity markers, dimmed/
 * desaturated by lighting as a whole) → token sprites (each token individually dimmed/desaturated
 * per its own cell — own token is the only one exempt) → fog-of-war → per-token effects (rings,
 * flashes, auras/impacts, dead markers, swings) → text (floats,
 * elevation badges, hit-chance/multi-target readouts), which is always the top layer so it's never
 * obscured by an effect or a token drawn later in the same frame.
 */
export function drawScene(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, p: DrawSceneParams): void {
  const {
    showBattleMap, dungeon, encounter, hoveredTokenKey, tokenPositions, player, movementRemaining,
    targeting, connected, deadPlayerNames, downPlayerNames, concentrating, deadCreatureIds,
    companions, visiblePolygon, litCells, senses, elevations, visibleCells,
    hoverHitChance, multiTargetCursor, multiTargetsPicked,
    floorVariantRef, dungeonZoomRef, dungeonPanRef, dragRef, reachableRef, aoeMouseRef,
    tokenImgCache, flashEffectsRef, tokenEffectsRef, floatEffectsRef, swingEffectsRef,
  } = p;

  if (showBattleMap) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const panX = dungeonPanRef.current.x;
      const panY = dungeonPanRef.current.y;
      const zoom = dungeonZoomRef.current;
      const cellSz = CELL * zoom;
      const tokenR = TOKEN_R * zoom;
      const lighting = computeLighting(dungeon, senses);

      if (dungeon) {
        // Dungeon grid: wall background, then floor cells, then entity markers
        ctx.fillStyle = DUNGEON_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Base floor fallback (covers corridors + any cell not owned by a room, and shows through
        // until a room's texture finishes decoding), then per-room floor tiles drawn over their
        // own cells — irregular room shapes mean the bounding box can include cells that aren't
        // actually walkable, so this stays cell-checked.
        ctx.fillStyle = FLOOR_FALLBACK_COLOR;
        for (let row = 0; row < dungeon.height; row++) {
          for (let col = 0; col < dungeon.width; col++) {
            if (dungeon.cells[row]?.[col] === 1) {
              ctx.fillRect(col * cellSz + panX, row * cellSz + panY, cellSz, cellSz);
            }
          }
        }
        if (floorVariantRef.current.dungeonId !== dungeon.id) {
          floorVariantRef.current = { dungeonId: dungeon.id, picks: new Map() };
        }
        const variantPicks = floorVariantRef.current.picks;
        for (const room of dungeon.rooms) {
          const variants = texturesFor(dungeon.theme, room.material, dungeon.structureType);
          if (!variants.length) continue;
          for (let row = room.y; row < room.y + room.height; row++) {
            for (let col = room.x; col < room.x + room.width; col++) {
              if (dungeon.cells[row]?.[col] !== 1) continue;
              const key = `${row},${col}`;
              let variantIdx = variantPicks.get(key);
              if (variantIdx === undefined || variantIdx >= variants.length) {
                variantIdx = Math.floor(Math.random() * variants.length);
                variantPicks.set(key, variantIdx);
              }
              const img = getImage(variants[variantIdx]!);
              if (img.complete) {
                ctx.drawImage(img, col * cellSz + panX, row * cellSz + panY, cellSz, cellSz);
              }
            }
          }
        }

        // Subtle grid lines on floor only
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        for (let row = 0; row < dungeon.height; row++) {
          for (let col = 0; col < dungeon.width; col++) {
            if (dungeon.cells[row]?.[col] === 1) {
              ctx.strokeRect(col * cellSz + panX + 0.5, row * cellSz + panY + 0.5, cellSz - 1, cellSz - 1);
            }
          }
        }

        // Entrance/exit room overlays — per-cell, not a blanket rect: irregular room shapes mean
        // a room's bounding box can include wall cells that aren't actually part of the room.
        for (const room of dungeon.rooms) {
          if (!room.role) continue;
          ctx.fillStyle = room.role === 'entrance' ? 'rgba(60,200,90,0.18)' : 'rgba(220,170,30,0.18)';
          for (let row = room.y; row < room.y + room.height; row++) {
            for (let col = room.x; col < room.x + room.width; col++) {
              if (dungeon.cells[row]?.[col] === 1) ctx.fillRect(col * cellSz + panX, row * cellSz + panY, cellSz, cellSz);
            }
          }
        }

        // Lasting map hazards (Entangle's vines, Grease/Fog Cloud's smudge) — filled per cell,
        // under entities/tokens so nothing painted on top of them gets visually buried.
        for (const cell of dungeon.hazardCells ?? []) {
          if (!cell.style) continue;
          drawHazardCell(ctx, cell.gx, cell.gy, cell.gx * cellSz + panX, cell.gy * cellSz + panY, cellSz, cell.style, cell.color ?? '#888888');
        }

        // Entity markers
        const entityR = DUNGEON_ENTITY_R * dungeonZoomRef.current;
        for (const entity of dungeon.entities) {
          // Combat token (drawn below) replaces the marker for any creature in the active encounter
          if (entity.type === 'creature' && encounter) continue;
          const ex = entity.x * cellSz + cellSz / 2 + panX;
          const ey = entity.y * cellSz + cellSz / 2 + panY;
          // Party-placed traps (Snare, ...) get their own pip + "X's Snare" hover nameplate,
          // same treatment as a token — the party always sees where their own trap sits, unlike
          // an AI-authored trap that stays a plain dot until Perception finds it.
          if (entity.type === 'trap' && entity.placedBy) {
            drawToken(ctx, ex, ey, '', `${entity.placedBy}'s ${entity.name}`, 'rgba(150,60,220,0.85)', entityR, hoveredTokenKey === entity.id, zoom, undefined, 'trap');
            continue;
          }
          ctx.beginPath();
          ctx.arc(ex, ey, entityR, 0, Math.PI * 2);
          ctx.fillStyle = entity.type === 'creature' ? 'rgba(192,57,43,0.8)' : 'rgba(212,172,13,0.8)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else {
        // Plain battle map grid with pan/zoom
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const offX = ((panX % cellSz) + cellSz) % cellSz;
        const offY = ((panY % cellSz) + cellSz) % cellSz;
        for (let x = offX; x <= canvas.width;  x += cellSz) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvas.height); }
        for (let y = offY; y <= canvas.height; y += cellSz) { ctx.moveTo(0, y + 0.5); ctx.lineTo(canvas.width, y + 0.5); }
        ctx.stroke();
      }

      // Ground layer done — dim/desaturate the map painted above before anything else goes on top
      // of it, so the movement/targeting highlights and every token drawn afterward get their own
      // treatment (constant color for highlights, per-token dimming for tokens — see
      // tokenLightFilter below) rather than inheriting a second darkening pass from this one.
      if (dungeon) applyGroundLighting(ctx, dungeon, cellSz, panX, panY, litCells, senses, lighting);

      if ((encounter || dungeon) && tokenPositions) {
        const drag = dragRef.current;
        const playerPos = tokenPositions[player];

        // Movement range highlight — shown while dragging own token. Wall-aware (matches the
        // findPath gate on drop) when a dungeon grid is loaded; plain square in arena combat
        // with no grid to path against.
        if (drag?.id === player && playerPos && movementRemaining > 0) {
          const reach = Math.floor(movementRemaining / 5);
          ctx.fillStyle = 'rgba(255, 200, 50, 0.13)';
          if (dungeon) {
            const reachable = bfsReachable(dungeon.cells, playerPos.gx, playerPos.gy, reach);
            for (const key of reachable) {
              const [kx, ky] = key.split(',').map(Number) as [number, number];
              if (kx === playerPos.gx && ky === playerPos.gy) continue;
              ctx.fillRect(kx * cellSz + panX, ky * cellSz + panY, cellSz, cellSz);
            }
          } else {
            for (let dx = -reach; dx <= reach; dx++) {
              for (let dy = -reach; dy <= reach; dy++) {
                if (dx === 0 && dy === 0) continue;
                const tx = playerPos.gx + dx;
                const ty = playerPos.gy + dy;
                if (tx < 0 || ty < 0) continue;
                ctx.fillRect(tx * cellSz + panX, ty * cellSz + panY, cellSz, cellSz);
              }
            }
            ctx.strokeStyle = 'rgba(255, 200, 50, 0.3)';
            ctx.lineWidth = 1;
            for (let dx = -reach; dx <= reach; dx++) {
              for (let dy = -reach; dy <= reach; dy++) {
                const tx = playerPos.gx + dx;
                const ty = playerPos.gy + dy;
                if (tx < 0 || ty < 0) continue;
                const onEdge = Math.abs(dx) === reach || Math.abs(dy) === reach;
                if (!onEdge) continue;
                ctx.strokeRect(tx * cellSz + panX + 0.5, ty * cellSz + panY + 0.5, cellSz - 1, cellSz - 1);
              }
            }
          }
        }

        // Exploration movement highlight — wall-aware reachable cells, own eyes only
        if (drag?.id === player && reachableRef.current) {
          ctx.fillStyle = 'rgba(255, 200, 50, 0.13)';
          for (const key of reachableRef.current) {
            const [kx, ky] = key.split(',').map(Number) as [number, number];
            if (playerPos && kx === playerPos.gx && ky === playerPos.gy) continue;
            ctx.fillRect(kx * cellSz + panX, ky * cellSz + panY, cellSz, cellSz);
          }
        }

        // Targeting range highlights (drawn under tokens)
        const spellArea = targeting?.kind === 'spell' ? targeting.spell.combat?.area : undefined;
        if (targeting && playerPos && !spellArea) {
          const range = targeting.kind === 'weapon' ? targeting.weapon.range : parseRangeFeet(targeting.spell.range);
          const extendedRange = targeting.kind === 'weapon' ? targeting.weapon.extendedRange : undefined;
          const rangeCells = Math.floor(range / 5);
          const extRangeCells = extendedRange ? Math.floor(extendedRange / 5) : 0;

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
                ctx.fillRect(tx * cellSz + panX, ty * cellSz + panY, cellSz, cellSz);
                ctx.strokeStyle = 'rgba(255, 200, 50, 0.18)';
                ctx.lineWidth = 1;
                ctx.strokeRect(tx * cellSz + panX + 1, ty * cellSz + panY + 1, cellSz - 2, cellSz - 2);
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
              ctx.fillRect(tx * cellSz + panX, ty * cellSz + panY, cellSz, cellSz);
              ctx.strokeStyle = 'rgba(255, 200, 50, 0.55)';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(tx * cellSz + panX + 1, ty * cellSz + panY + 1, cellSz - 2, cellSz - 2);
            }
          }
        }

        // AoE spell template origin — shape itself is drawn after fog, below, so a template
        // extending past the visible radius still renders in full
        let aoeOrigin: { originGx: number; originGy: number; dirGx: number; dirGy: number; isSelf: boolean } | null = null;
        if (targeting?.kind === 'spell' && spellArea && playerPos) {
          aoeOrigin = resolveAoeOrigin(spellArea, playerPos, aoeMouseRef.current, parseRangeFeet(targeting.spell.range));
          // Trap placement picks one of the 8 ring cells around the player (see the matching
          // nearestRingCell() at cast time below) rather than the raw continuous cursor position.
          if (targeting.spell.combat?.placesTrap) {
            const cell = nearestRingCell(playerPos, aoeMouseRef.current);
            aoeOrigin = { ...aoeOrigin, originGx: cell.gx + 0.5, originGy: cell.gy + 0.5 };
          }
        }

        // A token is only worth an effect (ring/flash/aura/dead-marker) if its own cell is
        // actually visible — matches the fog-of-war paint below, which otherwise buries a token's
        // sprite; without this gate a hidden token's effects would still show since they're drawn
        // in a later, separate pass (see effectDraws below) rather than interleaved with the fog.
        const inSight = (gx: number, gy: number) => !dungeon || !visibleCells || visibleCells.has(`${gx},${gy}`);

        // Deferred so every token's ring/flash/aura/impact/dead-marker/concentration-badge paints
        // in one pass above every token's sprite, rather than each token's effects sitting right
        // on top of only that one sprite — see the module doc's layer order.
        const effectDraws: (() => void)[] = [];

        // Ally tokens — fogged the same as enemies; own token is drawn separately after fog and is
        // the only token exempt from lighting/darkvision dimming, see Canvas.tsx's caller.
        connected.forEach(name => {
          if (name === player) return;
          const pos = tokenPositions[name];
          if (!pos) return;
          const isDragged = drag?.id === name;
          const x = isDragged ? drag!.x : pos.gx * cellSz + cellSz / 2 + panX;
          const y = isDragged ? drag!.y : pos.gy * cellSz + cellSz / 2 + panY;
          const img = tokenImgCache.current[name];
          const isDead = deadPlayerNames?.has(name) ?? false;
          const isDown = !isDead && (downPlayerNames?.has(name) ?? false);

          const lightFilter = tokenLightFilter(pos.gx, pos.gy, litCells, senses, lighting);
          ctx.filter = isDead ? 'grayscale(1) opacity(0.25)' : isDown ? 'grayscale(1) opacity(0.55)' : lightFilter || 'none';
          drawToken(ctx, x, y, (name[0] ?? '?').toUpperCase(), name, '#5a9ff5', tokenR, hoveredTokenKey === name, zoom, img);
          ctx.filter = 'none';

          if (!inSight(pos.gx, pos.gy)) return;
          effectDraws.push(() => {
            // Ally caught in an AoE template — same red ring as enemies, so friendly fire is visible before confirming
            if (spellArea && aoeOrigin && inArea(spellArea, aoeOrigin.originGx, aoeOrigin.originGy, aoeOrigin.dirGx, aoeOrigin.dirGy, pos.gx + 0.5, pos.gy + 0.5, aoeOrigin.isSelf)) {
              drawTargetRing(ctx, x, y, tokenR);
            }
            // Ally in range of a non-attack point-target spell (Bless, Aid, ...) — same ring
            // treatment as enemies get for weapon/attack-spell targeting.
            if (!spellArea && targeting?.kind === 'spell' && targeting.spell.combat?.resolution !== 'attack' && playerPos) {
              const range = parseRangeFeet(targeting.spell.range);
              const dist = Math.max(Math.abs(pos.gx - playerPos.gx), Math.abs(pos.gy - playerPos.gy));
              if (dist <= Math.floor(range / 5)) drawTargetRing(ctx, x, y, tokenR);
            }
            drawHitFlash(ctx, x, y, tokenR, flashEffectsRef.current.find(f => f.tokenKey === name));
            tokenEffectsRef.current.filter(e => e.tokenKey === name).forEach(e => drawTokenEffect(ctx, x, y, tokenR, e));
            if (isDead) drawDeadMarker(ctx, x, y, tokenR);
            if (concentrating[name]) drawConcentrationBadge(ctx, x, y, tokenR);
          });
        });

        // Enemy tokens — dimmed/desaturated per-cell like the ground beneath them; not exempt.
        encounter?.forEach(enemy => {
          const pos = tokenPositions[enemy.id];
          if (!pos) return;
          const isDragged = drag?.id === enemy.id;
          const x = isDragged ? drag!.x : pos.gx * cellSz + cellSz / 2 + panX;
          const y = isDragged ? drag!.y : pos.gy * cellSz + cellSz / 2 + panY;

          const isDead = deadCreatureIds?.has(enemy.id);
          const lightFilter = tokenLightFilter(pos.gx, pos.gy, litCells, senses, lighting);
          ctx.filter = isDead ? `grayscale(1) opacity(0.45)` : lightFilter || 'none';
          drawToken(ctx, x, y, (enemy.name[0] ?? '?').toUpperCase(), enemy.name, isDead ? '#555' : '#c0392b', tokenR, hoveredTokenKey === enemy.id, zoom);
          ctx.filter = 'none';

          if (!inSight(pos.gx, pos.gy)) return;
          effectDraws.push(() => {
            // Red targeting ring for enemies in weapon/single-target-spell range, or inside an AoE template
            if (targeting && playerPos) {
              if (spellArea && aoeOrigin) {
                if (inArea(spellArea, aoeOrigin.originGx, aoeOrigin.originGy, aoeOrigin.dirGx, aoeOrigin.dirGy, pos.gx + 0.5, pos.gy + 0.5, aoeOrigin.isSelf)) {
                  drawTargetRing(ctx, x, y, tokenR);
                }
              } else if (!spellArea) {
                const range = targeting.kind === 'weapon' ? targeting.weapon.range : parseRangeFeet(targeting.spell.range);
                const extendedRange = targeting.kind === 'weapon' ? targeting.weapon.extendedRange : undefined;
                const dist = Math.max(Math.abs(pos.gx - playerPos.gx), Math.abs(pos.gy - playerPos.gy));
                const inNormal = dist <= Math.floor(range / 5);
                const inExtended = !inNormal && !!extendedRange && dist <= Math.floor(extendedRange / 5);
                if (inNormal) {
                  drawTargetRing(ctx, x, y, tokenR);
                } else if (inExtended) {
                  ctx.save();
                  ctx.setLineDash([4, 4]);
                  ctx.beginPath();
                  ctx.arc(x, y, tokenR + 6, 0, Math.PI * 2);
                  ctx.strokeStyle = 'rgba(255, 60, 60, 0.45)';
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  ctx.restore();
                }
              }
            }
            drawHitFlash(ctx, x, y, tokenR, flashEffectsRef.current.find(f => f.tokenKey === enemy.id));
            // Impact burst (enemies never carry an aura — only players arm self-buffs)
            tokenEffectsRef.current.filter(e => e.tokenKey === enemy.id).forEach(e => drawTokenEffect(ctx, x, y, tokenR, e));
            if (concentrating[enemy.id]) drawConcentrationBadge(ctx, x, y, tokenR);
          });
        });

        // Ally/companion tokens (recruited NPCs, Find Familiar/Unseen Servant) — green, distinct
        // from enemies (red) and players (blue). ownerId === characterId ones are draggable, see
        // Canvas.tsx's handleMouseDown companion check. Not player tokens — dimmed like enemies.
        companions.forEach(companion => {
          const pos = tokenPositions[companion.id];
          if (!pos) return;
          const isDragged = drag?.id === companion.id;
          const x = isDragged ? drag!.x : pos.gx * cellSz + cellSz / 2 + panX;
          const y = isDragged ? drag!.y : pos.gy * cellSz + cellSz / 2 + panY;

          ctx.filter = tokenLightFilter(pos.gx, pos.gy, litCells, senses, lighting) || 'none';
          drawToken(ctx, x, y, (companion.name[0] ?? '?').toUpperCase(), companion.name, '#2ecc71', tokenR, hoveredTokenKey === companion.id, zoom);
          ctx.filter = 'none';

          if (!inSight(pos.gx, pos.gy)) return;
          effectDraws.push(() => {
            tokenEffectsRef.current.filter(e => e.tokenKey === companion.id).forEach(e => drawTokenEffect(ctx, x, y, tokenR, e));
          });
        });

        // Fog-of-war: black over anything outside my own sight radius OR behind a wall from my
        // own position — computed from my own token only, never synced, so nobody else's sight
        // lines are visible to me or mine to them. Drawn before the AoE template, own token, and
        // effects/text below, so those always render in full regardless of fog.
        // The hole is the sight polygon; fill rule 'evenodd' keeps everything outside it dark
        // while leaving the polygon's interior untouched, so the boundary itself reads as the
        // ray-swept lines rather than a grid of cell edges.
        if (dungeon && visiblePolygon && visiblePolygon.length > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(panX, panY, dungeon.width * cellSz, dungeon.height * cellSz);
          ctx.moveTo(visiblePolygon[0]!.x * cellSz + panX, visiblePolygon[0]!.y * cellSz + panY);
          for (let i = 1; i < visiblePolygon.length; i++) {
            ctx.lineTo(visiblePolygon[i]!.x * cellSz + panX, visiblePolygon[i]!.y * cellSz + panY);
          }
          ctx.closePath();
          ctx.fillStyle = FOG_OF_WAR_COLOR;
          ctx.fill('evenodd');
          ctx.restore();
        }

        // AoE spell template shape — drawn on top of fog so it always renders in full
        if (spellArea && aoeOrigin) {
          drawAoeShape(ctx, spellArea, aoeOrigin.originGx, aoeOrigin.originGy, aoeOrigin.dirGx, aoeOrigin.dirGy, aoeOrigin.isSelf, cellSz, panX, panY);
        }

        // Own token — drawn on top of fog so it's never obscured, even mid-drag into an unrevealed
        // cell, and always full brightness/color: the only token exempt from lighting/darkvision.
        if (playerPos) {
          const isDragged = drag?.id === player;
          const x = isDragged ? drag!.x : playerPos.gx * cellSz + cellSz / 2 + panX;
          const y = isDragged ? drag!.y : playerPos.gy * cellSz + cellSz / 2 + panY;
          const img = tokenImgCache.current[player];
          const isDead = deadPlayerNames?.has(player) ?? false;
          const isDown = !isDead && (downPlayerNames?.has(player) ?? false);

          if (!isDown && !isDead) {
            ctx.beginPath();
            ctx.arc(x, y, tokenR + 4, 0, Math.PI * 2);
            ctx.strokeStyle = isDragged ? 'rgba(255,220,50,0.9)' : 'rgba(255,220,50,0.4)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          if (isDead) ctx.filter = 'grayscale(1) opacity(0.25)';
          else if (isDown) ctx.filter = 'grayscale(1) opacity(0.55)';
          drawToken(ctx, x, y, (player[0] ?? '?').toUpperCase(), player, '#3a7bd5', tokenR, hoveredTokenKey === player, zoom, img);
          ctx.filter = 'none';

          effectDraws.push(() => {
            // Caught in own AoE template — same red ring as enemies/allies, so friendly fire is visible before confirming
            if (spellArea && aoeOrigin && inArea(spellArea, aoeOrigin.originGx, aoeOrigin.originGy, aoeOrigin.dirGx, aoeOrigin.dirGy, playerPos.gx + 0.5, playerPos.gy + 0.5, aoeOrigin.isSelf)) {
              drawTargetRing(ctx, x, y, tokenR);
            }
            // Self as a valid target of a non-attack point-target spell (Bless, Aid, ...) — you're
            // always in range of yourself, no distance check needed.
            if (!spellArea && targeting?.kind === 'spell' && targeting.spell.combat?.resolution !== 'attack') {
              drawTargetRing(ctx, x, y, tokenR);
            }
            drawHitFlash(ctx, x, y, tokenR, flashEffectsRef.current.find(f => f.tokenKey === player));
            tokenEffectsRef.current.filter(e => e.tokenKey === player).forEach(e => drawTokenEffect(ctx, x, y, tokenR, e));
            if (isDead) drawDeadMarker(ctx, x, y, tokenR);
            if (concentrating[player]) drawConcentrationBadge(ctx, x, y, tokenR);
          });
        }

        // Effects layer — every token's ring/flash/aura/impact/dead-marker/concentration-badge,
        // now painted as one pass above every token's sprite (see effectDraws above), followed by
        // weapon swings. Both sit above tokens/ground/fog but below the text layer next.
        effectDraws.forEach(draw => draw());

        for (const swing of swingEffectsRef.current) {
          const fromPos = tokenPositions[swing.fromKey];
          const toPos = tokenPositions[swing.toKey];
          if (!fromPos || !toPos) continue;
          if (dungeon && visibleCells && !visibleCells.has(`${fromPos.gx},${fromPos.gy}`)) continue;
          drawSwing(
            ctx,
            fromPos.gx * cellSz + cellSz / 2 + panX, fromPos.gy * cellSz + cellSz / 2 + panY,
            toPos.gx * cellSz + cellSz / 2 + panX, toPos.gy * cellSz + cellSz / 2 + panY,
            swing.kind, swing.startTime,
          );
        }

        // Text layer — always topmost, painted last so no token, effect, or fog drawn above ever
        // buries it, and always full brightness/color: explicitly reset here (every earlier
        // ctx.filter set above already resets itself, but this makes "text ignores
        // lighting/darkvision" an invariant of the layer boundary, not an accident of ordering).
        ctx.filter = 'none';

        // Elevation badges (Feather Fall, falling damage) — one small label per token currently
        // off the ground.
        for (const [tokenId, ft] of Object.entries(elevations)) {
          if (!ft) continue;
          const epos = tokenPositions[tokenId];
          if (!epos) continue;
          const ex = epos.gx * cellSz + cellSz / 2 + panX;
          const ey = epos.gy * cellSz + panY - tokenR - 6;
          ctx.font = `${Math.max(10, 11 * zoom)}px 'Crimson Pro', Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = '#a78bfa';
          ctx.fillText(`↑${ft}ft`, ex, ey);
        }

        // Floating hit/miss text — the animation drifts upward, possibly into a different cell, so
        // it's gated once on the origin cell's visibility rather than the animated pixel position:
        // a float still shows in full if the token it's attached to was in sight when it fired.
        const now = Date.now();
        for (const eff of floatEffectsRef.current) {
          if (dungeon && visibleCells && !visibleCells.has(`${eff.gx},${eff.gy}`)) continue;
          const t = Math.min((now - eff.startTime) / FLOAT_DUR, 1);
          const scale   = t < 0.2 ? 0.3 + (t / 0.2) * 0.85 : 1.15 - t * 0.15; // pop up, slight shrink
          const yOff    = -t * 55;
          const alpha   = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
          const rot     = Math.sin(t * Math.PI * 2.5) * 0.13;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(eff.gx * cellSz + cellSz / 2 + panX, eff.gy * cellSz + cellSz / 2 + yOff + panY);
          ctx.rotate(rot);
          ctx.scale(scale, scale);
          ctx.font = `bold ${Math.round(21 * zoom)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.95)';
          ctx.shadowBlur = 7;
          ctx.fillStyle = eff.isHeal ? '#32cd32' : eff.isHit ? '#ff4040' : '#ffffff';
          ctx.fillText(eff.text, 0, 0);
          ctx.restore();
        }

        // Drag line: origin → cursor with distance label at midpoint
        if (drag?.id === player && playerPos) {
          const ox = playerPos.gx * cellSz + cellSz / 2 + panX;
          const oy = playerPos.gy * cellSz + cellSz / 2 + panY;
          const cx = drag.x;
          const cy = drag.y;
          const snapGx = Math.max(0, Math.floor((cx - panX) / cellSz));
          const snapGy = Math.max(0, Math.floor((cy - panY) / cellSz));
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
            ctx.font = `bold ${Math.round(11 * zoom)}px monospace`;
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

        // Hit-chance readout — follows the cursor while hovering a target during attack targeting
        if (hoverHitChance) {
          const hcRect = canvas.getBoundingClientRect();
          const hcX = hoverHitChance.x - hcRect.left + 14;
          const hcY = hoverHitChance.y - hcRect.top - 14;
          ctx.save();
          ctx.font = 'bold 15px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 4;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(`${hoverHitChance.percent}%`, hcX, hcY);
          ctx.restore();
        }

        // Discrete multi-target progress — "Targeting 1/3" while clicking through Magic
        // Missile's darts, Bless/Aid's allies, etc. Only shown once the spell needs more than
        // one, and follows the cursor the same way the hit-chance readout does.
        if (targeting?.kind === 'spell' && multiTargetCursor) {
          const { max } = spellTargetCount(targeting.spell, targeting.slotLevel ?? targeting.spell.level, targeting.casterLevel);
          if (max > 1) {
            const mtRect = canvas.getBoundingClientRect();
            const tx = multiTargetCursor.x - mtRect.left + 18;
            const ty = multiTargetCursor.y - mtRect.top - 24;
            ctx.save();
            const label = `Targeting ${multiTargetsPicked}/${max}`;
            ctx.font = 'bold 15px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(14, 12, 20, 0.75)';
            ctx.beginPath();
            ctx.roundRect(tx - 6, ty - 12, tw + 12, 24, 6);
            ctx.fill();
            ctx.fillStyle = '#f0ebde';
            ctx.fillText(label, tx, ty);
            ctx.restore();
          }
        }
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}
