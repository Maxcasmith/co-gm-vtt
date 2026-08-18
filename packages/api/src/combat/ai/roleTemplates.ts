import type { EnemyAction, EnemyRole } from 'shared';
import { ENEMY_ROLES } from 'shared';
import { ROLE_CONFIGS } from './roleConfig.ts';

/**
 * Per-role authoring reference for the LLM encounter generator (session-processor/imagePrompts.ts)
 * — example EnemyAction shapes it can copy/adapt so generated stat blocks actually carry the
 * fields the tactical AI (planGenerator/planEvaluator) reads, instead of inventing a shape that
 * happens to look right but doesn't match EnemyAction's discriminated union. Melee-only roles
 * (Infantry/Brute/Cavalry/Ranged) get an empty example set — they work entirely off attacks[],
 * which the LLM already generates correctly today.
 */
export interface RoleTemplate {
  role: EnemyRole;
  description: string;
  exampleActions: EnemyAction[];
}

export const ROLE_TEMPLATES: Record<EnemyRole, RoleTemplate> = {
  Infantry: { role: 'Infantry', description: ROLE_CONFIGS.Infantry.description, exampleActions: [] },
  Brute: { role: 'Brute', description: ROLE_CONFIGS.Brute.description, exampleActions: [] },
  Cavalry: { role: 'Cavalry', description: ROLE_CONFIGS.Cavalry.description, exampleActions: [] },
  Ranged: { role: 'Ranged', description: ROLE_CONFIGS.Ranged.description, exampleActions: [] },

  Artillery: {
    role: 'Artillery',
    description: ROLE_CONFIGS.Artillery.description,
    exampleActions: [
      { id: 'artillery-aoe', kind: 'aoe', name: 'Fire Bolt Volley', range: 60, radius: 10, damage: '3d6', damageType: 'Fire', saveAbility: 'dex', saveDC: 13 },
      { id: 'artillery-debuff', kind: 'debuff', name: "Hex", range: 60, durationRounds: 3, rollPenaltyDie: 4 },
    ],
  },
  Conjurer: {
    role: 'Conjurer',
    description: ROLE_CONFIGS.Conjurer.description,
    exampleActions: [
      { id: 'conjurer-summon', kind: 'summon', name: 'Call Reinforcements', templateRole: 'Infantry', count: 2, triggerRoundsUnchallenged: 2 },
    ],
  },
  Commander: {
    role: 'Commander',
    description: ROLE_CONFIGS.Commander.description,
    exampleActions: [
      { id: 'commander-buff', kind: 'buff', name: 'Rally the Line', range: 30, durationRounds: 3, rollBonusDie: 4 },
    ],
  },
  Healer: {
    role: 'Healer',
    description: ROLE_CONFIGS.Healer.description,
    exampleActions: [
      { id: 'healer-heal', kind: 'heal', name: 'Cure Wounds', range: 30, healFormula: '2d8+3' },
      { id: 'healer-buff', kind: 'buff', name: 'Bless', range: 30, durationRounds: 3, rollBonusDie: 4 },
    ],
  },
};

/** Formats every role template into an LLM-prompt-ready block — see generateEncounterEnemies. */
export function renderRoleTemplatesForPrompt(): string {
  return ENEMY_ROLES.map(role => {
    const t = ROLE_TEMPLATES[role];
    const examples = t.exampleActions.length
      ? `\n  Example actions[]: ${JSON.stringify(t.exampleActions)}`
      : '\n  Uses attacks[] only, no actions[] needed.';
    return `- ${role}: ${t.description}${examples}`;
  }).join('\n');
}
