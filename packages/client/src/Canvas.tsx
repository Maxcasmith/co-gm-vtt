import { useEffect, useRef, useState } from 'react';
import type { Player, EnemyStatBlock, Dungeon, Character, TurnOrderEntry } from 'shared';
import { parseRangeFeet, spellTargetCount } from 'shared';
import { dispatch, on } from './events.ts';
import type { TargetingStartPayload } from './events.ts';
import { CELL, TOKEN_R } from './canvas/constants.ts';
import { bfsReachable } from './canvas/geometry.ts';
import { inArea, resolveAoeOrigin, nearestRingCell } from './canvas/aoe.ts';
import { attackBonusFor, hitChancePercent } from './canvas/combatMath.ts';
import { useVision } from './canvas/useVision.ts';
import { useCombatEffects } from './canvas/useCombatEffects.ts';
import { useCanvasPointerControls } from './canvas/useCanvasPointerControls.ts';
import { drawScene, type DrawSceneParams } from './canvas/drawScene.ts';
import type { GroundCache } from './canvas/groundCache.ts';
import './app.css';

// enemy.portraitSrc is a server-relative path ("/api/creatures/..."); client and API are
// different origins (same reasoning as dungeonThemes.ts's identical constant).
const API = `http://${window.location.hostname}:3001`;

interface Props {
  player: Player;
  characterId: string;
  character?: Character;
  connected: Player[];
  showBattleMap?: boolean;
  encounter?: EnemyStatBlock[] | null;
  /** Party allies currently in the turn order (recruited NPCs, Find Familiar/Unseen Servant companions) — rendered as tokens; ownerId === characterId ones are draggable, same as the player's own. */
  companions?: TurnOrderEntry[];
  /** Height off the ground per token id (Feather Fall, falling damage) — badged above any token with a nonzero entry. */
  elevations?: Record<string, number>;
  tokenUrls?: Record<string, string>;
  tokenPositions?: Record<string, { gx: number; gy: number }>;
  movementRemaining?: number;
  deadCreatureIds?: Set<string>;
  downPlayerNames?: Set<string>;
  deadPlayerNames?: Set<string>;
  dungeon?: Dungeon;
  speed?: number;
  sessionActive?: boolean;
}

