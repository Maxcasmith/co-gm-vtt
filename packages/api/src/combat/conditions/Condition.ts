import type { AbilityKey, Condition as ConditionName } from 'shared';

export type RollType = 'attack' | 'check' | 'save';

/**
 * One D&D condition's mechanical effect. Resolved *before* a d20 is rolled (see rollModeFor) —
 * unlike the combat StateEngine's Hooks, which mutate context after a roll already happened.
 */
export abstract class Condition {
  abstract readonly name: ConditionName;
  abstract readonly description: string;

  /** -1 disadvantage, 0 no effect, 1 advantage, for the given roll. */
  effect(_rollType: RollType, _ability?: AbilityKey): -1 | 0 | 1 {
    return 0;
  }
}
