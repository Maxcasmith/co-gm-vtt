import type { EnemyRole } from 'shared';

/**
 * How a role picks its preferred target among legal candidates — read by planGenerator
 * when it seeds/orders candidate plans, not a hard filter (a role can still fall back to
 * whatever's actually reachable).
 *
 * - nearestEnemy: closest opposing-team participant (the old runEnemyAI default).
 * - lowestHpAlly: own team's most-wounded living member — heal/buff targeting.
 * - isolatedEnemy: opposing participant furthest from their own allies — Cavalry running
 *   down stragglers instead of piling into the party's front line.
 * - squishiestEnemy: opposing participant with the lowest max HP — backline casters
 *   picking off the party's fragile members rather than whoever's nearest.
 * - selfOrAlly: Commander's own kit — buff/direct allies before swinging itself.
 */
export type TargetPriority = 'nearestEnemy' | 'lowestHpAlly' | 'isolatedEnemy' | 'squishiestEnemy' | 'selfOrAlly';

export interface RoleConfig {
  role: EnemyRole;
  /** Feet. 5 = wants to be adjacent (melee). Higher = tries to hold this distance from its target. */
  preferredRangeFt: number;
  targetPriority: TargetPriority;
  /** Won't pick a melee attacks[] swing unless nothing else in its actions[] is legal this turn. */
  avoidMeleeUnlessNoOption: boolean;
  /** Backline roles: planGenerator should weight movement plans that open distance when a hostile closes inside preferredRangeFt. */
  kitesWhenApproached: boolean;
  /** Short behavior blurb reused verbatim in the LLM encounter-generation prompt (see roleTemplates.ts). */
  description: string;
}

export const ROLE_CONFIGS: Record<EnemyRole, RoleConfig> = {
  Infantry: {
    role: 'Infantry',
    preferredRangeFt: 5,
    targetPriority: 'nearestEnemy',
    avoidMeleeUnlessNoOption: false,
    kitesWhenApproached: false,
    description: 'Basic melee cannon fodder. Comes in numbers — weak alone, dangerous in a group. Always attacks the nearest enemy.',
  },
  Brute: {
    role: 'Brute',
    preferredRangeFt: 5,
    targetPriority: 'nearestEnemy',
    avoidMeleeUnlessNoOption: false,
    kitesWhenApproached: false,
    description: 'Rare, tanky, slow. Walks straight at the nearest enemy and trades blows head-on.',
  },
  Cavalry: {
    role: 'Cavalry',
    preferredRangeFt: 5,
    targetPriority: 'isolatedEnemy',
    avoidMeleeUnlessNoOption: false,
    kitesWhenApproached: false,
    description: 'Fast melee that runs down whichever enemy is furthest from their allies and pins them there.',
  },
  Artillery: {
    role: 'Artillery',
    preferredRangeFt: 30,
    targetPriority: 'squishiestEnemy',
    avoidMeleeUnlessNoOption: true,
    kitesWhenApproached: true,
    description: 'Spellcaster built around AoEs, debuffs, and offensive spells. Fragile — holds range and backs away from melee.',
  },
  Conjurer: {
    role: 'Conjurer',
    preferredRangeFt: 30,
    targetPriority: 'squishiestEnemy',
    avoidMeleeUnlessNoOption: true,
    kitesWhenApproached: true,
    description: "Keeps its side's action economy up by summoning reinforcements if left unchallenged for too long.",
  },
  Commander: {
    role: 'Commander',
    preferredRangeFt: 5,
    targetPriority: 'selfOrAlly',
    avoidMeleeUnlessNoOption: false,
    kitesWhenApproached: false,
    description: 'One per encounter, boss/mini-boss. Carries a kit blending other roles — buffs and directs allies, still fights at full strength itself.',
  },
  Healer: {
    role: 'Healer',
    preferredRangeFt: 30,
    targetPriority: 'lowestHpAlly',
    avoidMeleeUnlessNoOption: true,
    kitesWhenApproached: true,
    description: "Weak in a fight. Stays back healing and buffing allies — only swings in melee as a last resort.",
  },
  Ranged: {
    role: 'Ranged',
    preferredRangeFt: 60,
    targetPriority: 'nearestEnemy',
    avoidMeleeUnlessNoOption: true,
    kitesWhenApproached: true,
    description: 'Holds distance. Modest per-hit damage, but chips away every turn if nobody closes the gap.',
  },
};
