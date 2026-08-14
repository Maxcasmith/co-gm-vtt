import type { AttackContext, CreatureType } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks its owner as imposing disadvantage on attack rolls made against them by a specific set
 * of creature types (Protection from Evil and Good). Mirror of GrantAdvantageHook: the d20 is
 * already rolled by the time beforeAttackRoll's trigger() chain runs, so this isn't what applies
 * the disadvantage — the roll-call site queries StateEngine.getHooksOwnedBy directly before
 * rolling and reads creatureTypes off the matching hook(s) itself. apply() is bookkeeping only.
 */
export class AttackerDisadvantageHook extends Hook<'beforeAttackRoll'> {
  readonly stage = 'beforeAttackRoll' as const;
  readonly creatureTypes: CreatureType[];

  constructor(props: HookProps & { creatureTypes: CreatureType[] }) {
    super(props);
    this.creatureTypes = props.creatureTypes;
  }

  appliesTo(attackerType: CreatureType): boolean {
    return this.creatureTypes.includes(attackerType);
  }

  matches(ctx: AttackContext): boolean {
    return ctx.targetId === this.ownerId;
  }

  apply(): void {}
}
