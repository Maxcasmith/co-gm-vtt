import type { EnemyAction } from 'shared';
import type { Creature } from '../../domain/creature.ts';
import type { Participant } from '../../domain/encounter.ts';
import type { PlanActionRef, TacticalContext, TacticalPlan } from './types.ts';

/**
 * Scores a candidate plan on one shared currency, the way a chess engine folds material and
 * king-safety into a single centipawn number: every term (damage, healing, buffs, summons,
 * positioning) is converted to "fraction of the party's HP pool this swings" and summed.
 *
 * Calibrated against two anchors given by the feature owner:
 *   walk up and swing at one party member  → 1
 *   one action that would wipe the party   → 20
 * hence score = 1 + 19 * partyImpactFraction, clamped.
 */
export const BASELINE_SCORE = 1;
export const MAX_SCORE = 20;

export const FEET_PER_TILE = 5;
export const MELEE_REACH_FT = 5;

/**
 * Flat to-hit estimate rather than a real d20-vs-AC calculation. Deriving the true chance means
 * resolving the target's AC through calcAC/listCharacters (async, DB-backed — see runEnemyAI's
 * attack branch), which is far more machinery than a ranking heuristic warrants; ~65% is the
 * typical hit rate for an on-CR creature swinging at on-level AC and it shifts every candidate
 * by the same factor, so the *ordering* plans are selected by is unaffected.
 */
const FLAT_HIT_CHANCE = 0.65;
/** Rough odds a party member fails an on-CR save — drives both AoE damage and whether a debuff lands. */
const SAVE_FAIL_CHANCE = 0.55;
/** Save-for-half AoEs: full damage on a fail, half on a success. */
const SAVED_DAMAGE_FRACTION = SAVE_FAIL_CHANCE + (1 - SAVE_FAIL_CHANCE) * 0.5;
/**
 * Downing a party member is a phase change, not just material — it removes a whole turn from the
 * party's economy — so a lethal blow is worth more than the same HP chipped off several targets.
 * Kept deliberately modest: a plan that kills the entire party still clamps to 20 either way.
 */
const KILL_MULTIPLIER = 1.5;
/** A summon threatens on *later* turns, so its future damage is discounted against this turn's. */
const SUMMON_FUTURE_DISCOUNT = 0.5;
/** Positioning is a tiebreaker between plans of similar impact, never the deciding term. */
const POSITION_WEIGHT = 0.02;
/** Stand-in damage-per-round when the actor has no attacks[] to measure a representative swing from. */
const DEFAULT_REP_DAMAGE = 5;
/** Each +1 on a d20 moves the hit chance by one face. */
const PER_POINT_HIT_SHIFT = 1 / 20;

// ── Shared helpers (planGenerator imports these too — one implementation, not two) ────────────

/**
 * Expected value of a "1d6+1"-style formula. dice.ts only exposes the random `rollDice`; scoring
 * needs the average, and rolling to score would make plan ranking non-deterministic.
 */
export function averageDamage(formula: string): number {
  const m = formula.match(/^\s*(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?\s*$/i);
  if (!m) {
    const flat = Number(formula.trim());
    return Number.isFinite(flat) ? flat : 0;
  }
  const count = parseInt(m[1]!);
  const faces = parseInt(m[2]!);
  const mod = m[3] ? parseInt(m[3].replace(/\s+/g, '')) : 0;
  return (count * (faces + 1)) / 2 + mod;
}

/** Players key their token by name, everyone else by id — the existing convention, see runEnemyAI. */
export function tokenKey(p: Participant): string {
  return p.isPlayer ? p.name : p.id;
}

export function posOf(ctx: TacticalContext, p: Participant): { gx: number; gy: number } | undefined {
  return ctx.positions[tokenKey(p)];
}

/** Chebyshev distance in feet — the grid metric the rest of combat already uses. */
export function distanceFt(a: { gx: number; gy: number }, b: { gx: number; gy: number }): number {
  return Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy)) * FEET_PER_TILE;
}

