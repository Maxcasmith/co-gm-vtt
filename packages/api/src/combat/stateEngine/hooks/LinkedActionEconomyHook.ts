import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { encounters } from '../../../state.ts';

/**
 * Wardaway's "on its next turn, it can take only an action or a Bonus Action, but not both."
 * Fires once on the owner's next beforeTurn, arming Participant.linkedActionEconomy (trySpend
 * zeroes the other resource the moment either is spent) and unregistering itself — then
 * registers LinkedActionEconomyClearHook so the restriction can't bleed into a later turn if
 * the owner spends neither resource this one.
 */
export class LinkedActionEconomyHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(ctx: TurnContext, engine: StateEngine): void {
    const participant = encounters.get(engine.campaignId)?.findParticipant(this.ownerId);
    if (participant) participant.linkedActionEconomy = true;
    engine.unregister(this.id);
    engine.register(new LinkedActionEconomyClearHook({ ownerId: this.ownerId, source: this.source }));
  }
}

class LinkedActionEconomyClearHook extends Hook<'afterTurn'> {
  readonly stage = 'afterTurn' as const;

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(ctx: TurnContext, engine: StateEngine): void {
    const participant = encounters.get(engine.campaignId)?.findParticipant(this.ownerId);
    if (participant) participant.linkedActionEconomy = false;
    engine.unregister(this.id);
  }
}
