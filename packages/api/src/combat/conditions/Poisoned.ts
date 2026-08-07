import { Condition, type RollType } from './Condition.ts';

export class Poisoned extends Condition {
  readonly name = 'Poisoned' as const;
  readonly description = 'Disadvantage on attack rolls and ability checks.';

  override effect(rollType: RollType): -1 | 0 | 1 {
    return rollType === 'attack' || rollType === 'check' ? -1 : 0;
  }
}