/** Creature-backed participants track live HP on the Creature; players track it on the Participant. */
export function hpOf(p: Participant): number {
  return p.creature ? p.creature.currentHp : p.currentHp;
}

export function maxHpOf(p: Participant): number {
  return p.creature ? p.creature.hp : p.maxHp;
}

export function livingOpposing(ctx: TacticalContext): Participant[] {
  return ctx.allParticipants.filter(p => p.teamId !== ctx.actor.teamId && !p.isDown());
}

/** The actor is a legal heal/buff target for its own kit, so it's included in its own team's list. */
export function livingAllies(ctx: TacticalContext): Participant[] {
  return ctx.allParticipants.filter(p => p.teamId === ctx.actor.teamId && !p.isDown());
}

export function findAction(creature: Creature, ref: PlanActionRef): EnemyAction | undefined {
  return ref.source === 'action' ? creature.actions.find(a => a.id === ref.actionId) : undefined;
}

/** Effective reach of whatever the plan intends to use — plain attacks[] swings are melee, summons are self-cast. */
export function actionRangeFt(creature: Creature, ref: PlanActionRef): number {
  const action = findAction(creature, ref);
  if (!action) return MELEE_REACH_FT;
  return action.kind === 'summon' ? 0 : action.range;
}

/** Best average swing the actor has, used as the representative damage-per-round for buff/debuff/summon maths. */
export function bestAttackAverage(creature: Creature): number {
  const best = creature.attacks.reduce((max, a) => Math.max(max, averageDamage(a.damage)), 0);
  return best > 0 ? best : DEFAULT_REP_DAMAGE;
}

/**
 * The denominator every impact term is expressed against: **current** HP, not max. A party already
 * at half health is genuinely closer to the "wipe" anchor, and the same fireball should score
 * higher there than it does against a fresh party — using maxHp would flatten that out.
 */
export function partyHpPool(ctx: TacticalContext): number {
  const pool = livingOpposing(ctx).reduce((sum, p) => sum + hpOf(p), 0);
  return Math.max(1, pool);
}

function teamHpPool(participants: Participant[]): number {
  return Math.max(1, participants.reduce((sum, p) => sum + hpOf(p), 0));
}

// ── Scoring ──────────────────────────────────────────────────────────────────────────────────

/** Damage as a fraction of the pool, capped at what the target actually has left (overkill is wasted). */
function damageFraction(expected: number, target: Participant, pool: number): number {
  const hp = hpOf(target);
  if (hp <= 0 || expected <= 0) return 0;
  const swing = Math.min(expected, hp);
  return (swing / pool) * (expected >= hp ? KILL_MULTIPLIER : 1);
}

function aoeFraction(action: Extract<EnemyAction, { kind: 'aoe' }>, target: Participant | undefined, ctx: TacticalContext, pool: number): number {
  const centre = target && posOf(ctx, target);
  if (!centre) return 0;
  const expected = averageDamage(action.damage) * SAVED_DAMAGE_FRACTION;
  return livingOpposing(ctx)
    .filter(p => {
      const q = posOf(ctx, p);
      return q !== undefined && distanceFt(centre, q) <= action.radius;
    })
    .reduce((sum, p) => sum + damageFraction(expected, p, pool), 0);
}

/**
 * Healing is scored against the actor's *own* team pool — restoring an ally is the mirror of
 * removing party HP — and weighted by how close the target is to dropping, so a big heal on a
 * near-dead ally beats topping off someone at full (who scores 0, having nothing to restore).
 */
function healFraction(action: Extract<EnemyAction, { kind: 'heal' }>, target: Participant | undefined, ctx: TacticalContext): number {
  if (!target) return 0;
  const max = maxHpOf(target);
  const missing = max - hpOf(target);
  if (missing <= 0 || max <= 0) return 0;
  const restored = Math.min(averageDamage(action.healFormula), missing);
  const urgency = 1 - hpOf(target) / max;
  return (restored / teamHpPool(livingAllies(ctx))) * (1 + urgency);
}

/**
 * Buffs and debuffs are converted to damage-equivalent: every +1 (or -1) on a d20 shifts the hit
 * chance by one face, a bonus/penalty die contributes its own average, and that shift applied to a
 * representative damage-per-round over the effect's duration is the HP swing it's worth.
 */
