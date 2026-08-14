import { Condition, type RollType } from './Condition.ts';
import type { AbilityKey } from 'shared';

/**
 * Speed 0 is enforced separately (see canMove/token:move and runEnemyAI's maxSteps) since it's
 * not a roll effect. The "attack rolls against you have Advantage" half lives in
 * attackModeAgainstTarget, not here — this class only covers Restrained's effect on the
 * restrained creature's OWN rolls.
 */
export class Restrained extends Condition {
  readonly name = 'Restrained' as const;
  readonly description = 'Speed 0. Disadvantage on attack rolls and Dexterity saving throws. Attack rolls against you have advantage.';

  override effect(rollType: RollType, ability?: AbilityKey): -1 | 0 | 1 {
    if (rollType === 'attack') return -1;
    if (rollType === 'save' && ability === 'dex') return -1;
    return 0;
  }
}
