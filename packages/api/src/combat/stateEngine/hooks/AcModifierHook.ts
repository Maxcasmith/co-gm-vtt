import type { AttackContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { getCharacter } from '../../../storage.ts';

/**
 * Adds a flat bonus to its owner's AC for every attack aimed at them while registered — Shield's
 * +5, the Defense Fighting Style's +1. Runs at high priority so any reaction offer evaluated in
 * the same chain sees the AC that already includes this bonus, and so does not offer a spell that
 * is already up.
 *
 * requiresArmor re-checks live gear every time, same live-recheck idiom as AcOverrideHook's
 * requiresUnarmored — Defense only applies "while wearing armor."
 */
export class AcModifierHook extends Hook<'afterAttackRoll'> {
  readonly stage = 'afterAttackRoll' as const;
  readonly value: number;
  private readonly requiresArmor: boolean;

  constructor(props: HookProps & { value: number; requiresArmor?: boolean | undefined }) {
    super({ priority: 100, ...props });
    this.value = props.value;
    this.requiresArmor = props.requiresArmor ?? false;
  }

  matches(ctx: AttackContext): boolean {
    return ctx.targetId === this.ownerId;
  }

  async apply(ctx: AttackContext, engine: StateEngine): Promise<void> {
    if (this.requiresArmor) {
      const char = await getCharacter(engine.campaignId, this.ownerId);
      if (!char?.equipment?.body) return;
    }
    ctx.ac += this.value;
  }
}