function modifierFraction(action: Extract<EnemyAction, { kind: 'buff' | 'debuff' }>, creature: Creature, pool: number): number {
  const die = action.kind === 'buff' ? action.rollBonusDie : action.rollPenaltyDie;
  const ac = action.kind === 'buff' ? action.acBonus : action.acPenalty;
  const shift = ((die ? (die + 1) / 2 : 0) + (ac ?? 0)) * PER_POINT_HIT_SHIFT;
  if (shift <= 0) return 0;
  // A debuff has to beat a save first; a buff on your own side always lands.
  const landChance = action.kind === 'debuff' ? SAVE_FAIL_CHANCE : 1;
  return (shift * bestAttackAverage(creature) * action.durationRounds * landChance) / pool;
}

/**
 * Summons hurt nobody this turn, so they get a deliberately rough stand-in for future threat:
 * the actor's own best swing (a proxy for what a minion of its faction hits for — there's no
 * stat block for templateRole at plan time) times the count, halved because it's next turn's
 * damage, not this turn's. Not lookahead search; just enough to rank a summon above doing nothing
 * and below a real hit.
 */
function summonFraction(action: Extract<EnemyAction, { kind: 'summon' }>, creature: Creature, pool: number): number {
  return (bestAttackAverage(creature) * action.count * SUMMON_FUTURE_DISCOUNT) / pool;
}

/** Small tiebreaker: did the movement intent actually buy anything this turn? */
function positionFraction(plan: TacticalPlan, ctx: TacticalContext, creature: Creature, target: Participant | undefined): number {
  const self = posOf(ctx, ctx.actor);
  if (!self) return 0;

  if (plan.movement === 'retreat') {
    const threatened = livingOpposing(ctx).some(p => {
      const q = posOf(ctx, p);
      return q !== undefined && distanceFt(self, q) <= MELEE_REACH_FT;
    });
    return threatened ? POSITION_WEIGHT : -POSITION_WEIGHT;
  }

  if (plan.movement === 'approach') {
    const tp = target && posOf(ctx, target);
    if (!tp) return 0;
    const gap = distanceFt(self, tp) - actionRangeFt(creature, plan.actionRef);
    if (gap <= 0) return 0; // already in range — walking buys nothing
    return gap <= creature.speed ? POSITION_WEIGHT : -POSITION_WEIGHT; // closes it, or burns the turn short
  }

  return 0; // hold
}

export function evaluatePlan(plan: TacticalPlan, ctx: TacticalContext): number {
  const creature = ctx.actor.creature;
  if (!creature) return 0;

  const pool = partyHpPool(ctx);
  const target = ctx.allParticipants.find(p => p.id === plan.targetId);
  let impact = 0;

  if (plan.actionRef.source === 'attack') {
    const atk = creature.attacks[plan.actionRef.index];
    if (atk && target) impact += damageFraction(averageDamage(atk.damage) * FLAT_HIT_CHANCE, target, pool);
  } else {
    const action = findAction(creature, plan.actionRef);
    switch (action?.kind) {
      case 'aoe': impact += aoeFraction(action, target, ctx, pool); break;
      case 'heal': impact += healFraction(action, target, ctx); break;
      case 'buff':
      case 'debuff': impact += modifierFraction(action, creature, pool); break;
      case 'summon': impact += summonFraction(action, creature, pool); break;
      default: break;
    }
  }

  impact += positionFraction(plan, ctx, creature, target);

  const score = BASELINE_SCORE + (MAX_SCORE - BASELINE_SCORE) * impact;
  return Math.min(MAX_SCORE, Math.max(0, score));
}

/** Convenience for the selector: the same plans with `score` filled in, highest first. */
export function evaluatePlans(plans: TacticalPlan[], ctx: TacticalContext): TacticalPlan[] {
  return plans
    .map(p => ({ ...p, score: evaluatePlan(p, ctx) }))
    .sort((a, b) => b.score - a.score);
}
