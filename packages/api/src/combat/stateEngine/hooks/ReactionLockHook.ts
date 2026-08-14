import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks its owner unable to take Reactions — Arms of Hadar's "can't take Reactions until the
 * start of its next turn". Pure bookkeeping like SpeedModifierHook/SanctuaryWardHook: nothing
 * reads `apply()`, callers query it directly via StateEngine.hasHookOwnedBy at the two places a
 * reaction is ever offered (ReactionOfferHook, RetaliationOfferHook), before spending the
 * resource or prompting the player.
 */
export class ReactionLockHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;

  constructor(props: HookProps) {
    super(props);
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}
