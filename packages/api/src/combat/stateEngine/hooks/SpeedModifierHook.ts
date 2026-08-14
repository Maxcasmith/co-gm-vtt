import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks its owner's speed modified — either a fraction of base (Wardaway's "Speed is halved",
 * `multiplier`) or a flat addition (Longstrider's "+10 feet", `bonusFt`, applied before the
 * multiplier). Pure bookkeeping like SanctuaryWardHook/AttackerDisadvantageHook: nothing reads
 * `apply()`, callers query it directly via StateEngine.getHooksOwnedBy at the one place speed
 * actually matters (emitTurn, when movementRemaining is (re)issued to the client).
 *
 * stage is 'beforeTurn' only so it has *a* stage to sit on — never fires meaningfully off it,
 * same as the other query-only hooks.
 */
export class SpeedModifierHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  readonly multiplier: number;
  readonly bonusFt: number;

  constructor(props: HookProps & { multiplier?: number | undefined; bonusFt?: number | undefined }) {
    super(props);
    this.multiplier = props.multiplier ?? 1;
    this.bonusFt = props.bonusFt ?? 0;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}
