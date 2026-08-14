import type { AttackContext } from 'shared';
import { statMod } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { getCharacter } from '../../../storage.ts';

/**
 * Replaces its owner's AC with baseValue + Dex mod instead of adding to it — Mage Armor's
 * "base AC becomes 13 + Dex", not a flat bonus (AcModifierHook covers those, Shield's +5).
 *
 * Priority 150 (higher than AcModifierHook's 100) so this sets the base *before* any additive
 * modifier stacks on top of it in the same afterAttackRoll chain — Shield cast on top of Mage
 * Armor should still add +5 to 13+Dex, not have Mage Armor clobber it back down.
 *
 * requiresUnarmored re-checks live gear every time instead of needing early teardown — the
 * moment the target equips body armor this stops applying on its own, matching "the spell ends
 * early if the target dons armor" without any extra unregister path.
 */
export class AcOverrideHook extends Hook<'afterAttackRoll'> {
  readonly stage = 'afterAttackRoll' as const;
  private readonly baseValue: number;
  private readonly requiresUnarmored: boolean;

  constructor(props: HookProps & { baseValue: number; requiresUnarmored?: boolean | undefined }) {
    super({ priority: 150, ...props });
    this.baseValue = props.baseValue;
    this.requiresUnarmored = props.requiresUnarmored ?? false;
  }

  matches(ctx: AttackContext): boolean {
    return ctx.targetId === this.ownerId;
  }

  async apply(ctx: AttackContext, engine: StateEngine): Promise<void> {
    const char = await getCharacter(engine.campaignId, this.ownerId);
    if (!char) return;
    if (this.requiresUnarmored && char.equipment?.body) return;
    ctx.ac = this.baseValue + statMod(char.stats.dex);
  }
}
