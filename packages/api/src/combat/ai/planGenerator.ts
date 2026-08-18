import type { EnemyAction } from 'shared';
import type { Creature } from '../../domain/creature.ts';
import type { Participant } from '../../domain/encounter.ts';
import { ROLE_CONFIGS, type RoleConfig, type TargetPriority } from './roleConfig.ts';
import {
  MELEE_REACH_FT,
  averageDamage,
  distanceFt,
  livingAllies,
  livingOpposing,
  maxHpOf,
  posOf,
} from './planEvaluator.ts';
import type { MovementIntent, PlanActionRef, TacticalContext, TacticalPlan } from './types.ts';

/**
 * Wall-clock ceiling on candidate generation — models "how many options can this creature come up
 * with before it has to act". Anytime/iterative: candidates are emitted cheapest-and-most-relevant
 * first (role kit before filler), so running out of time leaves a usable set rather than garbage.
 * The realistic candidate space per creature is small, so exhausting it well inside the budget is
 * the normal case, not a bug — the deadline only exists to cap pathological stat blocks.
 */
export const PLAN_TIME_BUDGET_MS = 120;

/** How many targets per priority metric are worth handing the evaluator to compare. */
const TOP_TARGETS = 3;

/** Enemies with no living teammates left are maximally isolated — sorts them to the front. */
const FULLY_ISOLATED = Number.MAX_SAFE_INTEGER;

/** Distance from a participant to its own nearest living teammate, in feet. */
function isolationFt(ctx: TacticalContext, p: Participant): number {
  const self = posOf(ctx, p);
  if (!self) return 0;
  const mates = ctx.allParticipants.filter(o => o.teamId === p.teamId && o.id !== p.id && !o.isDown());
  return mates.reduce((min, o) => {
    const q = posOf(ctx, o);
    return q ? Math.min(min, distanceFt(self, q)) : min;
  }, FULLY_ISOLATED);
}

function distanceFromActor(ctx: TacticalContext, p: Participant): number {
  const self = posOf(ctx, ctx.actor);
  const q = posOf(ctx, p);
  return self && q ? distanceFt(self, q) : Infinity;
}

/**
 * Orders enemies by the role's preferred metric. Roles whose priority is ally-flavoured (Healer,
 * Commander) still need an enemy shortlist for whatever offence they carry — they fall back to
 * nearest, which is the old runEnemyAI behaviour.
 */
function rankEnemies(ctx: TacticalContext, priority: TargetPriority, enemies: Participant[]): Participant[] {
  const ranked = [...enemies];
  switch (priority) {
    case 'squishiestEnemy':
      return ranked.sort((a, b) => maxHpOf(a) - maxHpOf(b));
    case 'isolatedEnemy':
      return ranked.sort((a, b) => isolationFt(ctx, b) - isolationFt(ctx, a));
    default:
      return ranked.sort((a, b) => distanceFromActor(ctx, a) - distanceFromActor(ctx, b));
  }
}

/** Most-wounded first — what both heals and Commander-style buffs want. */
function rankAllies(allies: Participant[]): Participant[] {
  return [...allies].sort((a, b) => hpFraction(a) - hpFraction(b));
}

function hpFraction(p: Participant): number {
  const max = maxHpOf(p);
  return max > 0 ? (p.creature ? p.creature.currentHp : p.currentHp) / max : 1;
}

/** Highest-average-damage swing, or -1 when the creature has no attacks[] at all. */
function bestAttackIndex(creature: Creature): number {
  let best = -1;
  let bestAvg = -Infinity;
  creature.attacks.forEach((a, i) => {
    const avg = averageDamage(a.damage);
    if (avg > bestAvg) { bestAvg = avg; best = i; }
  });
  return best;
}

/**
 * Kiting roles back off when something is already inside their face and they have reach to spare;
 * otherwise close if out of range, stand still if in it. Intent only — the executor turns this
 * into actual steps.
 */
