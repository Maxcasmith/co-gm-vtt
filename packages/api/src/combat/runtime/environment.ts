import { readManifest } from '../../storage.ts';
import { toClientDungeon } from '../../dungeon/index.ts';
import { io, ROOM, dungeons, withLivePositions, getStateEngine, stateEngines } from '../../state.ts';
import type { GameTimeExpiryHook } from '../stateEngine/hooks/ExpiryHook.ts';
import type { IlluminationSourceHook } from '../stateEngine/hooks/IlluminationSourceHook.ts';
import { tokenKey } from '../ai/planEvaluator.ts';

/**
 * Recomputes the loaded dungeon's live `illumination` as max(its authored baseIllumination, every
 * active illuminationSource hook's level) and re-broadcasts the dungeon if it actually changed —
 * a light spell brightens the whole dungeon rather than a local radius (no per-cell light model
 * exists), so this is a single global number, not something per-token. Called right after a spell
 * registers an illuminationSource hook (immediate feedback on cast) and once per turn-start sweep
 * (covers a Dim Light/other timed source expiring — see runTurnStart, which runs after every
 * beforeRound/beforeTurn expiry prune). Cheap no-op when nothing changed.
 */
export function recomputeIllumination(cid: string): void {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const base = dungeon.baseIllumination ?? dungeon.illumination ?? 1;
  const sources = getStateEngine(cid).getHooksByKind('illuminationSource') as IlluminationSourceHook[];
  const effective = sources.reduce((max, h) => Math.max(max, h.level), base);
  if (effective === (dungeon.illumination ?? 1)) return;
  dungeon.illumination = effective;
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
}

/**
 * Sets or clears a character's light emission (a held torch) and re-broadcasts the dungeon if it
 * actually changed — same broadcast convention as recomputeIllumination, but keyed per-character
 * rather than a single global scalar since each light source has its own position (resolved
 * client-side from the live token position; see Dungeon.lightSources and Canvas.tsx's litCells).
 * `tokenKey` must be the character's *name*, not id — tokenPositions/dungeon.positions are keyed
 * by name for player tokens (see GamePage.tsx's `tokenPositions[character.name]`), and litCells
 * looks up `tokenPositions[key]` for every entry in lightSources — an id key would never resolve.
 * Called on equip/unequip (socketHandlers/inventory.ts) — a rare user action, so unlike
 * recomputeIllumination there's no cheap-no-op guard here, it just always re-broadcasts.
 */
export function setLightSourceFor(cid: string, tokenKey: string, rangeFt: number): void {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const lightSources = { ...dungeon.lightSources };
  if (rangeFt > 0) lightSources[tokenKey] = rangeFt; else delete lightSources[tokenKey];
  dungeon.lightSources = lightSources;
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
}

/**
 * The other half of HookDuration's 'gameTime' — round/turn expiries fire off the combat turn
 * loop (ExpiryHook/RoundExpiryHook), but game-time ones have no turn loop to ride during
 * exploration, so nothing fires them automatically. Call this wherever worldTimeSecs actually
 * advances (today: effects.ts's 'advanceTime' narration effect) and it sweeps every campaign
 * with a live StateEngine for GameTimeExpiryHooks whose timestamp has passed. Reusable by any
 * future gameTime spell — it doesn't know or care which one registered a given hook.
 */
export function sweepGameTimeExpiries(cid: string, currentSecs: number): void {
  const engine = stateEngines.get(cid);
  if (!engine) return;
  const due = engine.getHooksByKind('gameTimeExpiry') as GameTimeExpiryHook[];
  for (const hook of due) {
    if (hook.expiresAtSecs > currentSecs) continue;
    void hook.apply({ round: 0 }, engine);
  }
  if (due.length) recomputeIllumination(cid);
}

/** Current worldTimeSecs for a campaign — the anchor a `gameTime` duration's relative `gameSecs` is added to at cast time. */
export async function getWorldTimeSecs(cid: string): Promise<number> {
  const manifest = await readManifest(cid);
  return manifest?.worldTimeSecs ?? 43200;
}

