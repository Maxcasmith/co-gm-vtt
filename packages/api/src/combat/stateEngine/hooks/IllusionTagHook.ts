import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks its owner as concealing something behind an illusion — Disguise Self's changed
 * appearance — without any visual/token change (deliberately: no appearance-representation
 * system exists, this is purely an internal flag). `dc` is the caster's spell save DC, frozen at
 * cast time same as any other spell DC; investigateIllusion (runtime.ts) rolls an Investigation
 * check against it on demand rather than this hook doing anything on its own. Pure bookkeeping
 * like ConditionImmunityHook: nothing reads `apply()`.
 *
 * Reusable beyond Disguise Self for any future "there's a hidden truth here, gated by an
 * Investigation check against a DC" spell — Distort Value wants the identical shape but tags an
 * *item*, not a creature, so it can't hang off this (no item-scoped hook slot exists); it stays
 * blocked on item value tracking existing at all, see that spell's own todo.
 */
export class IllusionTagHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  readonly tagName: string;
  readonly dc: number;

  constructor(props: HookProps & { tagName: string; dc: number }) {
    super(props);
    this.tagName = props.tagName;
    this.dc = props.dc;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}
