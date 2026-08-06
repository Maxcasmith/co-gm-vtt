import { useEffect, useMemo, useRef, useState } from 'react';
import type { Player, EnemyStatBlock, Spell, Dungeon, Character } from 'shared';
import { parseRangeFeet, hasLineOfSight, statMod, CLASS_WEAPON_PROFS, CLASS_SPELLCASTING_ABILITY } from 'shared';
import { dispatch, on } from './events.ts';
import type { TargetingStartPayload } from './events.ts';
import { texturesFor, getImage, FLOOR_FALLBACK_COLOR } from './dungeonThemes.ts';
import './app.css';

const CELL = 64;
const TOKEN_R = 24;
const DUNGEON_ENTITY_R = 10;
const FLOAT_DUR  = 950;   // ms for floating text
const FLASH_DUR  = 220;   // ms for token flash
const SIGHT_RADIUS = 20;  // square (Chebyshev) fog-of-war radius, in cells — mirrors PLAYER_SIGHT_RADIUS server-side
const DUNGEON_BG = '#0e0c14';
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;

// Wall-aware reachable cells within `maxSteps` (8-directional, uniform cost) — exploration movement
// cap + highlight. Returns "gx,gy" keys, including the start cell.
function bfsReachable(cells: number[][], startX: number, startY: number, maxSteps: number): Set<string> {
  const key = (x: number, y: number) => `${x},${y}`;
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  const visited = new Set<string>([key(startX, startY)]);
  const queue: { x: number; y: number; steps: number }[] = [{ x: startX, y: startY, steps: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const { x, y, steps } = queue[i]!;
    if (steps >= maxSteps) continue;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || ny >= height || nx >= width) continue;
        if (cells[ny]?.[nx] !== 1) continue;
        const k = key(nx, ny);
        if (visited.has(k)) continue;
        visited.add(k);
        queue.push({ x: nx, y: ny, steps: steps + 1 });
      }
    }
  }
  return visited;
}

// ── AoE geometry (grid cells, 1 cell = 5ft) ─────────────────────────────────────
// Simplified templates: cone/line use a straight-triangle/rectangle approximation
// (5e's "cone is as wide as it is long" rule of thumb) rather than exact arcs.

type SpellArea = NonNullable<NonNullable<Spell['combat']>['area']>;

function ft2cells(feet: number) { return feet / 5; }

// Slack added to every AoE boundary check, in grid cells. A token's cell-center exactly on
// a shape's edge is a coin-flip against float/pixel noise (e.g. aiming Acid Splash at the
// corner where 4 tokens meet); this tolerance makes near-edge hits land consistently instead
// of depending on sub-pixel cursor position.
const AOE_EDGE_TOLERANCE = 0.3;

