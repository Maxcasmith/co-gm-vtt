import type { Participant } from '../../domain/encounter.ts';

/** Where an action being considered in a plan actually comes from on the creature's stat block. */
export type PlanActionRef =
  | { source: 'attack'; index: number }
  | { source: 'action'; actionId: string };

/**
 * 'approach': close toward the target (melee roles, or a kiter that's currently out of its own range).
 * 'hold': stay put — already at the role's preferredRangeFt, or restrained/no movement needed.
 * 'retreat': open distance from the target — kiting roles when something hostile has closed inside preferredRangeFt.
 * Intent only, not a tile — executor.ts resolves it into actual grid steps with the same
 * findPath/greedy-walk logic runEnemyAI already used, so plan generation stays cheap (no
 * per-candidate pathfinding inside the time-boxed search) and there's one movement implementation, not two.
 */
export type MovementIntent = 'approach' | 'hold' | 'retreat';

/**
 * One candidate turn a creature could take: move with this intent, then use this action on this
 * target. `score` is unset until planEvaluator scores it; planSelector reads it once populated.
 */
export interface TacticalPlan {
  id: string;
  movement: MovementIntent;
  actionRef: PlanActionRef;
  targetId: string;
  score?: number;
}

/** Live combat state a candidate plan is generated/scored against — the subset of encounter state the AI layers need, so they don't each reach into global engine state directly. */
export interface TacticalContext {
  cid: string;
  actor: Participant;
  positions: Record<string, { gx: number; gy: number }>;
  allParticipants: Participant[];
  /** Current combat round — lets Conjurer's summon action gate on Creature.lastDamagedRound ("unchallenged for N rounds"). */
  round: number;
}
