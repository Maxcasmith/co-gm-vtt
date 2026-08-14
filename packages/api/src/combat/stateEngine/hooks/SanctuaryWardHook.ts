import type { AttackContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks its owner warded by Sanctuary. Like AttackerDisadvantageHook/GrantAdvantageHook, the
 * real decision (does the attack even happen) has to be made before the d20 is rolled — see
 * checkSanctuary in runtime.ts, called directly by the attack-roll site. This hook only exists
 * so checkSanctuary has something to query (StateEngine.getHooksOwnedBy) and so concentration
 * breaking (unregisterBySource) has something registered to tear down. apply() is bookkeeping.
 */
export class SanctuaryWardHook extends Hook<'beforeAttackRoll'> {
  readonly stage = 'beforeAttackRoll' as const;
  readonly dc: number;

  constructor(props: HookProps & { dc: number }) {
    super(props);
    this.dc = props.dc;
  }

  matches(ctx: AttackContext): boolean {
    return ctx.targetId === this.ownerId;
  }

  apply(): void {}
}
