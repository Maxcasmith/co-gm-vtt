import type { TurnContext, RoundContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';

/**
 * Unregisters other hooks at the start of its owner's next turn — the 5e "until the start of your
 * next turn" window. This is the cleanup job Shield queues when it is cast.
 *
 * Runs at low priority so the effects it is about to remove still apply for anything else on the
 * same stage that reads them first.
 */
export class ExpiryHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  private readonly targetHookIds: string[];

  constructor(props: HookProps & { targetHookIds: string[] }) {
    super({ priority: -100, ...props });
    this.targetHookIds = props.targetHookIds;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(_ctx: TurnContext, engine: StateEngine): void {
    for (const id of this.targetHookIds) engine.unregister(id);
    engine.unregister(this.id);
    console.log(`[hook] ${this.source} expired for ${this.ownerId}`);
  }
}

/** Same job, but keyed to an absolute round number — for fixed-length effects rather than turn-scoped ones. */
export class RoundExpiryHook extends Hook<'beforeRound'> {
  readonly stage = 'beforeRound' as const;
  private readonly targetHookIds: string[];
  private readonly expiresOnRound: number;

  constructor(props: HookProps & { targetHookIds: string[]; expiresOnRound: number }) {
    super({ priority: -100, ...props });
    this.targetHookIds = props.targetHookIds;
    this.expiresOnRound = props.expiresOnRound;
  }

  matches(ctx: RoundContext): boolean {
    return ctx.round >= this.expiresOnRound;
  }

  apply(_ctx: RoundContext, engine: StateEngine): void {
    for (const id of this.targetHookIds) engine.unregister(id);
    engine.unregister(this.id);
    console.log(`[hook] ${this.source} expired for ${this.ownerId}`);
  }
}
