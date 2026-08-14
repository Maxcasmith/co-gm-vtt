import type { TurnContext, RoundContext, CombatContext, Condition } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { clearCondition } from '../../runtime.ts';

/** Who to clear a bare condition marker (or markers — Tasha's Hideous Laughter's Prone+Incapacitated) off of when an expiry fires — see ConditionClear in registerSpellHooks.ts. */
export interface ConditionClear {
  ownerId: string;
  name: Condition | Condition[];
}

async function clearConditions(cid: string, spec: ConditionClear): Promise<void> {
  for (const name of Array.isArray(spec.name) ? spec.name : [spec.name]) await clearCondition(cid, spec.ownerId, name);
}

/**
 * Unregisters other hooks at the start of a turn — the 5e "until the start of your next turn"
 * window. Watches `ownerId`'s own turn by default (Shield, cast on and tracking the caster). Pass
 * `anchorId` when the effect instead needs to watch someone else's turn — a hook attached to a
 * target (for bookkeeping/clearing purposes) whose 5e text says "until the start of *your* next
 * turn" meaning the caster's turn, not the target's own (Ray of Sickness's Poisoned, Wardaway's
 * halved speed).
 *
 * `clearCondition` additionally drops a named condition marker the expiring hook applied —
 * needed because applying a condition (registerSpellHooks' recurringDamage side effect) and
 * registering the hook that tracks its lifetime are two different actions; nothing else clears
 * the marker when the hook itself has no `saveToEnd` of its own to do it early (Ray of Sickness's
 * Poisoned, which just runs out — no repeat save involved).
 *
 * Runs at low priority so the effects it is about to remove still apply for anything else on the
 * same stage that reads them first.
 */
export class ExpiryHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  private readonly anchorId: string;
  private readonly targetHookIds: string[];
  private readonly clearConditionSpec: ConditionClear | undefined;

  constructor(props: HookProps & { targetHookIds: string[]; anchorId?: string | undefined; clearCondition?: ConditionClear | undefined }) {
    super({ priority: -100, ...props });
    this.anchorId = props.anchorId ?? props.ownerId;
    this.targetHookIds = props.targetHookIds;
    this.clearConditionSpec = props.clearCondition;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.anchorId;
  }

  async apply(_ctx: TurnContext, engine: StateEngine): Promise<void> {
    for (const id of this.targetHookIds) engine.unregister(id);
    if (this.clearConditionSpec) await clearConditions(engine.campaignId, this.clearConditionSpec);
    engine.unregister(this.id);
    console.log(`[hook] ${this.source} expired for ${this.ownerId}`);
  }
}

/** Same job, but keyed to an absolute round number — for fixed-length effects rather than turn-scoped ones. */
export class RoundExpiryHook extends Hook<'beforeRound'> {
  readonly stage = 'beforeRound' as const;
  private readonly targetHookIds: string[];
  private readonly expiresOnRound: number;
  private readonly clearConditionSpec: ConditionClear | undefined;

  constructor(props: HookProps & { targetHookIds: string[]; expiresOnRound: number; clearCondition?: ConditionClear | undefined }) {
    super({ priority: -100, ...props });
    this.targetHookIds = props.targetHookIds;
    this.expiresOnRound = props.expiresOnRound;
    this.clearConditionSpec = props.clearCondition;
  }

  matches(ctx: RoundContext): boolean {
    return ctx.round >= this.expiresOnRound;
  }

  async apply(_ctx: RoundContext, engine: StateEngine): Promise<void> {
    for (const id of this.targetHookIds) engine.unregister(id);
    if (this.clearConditionSpec) await clearConditions(engine.campaignId, this.clearConditionSpec);
    engine.unregister(this.id);
    console.log(`[hook] ${this.source} expired for ${this.ownerId}`);
  }
}

/**
 * Same job again, but for HookDuration's 'gameTime' — keyed to an absolute worldTimeSecs
 * timestamp instead of a round number, since rounds don't exist outside combat. Doesn't fire
 * through the normal trigger(stage) chain (there's no "time passed" stage — game time advances
 * in arbitrary jumps, not a per-round tick); it's bookkeeping only, found and torn down by
 * sweepGameTimeExpiries (runtime.ts) whenever worldTimeSecs actually advances. Still a real
 * registered Hook (not a side registry) so unregisterBySource/concentration-breaking find it
 * exactly like every other hook a spell registers.
 */
export class GameTimeExpiryHook extends Hook<'beforeCombat'> {
  readonly stage = 'beforeCombat' as const;
  readonly expiresAtSecs: number;
  private readonly targetHookIds: string[];
  private readonly clearConditionSpec: ConditionClear | undefined;

  constructor(props: HookProps & { targetHookIds: string[]; expiresAtSecs: number; clearCondition?: ConditionClear | undefined }) {
    super({ ...props, kind: 'gameTimeExpiry' });
    this.targetHookIds = props.targetHookIds;
    this.expiresAtSecs = props.expiresAtSecs;
    this.clearConditionSpec = props.clearCondition;
  }

  /** Never fires via the normal trigger chain — beforeCombat only runs once, and this doesn't need it to. sweepGameTimeExpiries drives it directly. */
  matches(_ctx: CombatContext): boolean {
    return false;
  }

  async apply(_ctx: CombatContext, engine: StateEngine): Promise<void> {
    for (const id of this.targetHookIds) engine.unregister(id);
    if (this.clearConditionSpec) await clearConditions(engine.campaignId, this.clearConditionSpec);
    engine.unregister(this.id);
    console.log(`[hook] ${this.source} expired for ${this.ownerId} (game time)`);
  }
}
