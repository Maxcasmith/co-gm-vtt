import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';

/**
 * A flat bonus to its owner's OWN spell save DC while registered — Innate Sorcery's +1. Every
 * DC in this app is computed inline at each cast site (`8 + proficiencyBonus + abilityMod`)
 * rather than flowing through a HookStage context, so this is query-only bookkeeping like
 * RollModifierHook/SpeedModifierHook: nothing reads `apply()`, callers add
 * dcBonusFor(engine, casterId) to their own `8 + ...` sum instead.
 *
 * stage is 'beforeTurn' only so it has *a* stage to sit on, same reason RollModifierHook does.
 */
export class DcModifierHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  readonly value: number;

  constructor(props: HookProps & { value: number }) {
    super(props);
    this.value = props.value;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}

export function dcBonusFor(engine: StateEngine, casterId: string): number {
  return (engine.getHooksOwnedBy(casterId, 'dcModifier') as DcModifierHook[]).reduce((sum, h) => sum + h.value, 0);
}
