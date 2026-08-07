import type { TurnContext, Scaling } from 'shared';
import { resolveSpellDamageDice } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { encounters } from '../../../state.ts';
import { rollDice } from '../../dice.ts';
import { applyDamageToCreature, applyDamageToPlayer } from '../../runtime.ts';

/**
 * Damages its owner at the start of each of their turns — Tasha's Caustic Brew's 2d4 acid while
 * covered, and any other damage-over-time effect.
 *
 * Routes through the beforeDamage/afterDamage stages rather than dealing damage directly, so
 * resistances and absorption compose with recurring damage the same way they do with a weapon hit.
 */
export class RecurringDamageHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  private readonly casterId: string;
  private readonly casterLevel: number;
  private readonly slotLevel: number;
  private readonly scaling: Scaling | undefined;
  private readonly damageType: string | undefined;

  constructor(props: HookProps & {
    casterId: string;
    casterLevel: number;
    slotLevel: number;
    scaling?: Scaling | undefined;
    damageType?: string | undefined;
  }) {
    super(props);
    this.casterId = props.casterId;
    this.casterLevel = props.casterLevel;
    this.slotLevel = props.slotLevel;
    this.scaling = props.scaling;
    this.damageType = props.damageType;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  async apply(_ctx: TurnContext, engine: StateEngine): Promise<void> {
    const cid = engine.campaignId;
    const participant = encounters.get(cid)?.findParticipant(this.ownerId);
    if (!participant || participant.isDead()) return;

    const dice = resolveSpellDamageDice(this.scaling, this.casterLevel, this.slotLevel) ?? this.scaling?.base;
    if (!dice) return;

    const dmgCtx = await engine.trigger('beforeDamage', {
      sourceId: this.casterId,
      targetId: this.ownerId,
      targetName: participant.name,
      amount: rollDice(dice),
      damageType: this.damageType,
      sourceName: this.source,
    });
    if (dmgCtx.amount <= 0) return;

    console.log(`[hook] ${participant.name} takes ${dmgCtx.amount} ${this.damageType ?? ''} damage from ${this.source}`.replace('  ', ' '));

    if (participant.isPlayer) {
      await applyDamageToPlayer(cid, participant, dmgCtx.amount, { sourceId: this.casterId });
    } else {
      await applyDamageToCreature(cid, this.ownerId, dmgCtx.amount);
    }

    await engine.trigger('afterDamage', dmgCtx);
  }
}
