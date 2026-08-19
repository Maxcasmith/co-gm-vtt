import { useMemo } from 'react';
import type { Character, Dungeon } from 'shared';
import { hasLineOfSight, getSenses } from 'shared';
import { SIGHT_RADIUS, LIGHT_PENUMBRA_FT } from './constants.ts';
import { computeVisibilityPolygon } from './geometry.ts';
import type { SenseCells, LightSourceCells } from './types.ts';

/**
 * Everything that decides what the local player can currently see: fog-of-war (own-eyes sight
 * radius + walls), torch/point-light coverage, and every sense the character's species grants.
 * All are pure functions of the dungeon and token positions, recomputed only when those actually
 * change — never per animation frame — so they're grouped here rather than left inline in
 * Canvas.tsx.
 */
export function useVision(
  dungeon: Dungeon | undefined,
  tokenPositions: Record<string, { gx: number; gy: number }> | undefined,
  player: string,
  character: Character | undefined,
) {
  const myPos = tokenPositions?.[player];

  // Fog-of-war: cells visible to my own token — square radius + wall-blocked line-of-sight.
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

  // Light sources (torches, point lights) — hard-cutoff radius, wall-blocked (same
  // hasLineOfSight walk fog uses), 5ft/cell Chebyshev distance (same convention as
  // nearbyParticipantIds server-side). Every source is full-bright inside its radius — no
  // per-source level, no falloff — combined with `illumination` via max() when rendered.
  //
  // Dep key below is only the light-carrying tokens' own positions, not the whole tokenPositions
  // object — that object gets a new identity on every token move (any player/enemy/companion
  // step), which would otherwise re-walk every source's wall-raycast radius on unrelated moves.
  const lightSourceTokenIds = dungeon?.lightSources ? Object.keys(dungeon.lightSources) : null;
  const lightCarrierPosKey = lightSourceTokenIds?.length
    ? lightSourceTokenIds.map(id => { const p = tokenPositions?.[id]; return p ? `${id}:${p.gx},${p.gy}` : id; }).join('|')
    : null;
  // litCells stays the merged flat set every existing consumer (tokenLightFilter, the ground
  // overlay's hard exclude) wants; lightSources keeps each source's own cells alongside its
  // position/radius so the ground overlay's vignette pass (lighting.ts) can feather each torch's
  // falloff around its own center instead of the merged blob's.
  const { litCells, lightSources } = useMemo(() => {
    if (!dungeon) return { litCells: null, lightSources: null };
    const sources: { gx: number; gy: number; rangeFt: number }[] = [
      ...(dungeon.pointLights ?? []),
      ...Object.entries(dungeon.lightSources ?? {})
        .map(([tokenId, rangeFt]) => { const pos = tokenPositions?.[tokenId]; return pos ? { gx: pos.gx, gy: pos.gy, rangeFt } : null; })
        .filter((s): s is { gx: number; gy: number; rangeFt: number } => s !== null),
    ];
    if (!sources.length) return { litCells: null, lightSources: null };
    const merged = new Set<string>();
    const perSource: LightSourceCells[] = [];
    for (const src of sources) {
      const radiusCells = Math.floor(src.rangeFt / 5);
      const glowRangeFt = src.rangeFt + LIGHT_PENUMBRA_FT;
      const glowRadiusCells = Math.floor(glowRangeFt / 5);
      const cells = new Set<string>();
      const glowCells = new Set<string>();
      for (let dy = -glowRadiusCells; dy <= glowRadiusCells; dy++) {
        for (let dx = -glowRadiusCells; dx <= glowRadiusCells; dx++) {
          const distFt = Math.max(Math.abs(dx), Math.abs(dy)) * 5;
          if (distFt > glowRangeFt) continue;
          const tx = src.gx + dx, ty = src.gy + dy;
          if (tx < 0 || ty < 0 || tx >= dungeon.width || ty >= dungeon.height) continue;
          if (!hasLineOfSight(dungeon.cells, src.gx, src.gy, tx, ty)) continue;
          glowCells.add(`${tx},${ty}`);
          if (distFt <= src.rangeFt) { cells.add(`${tx},${ty}`); merged.add(`${tx},${ty}`); }
        }
      }
      perSource.push({ gx: src.gx, gy: src.gy, radiusCells, cells, glowCells, glowRadiusCells });
    }
    return { litCells: merged, lightSources: perSource };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeon, lightCarrierPosKey]);

  // Senses — one wall-blocked radius per sense the character's species grants (darkvision today;
  // blindsight/truesight/devilsSight/tremorsense once something actually grants them — see
  // getSenses), each ignoring the global illumination overlay once it's dark enough to matter
  // (lighting.ts decides how — full color vs monochrome — per sense kind). tremorsense is the one
  // exception to wall-blocking: it senses vibration through the ground, not light, so walls don't
  // stop it. Subspecies overrides (Drow's 120ft darkvision) aren't tracked — Character has no
  // persisted subspecies field, see getSenses.
  const senses = useMemo(() => {
    if (!dungeon || !myPos || !character) return null;
    const granted = getSenses(character.species);
    if (!granted.length) return null;
    const result: SenseCells = {};
    for (const sense of granted) {
      const radiusCells = Math.floor(sense.rangeFt / 5);
      const set = result[sense.kind] ?? new Set<string>();
      for (let dy = -radiusCells; dy <= radiusCells; dy++) {
        for (let dx = -radiusCells; dx <= radiusCells; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) * 5 > sense.rangeFt) continue;
          const tx = myPos.gx + dx, ty = myPos.gy + dy;
          if (tx < 0 || ty < 0 || tx >= dungeon.width || ty >= dungeon.height) continue;
          if (sense.kind === 'tremorsense' || hasLineOfSight(dungeon.cells, myPos.gx, myPos.gy, tx, ty)) set.add(`${tx},${ty}`);
        }
      }
      result[sense.kind] = set;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeon, myPos?.gx, myPos?.gy, character?.species]);

  // Fog boundary for rendering — a ray-swept polygon so the drawn edge follows natural angled
  // lines off walls/corners rather than a cell-square staircase. `visibleCells` above stays the
  // grid-based source of truth for per-cell logic (token hover, floating-text gating).
  const visiblePolygon = useMemo(() => {
    if (!dungeon || !myPos) return null;
    return computeVisibilityPolygon(dungeon.cells, myPos.gx + 0.5, myPos.gy + 0.5, SIGHT_RADIUS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dungeon, myPos?.gx, myPos?.gy]);

  return { visibleCells, litCells, lightSources, senses, visiblePolygon };
}
