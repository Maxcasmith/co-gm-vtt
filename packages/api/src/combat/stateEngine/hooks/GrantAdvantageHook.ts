import type { AttackContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { io, playerSocketIds } from '../../../state.ts';

/**
 * Marks its owner as granting advantage — normally to attacks made AGAINST them (Faerie Fire's
 * outline, Guiding Bolt's guiding light). `self:true` flips it to attacks made BY them instead
 * (Zephyr Strike's "give yourself advantage on one attack") — registered under a different kind
 * (see registerSpellHooks) so the query site knows which one it's asking about.
 *
 * The d20 is already rolled by the time beforeAttackRoll's trigger() chain runs (advantage has
 * to change *which* die gets rolled, not adjust a result after the fact), so this hook isn't
 * what grants the advantage — StateEngine.hasHookOwnedBy is checked directly before the roll in
 * combat.ts, against targetId for the normal case or attackerId for `self`. This hook's job is
 * bookkeeping: log the hit, consume itself for one-shot grants (Guiding Bolt, Zephyr Strike),
 * and — `self` only — fire the attack's tied speed bonus (Zephyr Strike's "+30ft, hit or miss")
 * straight to the owner's own socket, since movement is client-owned and this has to land
 * immediately, not wait for the owner's next emitTurn.
 */
export class GrantAdvantageHook extends Hook<'beforeAttackRoll'> {
  readonly stage = 'beforeAttackRoll' as const;
  private readonly consumeOnUse: boolean;
  private readonly self: boolean;
  private readonly speedBonusOnUseFt: number | undefined;

  constructor(props: HookProps & { consumeOnUse?: boolean | undefined; self?: boolean | undefined; speedBonusOnUseFt?: number | undefined }) {
    super(props);
    this.consumeOnUse = props.consumeOnUse ?? false;
    this.self = props.self ?? false;
    this.speedBonusOnUseFt = props.speedBonusOnUseFt;
  }

  matches(ctx: AttackContext): boolean {
    return this.self ? ctx.attackerId === this.ownerId : ctx.targetId === this.ownerId;
  }

  apply(ctx: AttackContext, engine: StateEngine): void {
    console.log(`[hook] ${ctx.attackerName} attacks ${ctx.targetName} with advantage from ${this.source}`);
    if (this.speedBonusOnUseFt) {
      const sid = playerSocketIds.get(this.ownerId);
      if (sid) io.to(sid).emit('movement:granted', { ft: this.speedBonusOnUseFt });
    }
    if (this.consumeOnUse) engine.unregister(this.id);
  }
}
