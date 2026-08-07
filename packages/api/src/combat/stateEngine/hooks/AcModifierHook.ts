import type { AttackContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Adds a flat bonus to its owner's AC for every attack aimed at them while registered — Shield's
 * +5. Runs at high priority so any reaction offer evaluated in the same chain sees the AC that
 * already includes this bonus, and so does not offer a spell that is already up.
 */
export class AcModifierHook extends Hook<'afterAttackRoll'> {
  readonly stage = 'afterAttackRoll' as const;
  readonly value: number;

  constructor(props: HookProps & { value: number }) {
    super({ priority: 100, ...props });
    this.value = props.value;
  }

  matches(ctx: AttackContext): boolean {
    return ctx.targetId === this.ownerId;
  }

  apply(ctx: AttackContext): void {
    ctx.ac += this.value;
  }
}
