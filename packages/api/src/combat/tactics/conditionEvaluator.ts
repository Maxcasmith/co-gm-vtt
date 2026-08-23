import type { Character, TacticCondition, TargetRef } from 'shared';
import type { Participant } from '../../domain/encounter.ts';
import type { TacticalContext } from '../ai/types.ts';
import { distanceFt, hpOf, livingAllies, livingOpposing, maxHpOf, posOf, tokenKey } from '../ai/planEvaluator.ts';

/** Closest of `candidates` to the actor, or just the first one if positions aren't available. */
function nearestOf(candidates: Participant[], ctx: TacticalContext): Participant | undefined {
  const self = posOf(ctx, ctx.actor);
  if (!self) return candidates[0];

  let best: Participant | undefined;
  let bestDist = Infinity;
  for (const p of candidates) {
    const pos = posOf(ctx, p);
    if (!pos) continue;
    const d = distanceFt(self, pos);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best ?? candidates[0];
}

/** Highest/lowest current HP among `candidates` — ties keep whichever came first. */
function extremeHpOf(candidates: Participant[], mode: 'min' | 'max'): Participant | undefined {
  return candidates.reduce<Participant | undefined>((best, p) => {
    if (!best) return p;
    return mode === 'min' ? (hpOf(p) < hpOf(best) ? p : best) : (hpOf(p) > hpOf(best) ? p : best);
  }, undefined);
}

/** Closest living enemy to the actor, or just the first one if positions aren't available — same fallback shape as runEnemyAI's target pick. */
export function nearestEnemy(ctx: TacticalContext): Participant | undefined {
  return nearestOf(livingOpposing(ctx), ctx);
}

/** Every living ally except the actor itself — moving "toward yourself" isn't a meaningful target. */
function livingAlliesExcludingSelf(ctx: TacticalContext): Participant[] {
  return livingAllies(ctx).filter(p => p.id !== ctx.actor.id);
}

/**
 * Whether `p` currently has a status matching `statusFilter` ("any"/undefined = has any status at
 * all). Only reads creature-backed conditions (enemies, creature-allies) — a player ally has no
 * live conditions source reachable here, same documented gap as evaluateCondition's statusPresent.
 */
function hasMatchingStatus(p: Participant, statusFilter: TargetRef['statusFilter']): boolean {
  const conditions = p.creature?.conditions;
  if (!conditions?.length) return false;
  return statusFilter === undefined || statusFilter === 'any' ? true : conditions.some(c => c.name === statusFilter);
}

/** Resolves a "target" directive to a live participant — see shared/types/tactics.ts's TargetRef doc. */
export function resolveTarget(ref: TargetRef, ctx: TacticalContext): Participant | undefined {
  switch (ref.strategy) {
    case 'self': return ctx.actor;
    case 'closestEnemy': return nearestOf(livingOpposing(ctx), ctx);
    case 'lowestHpEnemy': return extremeHpOf(livingOpposing(ctx), 'min');
    case 'highestHpEnemy': return extremeHpOf(livingOpposing(ctx), 'max');
    case 'closestAlly': return nearestOf(livingAlliesExcludingSelf(ctx), ctx);
    case 'lowestHpAlly': return extremeHpOf(livingAlliesExcludingSelf(ctx), 'min');
    case 'highestHpAlly': return extremeHpOf(livingAlliesExcludingSelf(ctx), 'max');
    case 'allyWithStatus': return nearestOf(livingAlliesExcludingSelf(ctx).filter(p => hasMatchingStatus(p, ref.statusFilter)), ctx);
  }
}

export function selfHpPct(character: Character): number {
  const max = character.maxHp ?? 1;
  return max <= 0 ? 0 : ((character.currentHp ?? 0) / max) * 100;
}

export function targetHpPct(target: Participant | undefined): number {
  if (!target) return 100;
  const max = maxHpOf(target);
  return max <= 0 ? 0 : (hpOf(target) / max) * 100;
}

/** Per-turn state a step's condition can react to but that isn't derivable from Character/Participant alone — see executionLoop.ts. */
export interface TurnState {
  lastActionMissed: boolean;
}

/** True when a step's gate is satisfied right now — eligibility only; executionLoop.ts scores every eligible step and executes the winner, so this doesn't decide priority, just "is this legal to consider." */
export function evaluateCondition(
  condition: TacticCondition, character: Character, target: Participant | undefined, ctx: TacticalContext, turnState: TurnState,
): boolean {
  switch (condition.kind) {
    case 'hpBelowPct': {
      // No resolved target never matches, same for either unit — mirrors targetHpPct's own "no target = 100%, never below" default.
      const value = condition.unit === 'hp' ? (target ? hpOf(target) : Infinity) : targetHpPct(target);
      return value < condition.amount;
    }
    case 'statusPresent': {
      // Creature-backed targets (enemies, creature-allies) track conditions on the Creature;
      // players track them on their Character record instead — but evaluateCondition only ever
      // has the *acting* character's own record in hand, not an arbitrary player target's. That's
      // fine for the common case (a "Target: Self" directive resolving target to the actor), but a
      // status check on a *different* player (an ally PC) has no live conditions source here and
      // reads as absent — a real gap, not a silent-wrong: it just never matches rather than crashing.
      const conditions = target?.creature?.conditions ?? (target?.id === character.id ? character.conditions : undefined);
      return conditions?.some(c => c.name === condition.status) ?? false;
    }
    case 'inRange': {
      if (!target) return false;
      const self = ctx.positions[tokenKey(ctx.actor)];
      const targetPos = posOf(ctx, target);
      return !!self && !!targetPos && distanceFt(self, targetPos) <= condition.ft;
    }
    case 'lastActionMissed':
      return turnState.lastActionMissed;
    case 'always':
      return true;
  }
}