function inArea(
  area: SpellArea,
  originGx: number, originGy: number,
  dirGx: number, dirGy: number,
  tgx: number, tgy: number,
  isSelf: boolean,
): boolean {
  if (isSelf && Math.floor(tgx) === Math.floor(originGx) && Math.floor(tgy) === Math.floor(originGy)) return false;
  const dx = tgx - originGx;
  const dy = tgy - originGy;
  const sizeCells = ft2cells(area.size) + AOE_EDGE_TOLERANCE;
  switch (area.shape) {
    case 'sphere':
    case 'cylinder':
      return Math.hypot(dx, dy) <= sizeCells;
    case 'emanation':
      // Grid-square emanation (e.g. Thunderclap "within 5 ft of you") fills every
      // surrounding square at that Chebyshev distance, not a circular sweep.
      return Math.max(Math.abs(dx), Math.abs(dy)) <= sizeCells;
    case 'cube': {
      // A self-origin cube (e.g. Thunderwave) emanates from the caster's edge toward the
      // aimed direction and rotates with the mouse, same as a cone/line — it does not
      // surround the caster. A point-placed cube (e.g. Fireball) stays a centered square.
      if (isSelf) {
        const len = Math.hypot(dirGx - originGx, dirGy - originGy) || 1;
        const ux = (dirGx - originGx) / len;
        const uy = (dirGy - originGy) / len;
        const forward = dx * ux + dy * uy;
        const perp = Math.abs(dx * uy - dy * ux);
        return forward >= -AOE_EDGE_TOLERANCE && forward <= sizeCells && perp <= sizeCells / 2;
      }
      const half = sizeCells / 2;
      return Math.abs(dx) <= half && Math.abs(dy) <= half;
    }
    case 'line': {
      const len = Math.hypot(dirGx - originGx, dirGy - originGy) || 1;
      const ux = (dirGx - originGx) / len;
      const uy = (dirGy - originGy) / len;
      const forward = dx * ux + dy * uy;
      const perp = Math.abs(dx * uy - dy * ux);
      const widthCells = ft2cells(area.width ?? 5) + AOE_EDGE_TOLERANCE;
      return forward >= -AOE_EDGE_TOLERANCE && forward <= sizeCells && perp <= widthCells / 2;
    }
    case 'cone': {
      const len = Math.hypot(dirGx - originGx, dirGy - originGy) || 1;
      const ux = (dirGx - originGx) / len;
      const uy = (dirGy - originGy) / len;
      const forward = dx * ux + dy * uy;
      const perp = Math.abs(dx * uy - dy * ux);
      return forward >= -AOE_EDGE_TOLERANCE && forward <= sizeCells && perp <= forward / 2 + AOE_EDGE_TOLERANCE;
    }
  }
}

/**
 * Where an AoE template currently sits: self-origin follows the caster and points at the
 * mouse (cone/line/cube rotation); point-origin follows the mouse, clamped to spell range.
 * A spell counts as self-origin whenever its range is Self, regardless of the area's own
 * `origin` tag — compendium data mistags several directional spells (e.g. Burning Hands)
 * as 'point', which would otherwise collapse the direction vector to zero and fill the
 * entire padded box.
 */
function resolveAoeOrigin(
  area: SpellArea,
  playerPos: { gx: number; gy: number },
  mouse: { gx: number; gy: number } | null,
  rangeFeet: number,
): { originGx: number; originGy: number; dirGx: number; dirGy: number; isSelf: boolean } {
  const isSelf = area.origin === 'self' || rangeFeet <= 0;
  if (isSelf) {
    const originGx = playerPos.gx + 0.5;
    const originGy = playerPos.gy + 0.5;
    const m = mouse ?? { gx: playerPos.gx + 1, gy: playerPos.gy };
    return { originGx, originGy, dirGx: m.gx, dirGy: m.gy, isSelf: true };
  }
  const rangeCells = ft2cells(rangeFeet);
  const m = mouse ?? { gx: playerPos.gx, gy: playerPos.gy };
  const dx = m.gx - playerPos.gx;
  const dy = m.gy - playerPos.gy;
  const dist = Math.hypot(dx, dy);
  const clamped = Number.isFinite(rangeCells) && dist > rangeCells && dist > 0
    ? { gx: playerPos.gx + (dx / dist) * rangeCells, gy: playerPos.gy + (dy / dist) * rangeCells }
    : m;
  return { originGx: clamped.gx, originGy: clamped.gy, dirGx: clamped.gx, dirGy: clamped.gy, isSelf: false };
}

/** Draws the AoE's true continuous geometry (circle/wedge/rectangle) over the cell highlight,
 *  so the grid approximation's edges are legible against the exact shape it's covering. */
