import type { TurnContext, Condition } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks its owner immune to specific conditions — Heroism's "immune to the Frightened
 * condition." Pure bookkeeping like DamageResistanceHook's immunity mode, but for conditions
 * instead of damage types: nothing reads `apply()`, applyCondition (runtime.ts) checks
 * StateEngine.getHooksOwnedBy(targetId, 'conditionImmunity') before ever adding a condition, and
 * silently no-ops if one of these lists it.
 *
 * Blanket, not conditional — Protection from Evil and Good's "immune to Charmed/Frightened from
 * [Aberrations/Celestials/...]" needs the same block gated by the source's creature type too,
 * which this doesn't do; that spell stays on its own todo for now (see its override entry).
 */
export class ConditionImmunityHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  readonly immuneConditions: Condition[];

  constructor(props: HookProps & { immuneConditions: Condition[] }) {
    super(props);
    this.immuneConditions = props.immuneConditions;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}
