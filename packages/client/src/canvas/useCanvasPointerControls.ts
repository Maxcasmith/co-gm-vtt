import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Dungeon, Player } from 'shared';
import { findPath } from 'shared';
import { dispatch } from '../events.ts';
import { CELL, MIN_ZOOM, MAX_ZOOM } from './constants.ts';

/**
 * Camera (pan/zoom) and token-drag state, plus the window-level listeners that drive both —
 * they share the same mousemove/mouseup pair (one or the other is active at a time, never both;
 * see isPanningRef), so splitting them into separate hooks would mean two listener pairs doing
 * the same "which mode am I in" branch. Escape-cancel-targeting stays in Canvas.tsx since it's a
 * targeting concern, not a camera/drag one, even though it shares the window keydown listener's
 * registration site there.
 *
 * `player`/`tokenPositions`/`movementRemaining`/`dungeon`/`showBattleMap` are read once per
 * render for the camera-centering effect's deps; the *Ref params are the already-latest-value
 * mirrors Canvas.tsx keeps for the window listeners (registered once, empty deps) to read fresh
 * values through without re-subscribing.
 */
export function useCanvasPointerControls(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  player: Player,
  tokenPositions: Record<string, { gx: number; gy: number }> | undefined,
  dungeon: Dungeon | undefined,
  playerRef: RefObject<Player>,
  tokenPositionsRef: RefObject<Record<string, { gx: number; gy: number }> | undefined>,
  movementRef: RefObject<number>,
  dungeonRef: RefObject<Dungeon | undefined>,
  showBattleMapRef: RefObject<boolean | undefined>,
) {
  // Pan + zoom state for dungeon navigation
  const dungeonPanRef  = useRef({ x: 0, y: 0 });
  const dungeonZoomRef = useRef(1.0);
  const isPanningRef   = useRef(false);
  const panStartRef    = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // Drag state — refs keep closures fresh inside window listeners
  const dragRef     = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragOffset  = useRef({ x: 0, y: 0 });
  // Wall-aware reachable set for the current exploration-mode drag ("gx,gy" keys); null outside exploration mode
  const reachableRef = useRef<Set<string> | null>(null);
  const [dragTick, setDragTick] = useState(0);
  const [sizeTick, setSizeTick] = useState(0);

  // Camera: on entering a dungeon, snap to max zoom centred on my own token.
  // Re-fires only when the dungeon changes, so it never fights manual pan/zoom.
  const centeredDungeonIdRef = useRef<string | null>(null);
  useEffect(() => {
    const myPos = tokenPositions?.[player];
    const canvas = canvasRef.current;
    if (!dungeon || !myPos || !canvas) return;
    if (centeredDungeonIdRef.current === dungeon.id) return;
    centeredDungeonIdRef.current = dungeon.id;
    const cellSz = CELL * MAX_ZOOM;
    dungeonZoomRef.current = MAX_ZOOM;
    dungeonPanRef.current = {
      x: canvas.offsetWidth / 2 - (myPos.gx * cellSz + cellSz / 2),
      y: canvas.offsetHeight / 2 - (myPos.gy * cellSz + cellSz / 2),
    };
    setDragTick(t => t + 1);
  }, [dungeon, tokenPositions, player]);

  // Resize observer: redraw when canvas element size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setSizeTick(t => t + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Window-level drag move + drop + pan + zoom (registered once)
  useEffect(() => {
    // Native mousemove can fire far faster than the display refresh rate; coalesce every event
    // between frames into a single redraw tick per rAF instead of one full drawScene per event.
    let redrawRafId: number | null = null;
    function scheduleRedraw() {
      if (redrawRafId !== null) return;
      redrawRafId = requestAnimationFrame(() => {
        redrawRafId = null;
        setDragTick(t => t + 1);
      });
    }

    function onMove(e: MouseEvent) {
      if (isPanningRef.current) {
        const { mx, my, px, py } = panStartRef.current;
        dungeonPanRef.current = { x: px + (e.clientX - mx), y: py + (e.clientY - my) };
        scheduleRedraw();
        dispatch('vtt:viewport:changed', { ...dungeonPanRef.current, zoom: dungeonZoomRef.current });
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = { ...drag, x: e.clientX - rect.left - dragOffset.current.x, y: e.clientY - rect.top - dragOffset.current.y };
      scheduleRedraw();
    }

    function onUp() {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = 'default';
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const pan = dungeonPanRef.current;
      const dropCellSz = CELL * dungeonZoomRef.current;
      const gx = Math.max(0, Math.floor((drag.x - pan.x) / dropCellSz));
      const gy = Math.max(0, Math.floor((drag.y - pan.y) / dropCellSz));

      // Movement accounting for the player's own token
      if (drag.id === playerRef.current) {
        const oldPos = tokenPositionsRef.current?.[drag.id];

        // Exploration mode: wall-aware reachable set computed at drag-start is the only source of truth —
        // commit if the drop cell is in it, otherwise snap back. No turn/movementRemaining gating here.
        if (reachableRef.current) {
          const dest = reachableRef.current.has(`${gx},${gy}`) ? { gx, gy } : oldPos;
          reachableRef.current = null;
          if (dest) dispatch('vtt:token:move', { tokenId: drag.id, gx: dest.gx, gy: dest.gy });
          dragRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = 'default';
          setDragTick(t => t + 1);
          return;
        }

        if (oldPos && movementRef.current === 0) {
          // No movement left — snap back to last stationary position
          dispatch('vtt:token:move', { tokenId: drag.id, gx: oldPos.gx, gy: oldPos.gy });
          dragRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = 'default';
          setDragTick(t => t + 1);
          return;
        }
        if (oldPos) {
          const cells = dungeonRef.current?.cells;
          const path = cells ? findPath(cells, oldPos.gx, oldPos.gy, gx, gy) : null;

          // Walled off (or off-grid) — no legal route at all, snap back rather than teleport through.
          if (cells && !path) {
            dispatch('vtt:token:move', { tokenId: drag.id, gx: oldPos.gx, gy: oldPos.gy });
            dragRef.current = null;
            if (canvasRef.current) canvasRef.current.style.cursor = 'default';
            setDragTick(t => t + 1);
            return;
          }

          // Walk cost is the real route length, not straight-line distance — and doubles as the
          // budget clamp, so dragging past remaining movement just walks as far as it reaches.
          // Difficult Terrain (Entangle/Grease) charges extra feet for any step landing on a
          // hazard cell — costed per-step against the path findPath already chose, not factored
          // into route selection itself (a cheaper detour around a hazard isn't considered).
          const hazards = dungeonRef.current?.hazardCells;
          const costOf = (cx: number, cy: number) => 5 * (hazards?.find(h => h.gx === cx && h.gy === cy)?.multiplier ?? 1);
          let steps = 0;
          let spentFt = 0;
          if (path) {
            for (const cell of path) {
              const stepCost = costOf(cell.gx, cell.gy);
              if (spentFt + stepCost > movementRef.current) break;
              spentFt += stepCost;
              steps++;
            }
          } else {
            steps = Math.min(Math.max(Math.abs(gx - oldPos.gx), Math.abs(gy - oldPos.gy)), Math.floor(movementRef.current / 5));
            spentFt = steps * 5;
          }
          const dest = path && steps > 0 ? path[steps - 1]! : oldPos;
          if (spentFt > 0) dispatch('vtt:movement:used', { ft: spentFt });
          dispatch('vtt:token:move', { tokenId: drag.id, gx: dest.gx, gy: dest.gy });
          dragRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = 'default';
          setDragTick(t => t + 1);
          return;
        }
      }

      // Non-player-tracked token (GM-dragged monster/NPC) — still refuse dropping it somewhere
      // no walkable route reaches from its current cell.
      const cellsForDrop = dungeonRef.current?.cells;
      if (cellsForDrop) {
        const origin = tokenPositionsRef.current?.[drag.id];
        const blocked = origin ? !findPath(cellsForDrop, origin.gx, origin.gy, gx, gy) : cellsForDrop[gy]?.[gx] !== 1;
        if (blocked) {
          dragRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = 'default';
          setDragTick(t => t + 1);
          return;
        }
      }

      dispatch('vtt:token:move', { tokenId: drag.id, gx, gy });
      dragRef.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = 'default';
      setDragTick(t => t + 1);
    }

    function onWheel(e: WheelEvent) {
      if (!showBattleMapRef.current) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const oldZoom = dungeonZoomRef.current;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { x: px, y: py } = dungeonPanRef.current;
      dungeonPanRef.current = {
        x: mx - (mx - px) * (newZoom / oldZoom),
        y: my - (my - py) * (newZoom / oldZoom),
      };
      dungeonZoomRef.current = newZoom;
      scheduleRedraw();
      dispatch('vtt:viewport:changed', { x: dungeonPanRef.current.x, y: dungeonPanRef.current.y, zoom: newZoom });
    }

    const canvasEl = canvasRef.current;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    if (canvasEl) canvasEl.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (canvasEl) canvasEl.removeEventListener('wheel', onWheel);
      if (redrawRafId !== null) cancelAnimationFrame(redrawRafId);
    };
  }, []);

  return { dungeonPanRef, dungeonZoomRef, isPanningRef, panStartRef, dragRef, dragOffset, reachableRef, dragTick, sizeTick };
}