function drawAoeShape(
  ctx: CanvasRenderingContext2D,
  area: SpellArea,
  originGx: number, originGy: number,
  dirGx: number, dirGy: number,
  isSelf: boolean,
  cellSz: number, panX: number, panY: number,
) {
  const ox = originGx * cellSz + panX;
  const oy = originGy * cellSz + panY;
  const sizePx = ft2cells(area.size) * cellSz;
  const len = Math.hypot(dirGx - originGx, dirGy - originGy) || 1;
  const ux = (dirGx - originGx) / len;
  const uy = (dirGy - originGy) / len;
  const px = -uy;
  const py = ux;

  ctx.save();
  ctx.fillStyle = 'rgba(180, 90, 255, 0.28)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  switch (area.shape) {
    case 'sphere':
    case 'cylinder':
      ctx.arc(ox, oy, sizePx, 0, Math.PI * 2);
      break;
    case 'emanation':
      ctx.rect(ox - sizePx, oy - sizePx, sizePx * 2, sizePx * 2);
      break;
    case 'cube': {
      if (isSelf) {
        const half = sizePx / 2;
        const p1 = { x: ox + px * half, y: oy + py * half };
        const p2 = { x: ox - px * half, y: oy - py * half };
        const p3 = { x: p2.x + ux * sizePx, y: p2.y + uy * sizePx };
        const p4 = { x: p1.x + ux * sizePx, y: p1.y + uy * sizePx };
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
      } else {
        const half = sizePx / 2;
        ctx.rect(ox - half, oy - half, sizePx, sizePx);
      }
      break;
    }
    case 'line': {
      const halfW = (ft2cells(area.width ?? 5) * cellSz) / 2;
      const p1 = { x: ox + px * halfW, y: oy + py * halfW };
      const p2 = { x: ox - px * halfW, y: oy - py * halfW };
      const p3 = { x: p2.x + ux * sizePx, y: p2.y + uy * sizePx };
      const p4 = { x: p1.x + ux * sizePx, y: p1.y + uy * sizePx };
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
      break;
    }
    case 'cone': {
      const halfW = sizePx / 2;
      const base1 = { x: ox + ux * sizePx + px * halfW, y: oy + uy * sizePx + py * halfW };
      const base2 = { x: ox + ux * sizePx - px * halfW, y: oy + uy * sizePx - py * halfW };
      ctx.moveTo(ox, oy); ctx.lineTo(base1.x, base1.y); ctx.lineTo(base2.x, base2.y); ctx.closePath();
      break;
    }
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

interface FloatEffect { id: number; gx: number; gy: number; text: string; isHit: boolean; isHeal?: boolean; startTime: number }
interface FlashEffect { tokenKey: string; startTime: number }

// Mirrors the server's attack-roll math (packages/api/src/index.ts combat:attack / combat:spell:attack)
// so the hover readout matches the actual roll odds, including extended-range disadvantage.
function attackBonusFor(character: Character, targeting: TargetingStartPayload): number | null {
  const charProf = character.proficiencyBonus ?? 2;
  if (targeting.kind === 'weapon') {
    const weapon = targeting.weapon;
    const strMod = statMod(character.stats.str);
    const dexMod = statMod(character.stats.dex);
    const isMelee = weapon.range <= 10; // covers reach weapons (e.g. Whip, range 10) — next tier up is bows at 80+
    const useDex = !isMelee || (weapon.isFinesse && dexMod > strMod);
    const statBonus = useDex ? dexMod : strMod;
    const classWeaponProfs = CLASS_WEAPON_PROFS[character.class] ?? [];
    const isProficient = weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
    const weaponBonus = (weapon.attackBonus ?? 0) + (isProficient ? charProf : 0);
    return statBonus + weaponBonus;
  }
  if (targeting.spell.combat?.resolution !== 'attack') return null;
  const spellAbility = CLASS_SPELLCASTING_ABILITY[character.class] ?? 'int';
  return statMod(character.stats[spellAbility]) + charProf;
}

function hitChancePercent(attackBonus: number, ac: number, withDisadvantage: boolean): number {
  const single = Math.max(0, Math.min(1, (21 - (ac - attackBonus)) / 20));
  return Math.round((withDisadvantage ? single * single : single) * 100);
}

interface Props {
  player: Player;
  characterId: string;
  character?: Character;
  connected: Player[];
  showBattleMap?: boolean;
  encounter?: EnemyStatBlock[] | null;
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

function drawToken(
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

export default function Canvas({ player, characterId, character, connected, showBattleMap, encounter, tokenUrls, tokenPositions, movementRemaining = 0, deadCreatureIds, downPlayerNames, deadPlayerNames, dungeon, speed = 30, sessionActive = true }: Props) {
  const ref            = useRef<HTMLCanvasElement>(null);
  const tokenImgCache  = useRef<Record<string, HTMLImageElement>>({});
  const [tokenCacheVer, setTokenCacheVer] = useState(0);

  // Per-cell floor texture variant, picked once and cached so it doesn't re-randomize (flicker)
  // every animation frame. Cleared when a different dungeon loads.
  const floorVariantRef = useRef<{ dungeonId: string | null; picks: Map<string, number> }>({ dungeonId: null, picks: new Map() });

  // Fog-of-war: cells visible to my own token — square radius + wall-blocked line-of-sight.
  // Recomputed only when the dungeon or my own position changes, not per animation frame.
  const myPos = tokenPositions?.[player];
  const visibleCells = useMemo(() => {
    if (!dungeon || !myPos) return null;
    const set = new Set<string>();
    for (let dy = -SIGHT_RADIUS; dy <= SIGHT_RADIUS; dy++) {
      for (let dx = -SIGHT_RADIUS; dx <= SIGHT_RADIUS; dx++) {
        const tx = myPos.gx + dx, ty = myPos.gy + dy;
        if (tx < 0 || ty < 0 || tx >= dungeon.width || ty >= dungeon.height) continue;
        if (hasLineOfSight(dungeon.cells, myPos.gx, myPos.gy, tx, ty)) set.add(`${tx},${ty}`);
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeon, myPos?.gx, myPos?.gy]);

  // Refs to give window-level handlers (empty deps) access to latest prop values
  const playerRef           = useRef(player);
  const tokenPositionsRef   = useRef(tokenPositions);
  const movementRef         = useRef(movementRemaining);
  const dungeonRef          = useRef(dungeon);
  const showBattleMapRef    = useRef(showBattleMap);
  useEffect(() => { playerRef.current = player; },               [player]);
  useEffect(() => { tokenPositionsRef.current = tokenPositions; }, [tokenPositions]);
  useEffect(() => { movementRef.current = movementRemaining; },   [movementRemaining]);
  useEffect(() => { dungeonRef.current = dungeon; },              [dungeon]);
  useEffect(() => { showBattleMapRef.current = showBattleMap; },  [showBattleMap]);

  // Camera: on entering a dungeon, snap to max zoom centred on my own token.
  // Re-fires only when the dungeon changes, so it never fights manual pan/zoom.
  const centeredDungeonIdRef = useRef<string | null>(null);
  useEffect(() => {
    const myPos = tokenPositions?.[player];
    const canvas = ref.current;
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

  // Pan + zoom state for dungeon navigation
  const dungeonPanRef  = useRef({ x: 0, y: 0 });
  const dungeonZoomRef = useRef(1.0);
  const isPanningRef   = useRef(false);
  const panStartRef    = useRef({ mx: 0, my: 0, px: 0, py: 0 });

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

  function pushHitFloat(targetId: string, targetName: string, hit: boolean, damage: number | undefined) {
    const posById   = tokenPositionsRef.current?.[targetId];
    const posByName = tokenPositionsRef.current?.[targetName];
    const pos       = posById ?? posByName;
    const tokenKey  = posById ? targetId : targetName;
    if (!pos) return;
    const now = Date.now();
    if (hit && damage != null) {
      flashEffectsRef.current.push({ tokenKey, startTime: now });
      floatEffectsRef.current.push({ id: now, gx: pos.gx, gy: pos.gy, text: `-${damage}`, isHit: true, startTime: now });
    } else if (!hit) {
      floatEffectsRef.current.push({ id: now, gx: pos.gx, gy: pos.gy, text: 'Miss', isHit: false, startTime: now });
    }
    kickAnimLoop();
  }

  function pushHealFloat(characterId: string, characterName: string, healAmount: number) {
    const posById   = tokenPositionsRef.current?.[characterId];
    const posByName = tokenPositionsRef.current?.[characterName];
    const pos       = posById ?? posByName;
    if (!pos) return;
    const now = Date.now();
    floatEffectsRef.current.push({ id: now, gx: pos.gx, gy: pos.gy, text: `+${healAmount}`, isHit: false, isHeal: true, startTime: now });
    kickAnimLoop();
  }

  useEffect(() => on('vtt:consumable:heal:result', result => {
    pushHealFloat(result.characterId, result.characterName, result.healAmount);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:attack:result', result => {
    pushHitFloat(result.targetId, result.targetName, result.hit, result.damage);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:spell:attack:result', result => {
    pushHitFloat(result.targetId, result.targetName, result.hit, result.damage);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:spell:save:result', result => {
    // A successful save doesn't mean "no effect" — halfOnSave spells (Burning Hands, etc.)
    // still deal damage on a save, so the float text is keyed on whether damage was dealt,
    // not on the save/fail outcome itself.
    for (const outcome of result.outcomes) {
      pushHitFloat(outcome.targetId, outcome.targetName, outcome.damage != null, outcome.damage);
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag state — refs keep closures fresh inside window listeners
  const dragRef     = useRef<{ id: string; x: number; y: number } | null>(null);
  const dragOffset  = useRef({ x: 0, y: 0 });
  // Wall-aware reachable set for the current exploration-mode drag ("gx,gy" keys); null outside exploration mode
  const reachableRef = useRef<Set<string> | null>(null);
  const [dragTick, setDragTick] = useState(0);
  const [sizeTick, setSizeTick] = useState(0);

  // Targeting state — ref for window handlers, state for draw trigger
  const targetingRef = useRef<TargetingStartPayload | null>(null);
  const [targeting, setTargeting] = useState<TargetingStartPayload | null>(null);
  // Live cursor grid position while AoE targeting (point-placement + cone/line rotation)
  const aoeMouseRef = useRef<{ gx: number; gy: number } | null>(null);
  const [aoeTick, setAoeTick] = useState(0);
  // Hit-chance readout while hovering an enemy token during single-target attack targeting
  const [hoverHitChance, setHoverHitChance] = useState<{ percent: number; x: number; y: number } | null>(null);
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

  // Resize observer: redraw when canvas element size changes
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setSizeTick(t => t + 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Subscribe to targeting events (registered once)
  useEffect(() => {
    const u1 = on('vtt:targeting:start', payload => {
      targetingRef.current = payload;
      aoeMouseRef.current = null;
      setTargeting(payload);
    });
    const u2 = on('vtt:targeting:cancel', () => {
      targetingRef.current = null;
      aoeMouseRef.current = null;
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
      setTargeting(null);
      setHoverHitChance(null);
    });
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  // Window-level drag move + drop + Esc-cancel (registered once)
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (isPanningRef.current) {
        const { mx, my, px, py } = panStartRef.current;
        dungeonPanRef.current = { x: px + (e.clientX - mx), y: py + (e.clientY - my) };
        setDragTick(t => t + 1);
        dispatch('vtt:viewport:changed', { ...dungeonPanRef.current, zoom: dungeonZoomRef.current });
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = { ...drag, x: e.clientX - rect.left - dragOffset.current.x, y: e.clientY - rect.top - dragOffset.current.y };
      setDragTick(t => t + 1);
    }

    function onUp() {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        if (ref.current) ref.current.style.cursor = 'default';
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
          if (ref.current) ref.current.style.cursor = 'default';
          setDragTick(t => t + 1);
          return;
        }

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

    function onWheel(e: WheelEvent) {
      if (!showBattleMapRef.current) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const oldZoom = dungeonZoomRef.current;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { x: px, y: py } = dungeonPanRef.current;
      dungeonPanRef.current = {
        x: mx - (mx - px) * (newZoom / oldZoom),
        y: my - (my - py) * (newZoom / oldZoom),
      };
      dungeonZoomRef.current = newZoom;
      setDragTick(t => t + 1);
      dispatch('vtt:viewport:changed', { x: dungeonPanRef.current.x, y: dungeonPanRef.current.y, zoom: newZoom });
    }

    const canvasEl = ref.current;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    if (canvasEl) canvasEl.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      if (canvasEl) canvasEl.removeEventListener('wheel', onWheel);
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

      const panX = dungeonPanRef.current.x;
      const panY = dungeonPanRef.current.y;
      const zoom = dungeonZoomRef.current;
      const cellSz = CELL * zoom;
      const tokenR = TOKEN_R * zoom;

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

        // Entity markers
        const entityR = DUNGEON_ENTITY_R * dungeonZoomRef.current;
        for (const entity of dungeon.entities) {
          // Combat token (drawn below) replaces the marker for any creature in the active encounter
          if (entity.type === 'creature' && encounter) continue;
          const ex = entity.x * cellSz + cellSz / 2 + panX;
          const ey = entity.y * cellSz + cellSz / 2 + panY;
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

      if ((encounter || dungeon) && tokenPositions) {
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
              ctx.fillRect(tx * cellSz + panX, ty * cellSz + panY, cellSz, cellSz);
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
              ctx.strokeRect(tx * cellSz + panX + 0.5, ty * cellSz + panY + 0.5, cellSz - 1, cellSz - 1);
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
        }

        // Ally tokens — fogged the same as enemies; own token is drawn separately after fog
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

          // Ally caught in an AoE template — same red ring as enemies, so friendly fire is visible before confirming
          if (spellArea && aoeOrigin && inArea(spellArea, aoeOrigin.originGx, aoeOrigin.originGy, aoeOrigin.dirGx, aoeOrigin.dirGy, pos.gx + 0.5, pos.gy + 0.5, aoeOrigin.isSelf)) {
            ctx.beginPath();
            ctx.arc(x, y, tokenR + 6, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }

          if (isDead) ctx.filter = 'grayscale(1) opacity(0.25)';
          else if (isDown) ctx.filter = 'grayscale(1) opacity(0.55)';
          drawToken(ctx, x, y, (name[0] ?? '?').toUpperCase(), name, '#5a9ff5', tokenR, hoveredTokenKey === name, img);
          ctx.filter = 'none';

          // Hit flash overlay
          const playerFlash = flashEffectsRef.current.find(f => f.tokenKey === name);
          if (playerFlash) {
            const ft = (Date.now() - playerFlash.startTime) / FLASH_DUR;
            ctx.save();
            ctx.globalAlpha = Math.sin(ft * Math.PI) * 0.6;
            ctx.fillStyle = '#ff2222';
            ctx.beginPath(); ctx.arc(x, y, tokenR, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }

          // Dead marker: a red × over the token
          if (isDead) {
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
        });

        // Enemy tokens
        encounter?.forEach(enemy => {
          const pos = tokenPositions[enemy.id];
          if (!pos) return;
          const isDragged = drag?.id === enemy.id;
          const x = isDragged ? drag!.x : pos.gx * cellSz + cellSz / 2 + panX;
          const y = isDragged ? drag!.y : pos.gy * cellSz + cellSz / 2 + panY;

          // Red targeting ring for enemies in weapon/single-target-spell range, or inside an AoE template
          if (targeting && playerPos) {
            if (spellArea && aoeOrigin) {
              if (inArea(spellArea, aoeOrigin.originGx, aoeOrigin.originGy, aoeOrigin.dirGx, aoeOrigin.dirGy, pos.gx + 0.5, pos.gy + 0.5, aoeOrigin.isSelf)) {
                ctx.beginPath();
                ctx.arc(x, y, tokenR + 6, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
                ctx.lineWidth = 2.5;
                ctx.stroke();
              }
            } else if (!spellArea) {
              const range = targeting.kind === 'weapon' ? targeting.weapon.range : parseRangeFeet(targeting.spell.range);
              const extendedRange = targeting.kind === 'weapon' ? targeting.weapon.extendedRange : undefined;
              const dist = Math.max(Math.abs(pos.gx - playerPos.gx), Math.abs(pos.gy - playerPos.gy));
              const inNormal = dist <= Math.floor(range / 5);
              const inExtended = !inNormal && !!extendedRange && dist <= Math.floor(extendedRange / 5);
              if (inNormal) {
                ctx.beginPath();
                ctx.arc(x, y, tokenR + 6, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
                ctx.lineWidth = 2.5;
                ctx.stroke();
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

          const isDead = deadCreatureIds?.has(enemy.id);
          if (isDead) ctx.filter = 'grayscale(1) opacity(0.45)';
          drawToken(ctx, x, y, (enemy.name[0] ?? '?').toUpperCase(), enemy.name, isDead ? '#555' : '#c0392b', tokenR, hoveredTokenKey === enemy.id);
          if (isDead) ctx.filter = 'none';

          // Hit flash overlay
          const enemyFlash = flashEffectsRef.current.find(f => f.tokenKey === enemy.id);
          if (enemyFlash) {
            const ft = (Date.now() - enemyFlash.startTime) / FLASH_DUR;
            ctx.save();
            ctx.globalAlpha = Math.sin(ft * Math.PI) * 0.6;
            ctx.fillStyle = '#ff2222';
            ctx.beginPath(); ctx.arc(x, y, tokenR, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }
        });

        // Fog-of-war: black over anything outside my own sight radius OR behind a wall from my
        // own position — computed from my own token only, never synced, so nobody else's sight
        // lines are visible to me or mine to them. Drawn before the AoE template, own token, and
        // floating text below, so those always render in full regardless of fog.
        if (dungeon && visibleCells) {
          ctx.fillStyle = DUNGEON_BG;
          for (let row = 0; row < dungeon.height; row++) {
            for (let col = 0; col < dungeon.width; col++) {
              if (visibleCells.has(`${col},${row}`)) continue;
              ctx.fillRect(col * cellSz + panX, row * cellSz + panY, cellSz, cellSz);
            }
          }
        }

        // AoE spell template shape — drawn on top of fog so it always renders in full
        if (spellArea && aoeOrigin) {
          drawAoeShape(ctx, spellArea, aoeOrigin.originGx, aoeOrigin.originGy, aoeOrigin.dirGx, aoeOrigin.dirGy, aoeOrigin.isSelf, cellSz, panX, panY);
        }

        // Own token — drawn on top of fog so it's never obscured, even mid-drag into an unrevealed cell
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

          // Caught in own AoE template — same red ring as enemies/allies, so friendly fire is visible before confirming
          if (spellArea && aoeOrigin && inArea(spellArea, aoeOrigin.originGx, aoeOrigin.originGy, aoeOrigin.dirGx, aoeOrigin.dirGy, playerPos.gx + 0.5, playerPos.gy + 0.5, aoeOrigin.isSelf)) {
            ctx.beginPath();
            ctx.arc(x, y, tokenR + 6, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }

          if (isDead) ctx.filter = 'grayscale(1) opacity(0.25)';
          else if (isDown) ctx.filter = 'grayscale(1) opacity(0.55)';
          drawToken(ctx, x, y, (player[0] ?? '?').toUpperCase(), player, '#3a7bd5', tokenR, hoveredTokenKey === player, img);
          ctx.filter = 'none';

          // Hit flash overlay
          const playerFlash = flashEffectsRef.current.find(f => f.tokenKey === player);
          if (playerFlash) {
            const ft = (Date.now() - playerFlash.startTime) / FLASH_DUR;
            ctx.save();
            ctx.globalAlpha = Math.sin(ft * Math.PI) * 0.6;
            ctx.fillStyle = '#ff2222';
            ctx.beginPath(); ctx.arc(x, y, tokenR, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }

          // Dead marker: a red × over the token
          if (isDead) {
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
        }

        // Floating hit/miss text — drawn above tokens, walls, and fog so the animation (which
        // drifts upward, possibly into a different cell) never gets clipped mid-flight or hidden
        // beneath a token. Gated once on the origin cell's visibility rather than the animated
        // pixel position, so a float still shows in full if the token it's attached to was in
        // sight when it fired.
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
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [player, connected, showBattleMap, encounter, tokenCacheVer, tokenPositions, dragTick, targeting, movementRemaining, downPlayerNames, deadPlayerNames, animTick, dungeon, sizeTick, aoeTick, visibleCells, hoverHitChance, hoveredTokenKey]);

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
          for (const enemy of encounter!) {
            const epos = tokenPositions[enemy.id];
            if (epos && inArea(area, origin.originGx, origin.originGy, origin.dirGx, origin.dirGy, epos.gx + 0.5, epos.gy + 0.5, origin.isSelf)) targetIds.push(enemy.id);
          }
          for (const name of connected) {
            const ppos = tokenPositions[name];
            if (ppos && inArea(area, origin.originGx, origin.originGy, origin.dirGx, origin.dirGy, ppos.gx + 0.5, ppos.gy + 0.5, origin.isSelf)) targetIds.push(name);
          }
          dispatch('vtt:combat:spell:cast', { casterName: player, casterId: targetingNow.casterId, spell: targetingNow.spell, slotLevel: targetingNow.slotLevel ?? targetingNow.spell.level, targetIds });
          e.preventDefault();
          return;
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
              } else if (targetingNow.spell.combat?.resolution === 'attack') {
                dispatch('vtt:combat:spell:attack', { casterName: player, casterId: targetingNow.casterId, targetId: enemy.id, targetName: enemy.name, spell: targetingNow.spell, slotLevel: targetingNow.slotLevel ?? targetingNow.spell.level });
              } else {
                dispatch('vtt:combat:spell:cast', { casterName: player, casterId: targetingNow.casterId, spell: targetingNow.spell, slotLevel: targetingNow.slotLevel ?? targetingNow.spell.level, targetIds: [enemy.id] });
              }
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
    }

    // Drag mode: own token only
    const pos = tokenPositions[player];
    if (!pos) return;
    const cx = pos.gx * hdCellSz + hdCellSz / 2;
    const cy = pos.gy * hdCellSz + hdCellSz / 2;
    if (Math.hypot(mx - cx, my - cy) <= TOKEN_R) {
      reachableRef.current = exploring && dungeon
        ? bfsReachable(dungeon.cells, pos.gx, pos.gy, Math.max(1, Math.floor(speed / 5)))
        : null;
      // Store drag position in screen space (includes pan so drag line renders correctly)
      dragRef.current = { id: player, x: cx + panX, y: cy + panY };
      dragOffset.current = { x: rawMx - (cx + panX), y: rawMy - (cy + panY) };
      e.currentTarget.style.cursor = 'grabbing';
      e.preventDefault();
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

    // Targeting mode cursor
    if (targetingRef.current && showBattleMap && encounter && tokenPositions) {
      const targetingNow = targetingRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const panX = dungeonPanRef.current.x;
      const panY = dungeonPanRef.current.y;
      const mmCellSz = CELL * dungeonZoomRef.current;
      const mx = e.clientX - rect.left - panX;
      const my = e.clientY - rect.top - panY;
      const playerPos = tokenPositions[player];

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
        for (const enemy of encounter) {
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
