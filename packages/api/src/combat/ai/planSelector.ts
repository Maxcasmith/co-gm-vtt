import type { TacticalPlan } from './types.ts';

/** Confirmed scale: planEvaluator scores every plan 0-20, so an int of 20+ can reach anything. */
const MAX_INTELLIGENCE_SCORE = 20;

/**
 * Bounded-rationality pick: a creature executes the best plan it's smart enough to conceive of,
 * not necessarily the objectively best one available — an int-3 creature won't find the clever
 * play even when planGenerator handed it one. Filters to plans scored at or below the creature's
 * (capped) intelligence, then takes the highest-scoring survivor, first-found on ties.
 *
 * `plans` must be non-empty and every plan must already carry a `.score` (run planEvaluator
 * first) — planGenerator's contract guarantees a baseline "approach and attack" plan (score ~1)
 * is always present, which is what keeps the `legal` filter from ever coming back empty in
 * practice; the `plans` fallback below only exists so a caller that violates that contract still
 * gets a same-shape answer instead of a thrown error mid-combat.
 */
export function selectPlan(plans: TacticalPlan[], intelligence: number): TacticalPlan {
  if (plans.length === 0) throw new Error('selectPlan: no candidate plans — planGenerator must always return at least the baseline plan');

  const cap = Math.min(intelligence, MAX_INTELLIGENCE_SCORE);
  const legal = plans.filter(p => (p.score ?? 0) <= cap);
  const pool = legal.length ? legal : plans;

  return pool.reduce((best, p) => ((p.score ?? 0) > (best.score ?? 0) ? p : best), pool[0]!);
}