export default function Canvas({ player, characterId, character, connected, showBattleMap, encounter, companions = [], elevations = {}, tokenUrls, tokenPositions, movementRemaining = 0, deadCreatureIds, downPlayerNames, deadPlayerNames, dungeon, speed = 30, sessionActive = true }: Props) {
  const ref            = useRef<HTMLCanvasElement>(null);
  const tokenImgCache  = useRef<Record<string, HTMLImageElement>>({});
  // Keyed by portraitSrc URL (not enemy id/name) — multiple entities of the same creature share
  // one src, so they naturally share one cached image too.
  const enemyImgCache  = useRef<Record<string, HTMLImageElement>>({});
  const [tokenCacheVer, setTokenCacheVer] = useState(0);

  // Per-cell floor texture variant, picked once and cached so it doesn't re-randomize (flicker)
  // every animation frame. Cleared when a different dungeon loads.
  const floorVariantRef = useRef<{ dungeonId: string | null; picks: Map<string, number> }>({ dungeonId: null, picks: new Map() });
  // Baked static-ground bitmap — see groundCache.ts.
  const groundCacheRef = useRef<GroundCache | null>(null);

  const { visibleCells, litCells, senses, visiblePolygon } = useVision(dungeon, tokenPositions, player, character);

  // Refs to give window-level handlers (empty deps) access to latest prop values
  const playerRef           = useRef(player);
  const tokenPositionsRef   = useRef(tokenPositions);
  const movementRef         = useRef(movementRemaining);
  const dungeonRef          = useRef(dungeon);
  const showBattleMapRef    = useRef(showBattleMap);
  const connectedRef        = useRef(connected);
  useEffect(() => { playerRef.current = player; },               [player]);
  useEffect(() => { tokenPositionsRef.current = tokenPositions; }, [tokenPositions]);
  useEffect(() => { movementRef.current = movementRemaining; },   [movementRemaining]);
  useEffect(() => { dungeonRef.current = dungeon; },              [dungeon]);
  useEffect(() => { showBattleMapRef.current = showBattleMap; },  [showBattleMap]);
  useEffect(() => { connectedRef.current = connected; },          [connected]);

  const {
    dungeonPanRef, dungeonZoomRef, isPanningRef, panStartRef, dragRef, dragOffset, reachableRef, dragTick, sizeTick,
  } = useCanvasPointerControls(ref, player, tokenPositions, dungeon, playerRef, tokenPositionsRef, movementRef, dungeonRef, showBattleMapRef);

  // Wall-aware combat move-reach highlight — computed once when the player's own token drag
  // starts (movementRemaining doesn't change mid-drag), not re-walked by drawScene every redraw.
  const combatReachableRef = useRef<Set<string> | null>(null);

  const {
    floatEffectsRef, flashEffectsRef, tokenEffectsRef, swingEffectsRef, concentrating, animTick,
  } = useCombatEffects(tokenPositionsRef, connectedRef);

  // Targeting state — ref for window handlers, state for draw trigger
  const targetingRef = useRef<TargetingStartPayload | null>(null);
  const [targeting, setTargeting] = useState<TargetingStartPayload | null>(null);
  // Live cursor grid position while AoE targeting (point-placement + cone/line rotation)
  const aoeMouseRef = useRef<{ gx: number; gy: number } | null>(null);
  const [aoeTick, setAoeTick] = useState(0);
  // Hit-chance readout while hovering an enemy token during single-target attack targeting
  const [hoverHitChance, setHoverHitChance] = useState<{ percent: number; x: number; y: number } | null>(null);
  // Discrete multi-target casts (Magic Missile's darts, Bless/Aid's "up to three creatures") —
  // accumulates one id per click until spellTargetCount's max is reached, then fires.
  const multiTargetsRef = useRef<string[]>([]);
  const [multiTargetsPicked, setMultiTargetsPicked] = useState(0);
  // Screen-space cursor position, tracked only while multi-targeting, so the "Targeting X/Y"
  // label can follow the mouse instead of sitting fixed at the top of the screen.
  const [multiTargetCursor, setMultiTargetCursor] = useState<{ x: number; y: number } | null>(null);
  // Nameplate reveal — set to the hovered token's key ("player name" or enemy id); null = no nameplate shown
  const [hoveredTokenKey, setHoveredTokenKey] = useState<string | null>(null);

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

  useEffect(() => {
    // Same cache/keying for both sources — an exploration-mode creature marker (dungeon.entities)
    // and its combat token (encounter) share the same portraitSrc URL, so whichever loads first
    // covers both.
    const explorationUrls = (dungeon?.entities ?? [])
      .filter(e => e.type === 'creature')
      .map(e => e.statBlock?.portraitSrc);
    const urls = [...new Set([...(encounter ?? []).map(e => e.portraitSrc), ...explorationUrls].filter((u): u is string => !!u))];
    let pending = urls.length;
    if (pending === 0) return;
    urls.forEach(url => {
      if (enemyImgCache.current[url]) { pending--; return; }
      const img = new Image();
      img.onload = () => { enemyImgCache.current[url] = img; pending--; if (pending === 0) setTokenCacheVer(v => v + 1); };
      img.onerror = () => { pending--; }; // no portrait yet (fire-and-forget hasn't finished) — drawToken's img-less branch covers this
      img.src = `${API}${url}`;
    });
  }, [encounter, dungeon?.entities]);

  // Subscribe to targeting events (registered once)
  useEffect(() => {
    const u1 = on('vtt:targeting:start', payload => {
      targetingRef.current = payload;
      aoeMouseRef.current = null;
      multiTargetsRef.current = [];
      setMultiTargetsPicked(0);
      setMultiTargetCursor(null);
      setTargeting(payload);
    });
    const u2 = on('vtt:targeting:cancel', () => {
      targetingRef.current = null;
      aoeMouseRef.current = null;
      multiTargetsRef.current = [];
      setMultiTargetsPicked(0);
      setMultiTargetCursor(null);
      setTargeting(null);
      setHoverHitChance(null);
      if (ref.current) ref.current.style.cursor = 'default';
    });
    const u3 = on('vtt:combat:attack', () => {
      targetingRef.current = null;
      aoeMouseRef.current = null;
      setTargeting(null);
      setHoverHitChance(null);
    });
    const u4 = on('vtt:combat:spell:attack', () => {
      targetingRef.current = null;
      aoeMouseRef.current = null;
      setTargeting(null);
      setHoverHitChance(null);
    });
    const u5 = on('vtt:combat:spell:cast', () => {
      targetingRef.current = null;
      aoeMouseRef.current = null;
      multiTargetsRef.current = [];
      setMultiTargetsPicked(0);
      setMultiTargetCursor(null);
      setTargeting(null);
      setHoverHitChance(null);
    });
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  // One-off redraw outside the normal state-driven draw effect below — for dev toggles (perf
  // overlay, DevModal's lighting switch) that flip a module-level flag rather than React state,
  // so nothing in the draw effect's dependency array would otherwise pick the change up.
  function forceRedraw() {
    const c = ref.current;
    const params = latestDrawParamsRef.current;
    const cx = c?.getContext('2d');
    if (c && cx && params) drawScene(c, cx, params);
  }

  // DevModal (lighting + perf overlay toggles) forces a redraw after flipping a module-level flag.
  useEffect(() => on('vtt:dev:redraw', forceRedraw), []);

  // Esc cancels active targeting (registered once) — the only window-level listener that isn't a
  // camera/drag concern, so it stays here rather than in useCanvasPointerControls.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && targetingRef.current) {
        targetingRef.current = null;
        setTargeting(null);
        dispatch('vtt:targeting:cancel', {});
        if (ref.current) ref.current.style.cursor = 'default';
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Draw — coalesced to at most one actual drawScene() per animation frame. Combat bursts fire
  // several independent state changes in quick succession (attack result, damage dealt, HP
  // update, concentration...), each its own React commit; without this, each one triggers its own
  // full redraw on top of the animTick RAF loop already running, so attempted draws pile up faster
  // than the browser can flush them — that's what shows up as a *dropped* draws/s number despite
  // (or because of) more draws being attempted, not fewer. Only the latest params matter each
  // frame, so every skipped intermediate call is free to discard.
  const drawRafPendingRef = useRef(false);
  const latestDrawParamsRef = useRef<DrawSceneParams | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== canvas.offsetWidth)  canvas.width  = canvas.offsetWidth;
    if (canvas.height !== canvas.offsetHeight) canvas.height = canvas.offsetHeight;

    latestDrawParamsRef.current = {
      showBattleMap, dungeon, encounter, hoveredTokenKey, tokenPositions, player, movementRemaining,
      targeting, connected, deadPlayerNames, downPlayerNames, concentrating, deadCreatureIds,
      companions, visiblePolygon, litCells, senses, elevations, visibleCells,
      hoverHitChance, multiTargetCursor, multiTargetsPicked,
      floorVariantRef, dungeonZoomRef, dungeonPanRef, dragRef, reachableRef, combatReachableRef, groundCacheRef, aoeMouseRef,
      tokenImgCache, enemyImgCache, flashEffectsRef, tokenEffectsRef, floatEffectsRef, swingEffectsRef,
    };

    if (drawRafPendingRef.current) return;
    drawRafPendingRef.current = true;
    requestAnimationFrame(() => {
      drawRafPendingRef.current = false;
      const c = ref.current;
      const params = latestDrawParamsRef.current;
      if (!c || !params) return;
      const cx = c.getContext('2d');
      if (cx) drawScene(c, cx, params);
    });
  }, [player, connected, showBattleMap, encounter, tokenCacheVer, tokenPositions, dragTick, targeting, movementRemaining, downPlayerNames, deadPlayerNames, animTick, dungeon, sizeTick, aoeTick, visibleCells, visiblePolygon, senses, hoverHitChance, hoveredTokenKey, multiTargetsPicked, multiTargetCursor, concentrating]);

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!showBattleMap) return;

    // Right-mouse: start pan
    if (e.button === 2) {
      isPanningRef.current = true;
      panStartRef.current = { mx: e.clientX, my: e.clientY, px: dungeonPanRef.current.x, py: dungeonPanRef.current.y };
      e.currentTarget.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }

    // No moves, attacks, or targeting while the session is paused/ended — panning above still works
    if (!sessionActive) return;

    // Exploration mode: dungeon loaded, no active encounter — free click-hold movement,
    // no turn-gating, no targeting (those are combat-only concerns)
    const exploring = !!dungeon && !encounter;
    if (!exploring && (!encounter || !tokenPositions)) return;
    if (!tokenPositions) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rawMx = e.clientX - rect.left;
    const rawMy = e.clientY - rect.top;
    const panX = dungeonPanRef.current.x;
    const panY = dungeonPanRef.current.y;
    const hdCellSz = CELL * dungeonZoomRef.current;
    const mx = rawMx - panX;
    const my = rawMy - panY;

    // Trap placement (Snare) works in exploration mode too — explorationCastable spells skip
    // the turn-gated targeting flow below entirely, since there's no turn to gate against. Cast
    // mid-combat, this doesn't fire (exploring is false) and it falls through to the normal
    // turn-gated placesTrap handling further down instead.
    if (exploring && targetingRef.current?.kind === 'spell' && targetingRef.current.spell.combat?.placesTrap) {
      const targetingNow = targetingRef.current;
      const spell = targetingNow.spell;
      const playerPos = tokenPositions[player];
      if (playerPos) {
        const ring = nearestRingCell(playerPos, aoeMouseRef.current);
        dispatch('vtt:combat:spell:cast', {
          casterName: player, casterId: targetingNow.casterId, spell,
          slotLevel: targetingNow.slotLevel ?? spell.level, targetIds: [],
          chosenDamageType: targetingNow.chosenDamageType,
          originGx: ring.gx, originGy: ring.gy,
        });
      }
      e.preventDefault();
      return;
    }

    if (!exploring) {
      // Block all interaction when it's not this player's turn
      if (!isMyTurnRef.current) return;

      // Targeting mode: resolve attack/cast or cancel
      if (targetingRef.current) {
        const targetingNow = targetingRef.current;
        const playerPos = tokenPositions[player];

        if (targetingNow.kind === 'spell' && targetingNow.spell.combat?.area && playerPos) {
          const area = targetingNow.spell.combat.area;
          const origin = resolveAoeOrigin(area, playerPos, aoeMouseRef.current, parseRangeFeet(targetingNow.spell.range));
          const targetIds: string[] = [];
          // Placement spells (Snare) target the empty cell itself, not whoever's standing there —
          // the trap resolves later, against whoever steps on it.
          if (!targetingNow.spell.combat.placesTrap) {
            for (const enemy of encounter!) {
              const epos = tokenPositions[enemy.id];
              if (epos && inArea(area, origin.originGx, origin.originGy, origin.dirGx, origin.dirGy, epos.gx + 0.5, epos.gy + 0.5, origin.isSelf)) targetIds.push(enemy.id);
            }
            for (const name of connected) {
              const ppos = tokenPositions[name];
              if (ppos && inArea(area, origin.originGx, origin.originGy, origin.dirGx, origin.dirGy, ppos.gx + 0.5, ppos.gy + 0.5, origin.isSelf)) targetIds.push(name);
            }
          }
          // Trap placement needs a discrete grid cell (matches every other DungeonEntity's
          // integer x/y) picked from the 8-cell ring around the player, not resolveAoeOrigin's
          // continuous point — see nearestRingCell for why (Touch range is too short for its
          // corner-anchored clamp to reach evenly).
          let trapCell = { originGx: origin.originGx, originGy: origin.originGy };
          if (targetingNow.spell.combat.placesTrap) {
            const ring = nearestRingCell(playerPos, aoeMouseRef.current);
            trapCell = { originGx: ring.gx, originGy: ring.gy };
          }
          dispatch('vtt:combat:spell:cast', { casterName: player, casterId: targetingNow.casterId, spell: targetingNow.spell, slotLevel: targetingNow.slotLevel ?? targetingNow.spell.level, targetIds, chosenDamageType: targetingNow.chosenDamageType, chosenCommand: targetingNow.chosenCommand, chosenSkill: targetingNow.chosenSkill, ...trapCell });
          e.preventDefault();
          return;
        }

        // Discrete multi-target casts (Magic Missile darts, Bless/Aid allies, Jim's Magic
        // Missile's darts, Spellfire Flare's blasts) — accumulate one click per target until
        // spellTargetCount's max is reached, then fire once with the whole batch; below max, stay
        // in targeting mode for the next click. Shared by both the enemy and ally click loops below,
        // and by both resolution shapes: attack-roll spells route to combat:spell:attack (one roll
        // per accumulated target), everything else to combat:spell:cast — spellTargetCount defaults
        // to {min:1,max:1} for ordinary single-target spells, so this fires on the very first click
        // for them, same as before.
        function tryCastOnTarget(targetId: string): boolean {
          if (targetingNow.kind !== 'spell') return false;
          const slotLevel = targetingNow.slotLevel ?? targetingNow.spell.level;
          const { max } = spellTargetCount(targetingNow.spell, slotLevel, targetingNow.casterLevel);
          multiTargetsRef.current = [...multiTargetsRef.current, targetId];
          if (multiTargetsRef.current.length < max) {
            setMultiTargetsPicked(multiTargetsRef.current.length);
            return true;
          }
          const targetIds = multiTargetsRef.current;
          multiTargetsRef.current = [];
          setMultiTargetsPicked(0);
          if (targetingNow.spell.combat?.resolution === 'attack') {
            dispatch('vtt:combat:spell:attack', { casterName: player, casterId: targetingNow.casterId, targetIds, spell: targetingNow.spell, slotLevel, chosenDamageType: targetingNow.chosenDamageType });
          } else {
            dispatch('vtt:combat:spell:cast', { casterName: player, casterId: targetingNow.casterId, spell: targetingNow.spell, slotLevel, targetIds, chosenDamageType: targetingNow.chosenDamageType, chosenCommand: targetingNow.chosenCommand, chosenSkill: targetingNow.chosenSkill });
          }
          return true;
        }

        if (playerPos) {
          const range = targetingNow.kind === 'weapon' ? targetingNow.weapon.range : parseRangeFeet(targetingNow.spell.range);
          const extendedRange = targetingNow.kind === 'weapon' ? targetingNow.weapon.extendedRange : undefined;
          const maxRangeCells = extendedRange ? Math.floor(extendedRange / 5) : Math.floor(range / 5);
          for (const enemy of encounter!) {
            const epos = tokenPositions[enemy.id];
            if (!epos) continue;
            if (Math.max(Math.abs(epos.gx - playerPos.gx), Math.abs(epos.gy - playerPos.gy)) > maxRangeCells) continue;
            const ex = epos.gx * hdCellSz + hdCellSz / 2;
            const ey = epos.gy * hdCellSz + hdCellSz / 2;
            if (Math.hypot(mx - ex, my - ey) <= TOKEN_R) {
              if (targetingNow.kind === 'weapon') {
                dispatch('vtt:combat:attack', { attackerName: player, attackerId: characterId, targetId: enemy.id, targetName: enemy.name, weapon: targetingNow.weapon, ...(targetingNow.bonusSpell ? { bonusSpell: targetingNow.bonusSpell } : {}) });
              } else {
                tryCastOnTarget(enemy.id);
              }
              e.preventDefault();
              return;
            }
          }

          // Buff/utility spells (Bless, Aid, ...) target party members, not enemies — including
          // the caster's own token. Weapon attacks and attack-roll spells skip this: there's no
          // legitimate reason to attack-roll a party member from a stray click.
          if (targetingNow.kind === 'spell' && targetingNow.spell.combat?.resolution !== 'attack') {
            for (const name of connected) {
              const ppos = tokenPositions[name];
              if (!ppos) continue;
              if (Math.max(Math.abs(ppos.gx - playerPos.gx), Math.abs(ppos.gy - playerPos.gy)) > maxRangeCells) continue;
              const px = ppos.gx * hdCellSz + hdCellSz / 2;
              const py = ppos.gy * hdCellSz + hdCellSz / 2;
              if (Math.hypot(mx - px, my - py) <= TOKEN_R) {
                tryCastOnTarget(name);
                e.preventDefault();
                return;
              }
            }
          }
        }
        // Clicked empty — cancel targeting
        dispatch('vtt:targeting:cancel', {});
        e.preventDefault();
        return;
      }
    }

    // Drag mode: own token, or an owned companion's (Find Familiar/Unseen Servant, recruited
    // allies) — "the same control as their own token," per the design call on the telepathic
    // link. Companions skip the reachable/movement-budget accounting entirely (onUp's fallthrough
    // for any non-player token id already treats it as free wall-aware repositioning, same as a
    // GM dragging an NPC — there's no tracked movement pool for a companion to spend against).
    const pos = tokenPositions[player];
    if (pos) {
      const cx = pos.gx * hdCellSz + hdCellSz / 2;
      const cy = pos.gy * hdCellSz + hdCellSz / 2;
      if (Math.hypot(mx - cx, my - cy) <= TOKEN_R) {
        reachableRef.current = exploring && dungeon
          ? bfsReachable(dungeon.cells, pos.gx, pos.gy, Math.max(1, Math.floor(speed / 5)))
          : null;
        combatReachableRef.current = !exploring && dungeon && movementRemaining > 0
          ? bfsReachable(dungeon.cells, pos.gx, pos.gy, Math.floor(movementRemaining / 5))
          : null;
        // Store drag position in screen space (includes pan so drag line renders correctly)
        dragRef.current = { id: player, x: cx + panX, y: cy + panY };
        dragOffset.current = { x: rawMx - (cx + panX), y: rawMy - (cy + panY) };
        e.currentTarget.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
    }

    for (const companion of companions) {
      if (companion.ownerId !== characterId) continue;
      const cpos = tokenPositions[companion.id];
      if (!cpos) continue;
      const cx = cpos.gx * hdCellSz + hdCellSz / 2;
      const cy = cpos.gy * hdCellSz + hdCellSz / 2;
      if (Math.hypot(mx - cx, my - cy) <= TOKEN_R) {
        reachableRef.current = null;
        dragRef.current = { id: companion.id, x: cx + panX, y: cy + panY };
        dragOffset.current = { x: rawMx - (cx + panX), y: rawMy - (cy + panY) };
        e.currentTarget.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
    }
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!tokenPositions) return;
    const pos = tokenPositions[player];
    if (!pos) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const panX = dungeonPanRef.current.x;
    const panY = dungeonPanRef.current.y;
    const dcCellSz = CELL * dungeonZoomRef.current;
    const mx = e.clientX - rect.left - panX;
    const my = e.clientY - rect.top - panY;
    const cx = pos.gx * dcCellSz + dcCellSz / 2;
    const cy = pos.gy * dcCellSz + dcCellSz / 2;
    if (Math.hypot(mx - cx, my - cy) <= TOKEN_R) {
      dispatch('vtt:sheet:opened', { characterId });
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dragRef.current) return;

    // Targeting mode cursor — encounter is required for normal combat targeting, but trap
    // placement (Snare) also targets during exploration, where there's no encounter at all.
    const exploringMouse = !!dungeon && !encounter;
    if (targetingRef.current && showBattleMap && (encounter || exploringMouse) && tokenPositions) {
      const targetingNow = targetingRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const panX = dungeonPanRef.current.x;
      const panY = dungeonPanRef.current.y;
      const mmCellSz = CELL * dungeonZoomRef.current;
      const mx = e.clientX - rect.left - panX;
      const my = e.clientY - rect.top - panY;
      const playerPos = tokenPositions[player];

      if (targetingNow.kind === 'spell') {
        const { max } = spellTargetCount(targetingNow.spell, targetingNow.slotLevel ?? targetingNow.spell.level, targetingNow.casterLevel);
        setMultiTargetCursor(max > 1 ? { x: e.clientX, y: e.clientY } : null);
      }

      const spellArea = targetingNow.kind === 'spell' ? targetingNow.spell.combat?.area : undefined;
      if (spellArea && playerPos) {
        aoeMouseRef.current = { gx: mx / mmCellSz, gy: my / mmCellSz };
        setAoeTick(t => t + 1);
        e.currentTarget.style.cursor = 'crosshair';
        if (hoverHitChance) setHoverHitChance(null);
        return;
      }

      if (playerPos) {
        const range = targetingNow.kind === 'weapon' ? targetingNow.weapon.range : parseRangeFeet(targetingNow.spell.range);
        const extendedRange = targetingNow.kind === 'weapon' ? targetingNow.weapon.extendedRange : undefined;
        const maxRangeCells = extendedRange ? Math.floor(extendedRange / 5) : Math.floor(range / 5);
        for (const enemy of encounter ?? []) {
          const epos = tokenPositions[enemy.id];
          if (!epos || Math.max(Math.abs(epos.gx - playerPos.gx), Math.abs(epos.gy - playerPos.gy)) > maxRangeCells) continue;
          const ex = epos.gx * mmCellSz + mmCellSz / 2;
          const ey = epos.gy * mmCellSz + mmCellSz / 2;
          if (Math.hypot(mx - ex, my - ey) <= TOKEN_R) {
            e.currentTarget.style.cursor = 'crosshair';
            if (character) {
              const attackBonus = attackBonusFor(character, targetingNow);
              if (attackBonus != null) {
                const withDisadvantage = !!extendedRange &&
                  Math.max(Math.abs(epos.gx - playerPos.gx), Math.abs(epos.gy - playerPos.gy)) > Math.floor(range / 5);
                const percent = hitChancePercent(attackBonus, enemy.ac, withDisadvantage);
                setHoverHitChance({ percent, x: e.clientX, y: e.clientY });
              } else if (hoverHitChance) setHoverHitChance(null);
            }
            return;
          }
        }
      }
      e.currentTarget.style.cursor = 'default';
      if (hoverHitChance) setHoverHitChance(null);
      return;
    }

    // Normal: nameplate hover + grab cursor over own token
    if (hoverHitChance) setHoverHitChance(null);
    if (!showBattleMap || !tokenPositions) {
      if (hoveredTokenKey) setHoveredTokenKey(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const panX = dungeonPanRef.current.x;
    const panY = dungeonPanRef.current.y;
    const grabCellSz = CELL * dungeonZoomRef.current;
    const mx = e.clientX - rect.left - panX;
    const my = e.clientY - rect.top - panY;

    // Nameplate hover — only tokens actually rendered on screen are hoverable, so a fogged
    // ally/enemy can't have its name revealed by mousing over the dark tile it sits under
    const isCellVisible = (gx: number, gy: number) => !dungeon || (visibleCells?.has(`${gx},${gy}`) ?? false);
    let hovered: string | null = null;
    for (const name of connected) {
      const p = tokenPositions[name];
      if (!p) continue;
      if (name !== player && !isCellVisible(p.gx, p.gy)) continue;
      const tx = p.gx * grabCellSz + grabCellSz / 2;
      const ty = p.gy * grabCellSz + grabCellSz / 2;
      if (Math.hypot(mx - tx, my - ty) <= TOKEN_R) { hovered = name; break; }
    }
    if (!hovered) {
      for (const enemy of encounter ?? []) {
        const p = tokenPositions[enemy.id];
        if (!p || !isCellVisible(p.gx, p.gy)) continue;
        const tx = p.gx * grabCellSz + grabCellSz / 2;
        const ty = p.gy * grabCellSz + grabCellSz / 2;
        if (Math.hypot(mx - tx, my - ty) <= TOKEN_R) { hovered = enemy.id; break; }
      }
    }
    if (!hovered && dungeon) {
      for (const entity of dungeon.entities) {
        if (entity.type !== 'trap' || !entity.placedBy) continue;
        const tx = entity.x * grabCellSz + grabCellSz / 2;
        const ty = entity.y * grabCellSz + grabCellSz / 2;
        if (Math.hypot(mx - tx, my - ty) <= TOKEN_R) { hovered = entity.id; break; }
      }
    }
    if (hovered !== hoveredTokenKey) setHoveredTokenKey(hovered);

    const pos = tokenPositions[player];
    if (!pos) return;
    const cx = pos.gx * grabCellSz + grabCellSz / 2;
    const cy = pos.gy * grabCellSz + grabCellSz / 2;
    e.currentTarget.style.cursor = Math.hypot(mx - cx, my - cy) <= TOKEN_R ? 'grab' : 'default';
  }

  return (
    <canvas
      ref={ref}
      className={showBattleMap ? 'canvas' : 'canvas canvas--inactive'}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onDoubleClick={handleDoubleClick}
      onAuxClick={e => e.preventDefault()}
      onContextMenu={e => { if (showBattleMap) e.preventDefault(); }}
    />
  );
}
