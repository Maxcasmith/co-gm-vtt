import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks a HUD action available this turn beyond the normal ones — Expeditious Retreat's
 * "Dash (Bonus Action)", Jump's "Jump" — without touching what Dash itself does. Pure
 * bookkeeping like SpeedModifierHook: nothing reads `apply()`, emitTurn queries every
 * actionUnlock hook owned by the incoming actor and sends their `action` strings down as
 * `combat:turn.buffs`, which CombatDock's ACTION_UNLOCKS table turns into buttons. Generic by
 * design — a future feat just needs a new `action` string and a table entry, no new hook type.
 */
export class ActionUnlockHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  readonly action: string;

  constructor(props: HookProps & { action: string }) {
    super(props);
    this.action = props.action;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}