function movementFor(cfg: RoleConfig, threatened: boolean, distFt: number, rangeFt: number): MovementIntent {
  if (cfg.kitesWhenApproached && threatened && rangeFt > MELEE_REACH_FT) return 'retreat';
  return distFt > rangeFt ? 'approach' : 'hold';
}

/** Which side of the fight an action is aimed at. */
function targetsAllies(action: EnemyAction): boolean {
  return action.kind === 'heal' || action.kind === 'buff';
}

export function generatePlans(ctx: TacticalContext): TacticalPlan[] {
  const deadline = Date.now() + PLAN_TIME_BUDGET_MS;
  const creature = ctx.actor.creature;
  const self = posOf(ctx, ctx.actor);
  // Only non-player turns reach here, and a positionless actor can't act on the grid — nothing to plan.
  if (!creature || !self) return [];

  // An unassigned role behaves exactly like plain Infantry: nearest enemy, walk up, swing.
  const cfg = ROLE_CONFIGS[creature.role ?? 'Infantry'];
  const enemies = livingOpposing(ctx);
  const allies = livingAllies(ctx);

  const plans: TacticalPlan[] = [];
  const seen = new Set<string>();
  const push = (movement: MovementIntent, actionRef: PlanActionRef, targetId: string): void => {
    const id = `${movement}|${actionRef.source}|${actionRef.source === 'attack' ? actionRef.index : actionRef.actionId}|${targetId}`;
    if (seen.has(id)) return;
    seen.add(id);
    plans.push({ id, movement, actionRef, targetId });
  };

  // The floor. Whatever the role config says, "walk at the nearest thing and hit it" stays a legal
  // candidate so the selector always has something to fall back to (scores ≈1 by construction).
  const nearest = rankEnemies(ctx, 'nearestEnemy', enemies)[0];
  const baselineAttack = bestAttackIndex(creature);
  if (nearest && baselineAttack >= 0) push('approach', { source: 'attack', index: baselineAttack }, nearest.id);

  const threatened = enemies.some(p => {
    const q = posOf(ctx, p);
    return q !== undefined && distanceFt(self, q) <= MELEE_REACH_FT;
  });

  const enemyTargets = rankEnemies(ctx, cfg.targetPriority, enemies).slice(0, TOP_TARGETS);
  const allyTargets = rankAllies(allies).slice(0, TOP_TARGETS);

  type Seed = { ref: PlanActionRef; rangeFt: number; targets: Participant[]; selfCast?: boolean };
  const attackSeeds: Seed[] = creature.attacks.map((_, index) => ({
    ref: { source: 'attack', index },
    rangeFt: MELEE_REACH_FT,
    targets: enemyTargets,
  }));

  const actionSeeds: Seed[] = creature.actions.map(action => {
    const isSummon = action.kind === 'summon';
    // "If left unchecked" — gated on rounds since this creature was last damaged, not HP. Only
    // offered as a candidate once it's actually been unchallenged for that long; otherwise this
    // action contributes no plan this turn at all.
    const summonReady = isSummon && ctx.round - creature.lastDamagedRound >= action.triggerRoundsUnchallenged;
    return {
      ref: { source: 'action', actionId: action.id },
      rangeFt: isSummon ? 0 : action.range,
      targets: isSummon ? (summonReady ? [ctx.actor] : []) : targetsAllies(action) ? allyTargets : enemyTargets,
      selfCast: isSummon,
    };
  });

  // Roles that avoid melee spend the budget on their real kit — the baseline swing above is
  // already generated as their last-resort option, so extra melee variants add nothing.
  const seeds = cfg.avoidMeleeUnlessNoOption ? actionSeeds : [...attackSeeds, ...actionSeeds];

  for (const seed of seeds) {
    for (const target of seed.targets) {
      if (Date.now() >= deadline) return plans;
      const movement = seed.selfCast
        ? 'hold'
        : movementFor(cfg, threatened, distanceFromActor(ctx, target), seed.rangeFt);
      push(movement, seed.ref, target.id);
    }
  }

  return plans;
}
