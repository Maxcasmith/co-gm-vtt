import type { MoveContext, Scaling } from 'shared';
import { resolveSpellDamageDice } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { encounters } from '../../../state.ts';
import { rollDice } from '../../dice.ts';
import { applyDamageToCreature, applyDamageToPlayer } from '../../runtime.ts';

/**
 * Damages its owner the moment they move `thresholdFt` or more in one token:move leg — Booming
 * Blade's "sheathed in booming energy... if the target willingly moves 5 feet or more... it
 * takes damage, and the spell ends" (`consumeOnUse`). Reusable beyond that for any future
 * terrain effect shaped like "damage per move" (Spike Growth-style) by registering one without
 * `consumeOnUse` and a matching thresholdFt of 0 or 5 per step.
 *
 * Fires off the `onMove` stage rather than beforeTurn/afterTurn like RecurringDamageHook — this
 * is triggered by the mover's own movement, not a turn boundary — so it needs its own class
 * rather than reusing that one.
 */
export class MovementDamageHook extends Hook<'onMove'> {
  readonly stage = 'onMove' as const;
  private readonly casterId: string;
  private readonly casterLevel: number;
  private readonly slotLevel: number;
  private readonly scaling: Scaling;
  private readonly damageType: string | undefined;
  private readonly thresholdFt: number;
  private readonly consumeOnUse: boolean;

  constructor(props: HookProps & {
    casterId: string;
    casterLevel: number;
    slotLevel: number;
    scaling: Scaling;
    damageType?: string | undefined;
    thresholdFt: number;
    consumeOnUse?: boolean | undefined;
  }) {
    super(props);
    this.casterId = props.casterId;
    this.casterLevel = props.casterLevel;
    this.slotLevel = props.slotLevel;
    this.scaling = props.scaling;
    this.damageType = props.damageType;
    this.thresholdFt = props.thresholdFt;
    this.consumeOnUse = props.consumeOnUse ?? false;
  }

  matches(ctx: MoveContext): boolean {
    return ctx.participantId === this.ownerId && ctx.distanceFt >= this.thresholdFt;
  }

  async apply(ctx: MoveContext, engine: StateEngine): Promise<void> {
    const cid = engine.campaignId;
    const participant = encounters.get(cid)?.findParticipant(this.ownerId);
    if (!participant || participant.isDead()) return;

    const dice = resolveSpellDamageDice(this.scaling, this.casterLevel, this.slotLevel) ?? this.scaling.base;
    const dmgCtx = await engine.trigger('beforeDamage', {
      sourceId: this.casterId,
      targetId: this.ownerId,
      targetName: participant.name,
      amount: rollDice(dice),
      damageType: this.damageType,
      sourceName: this.source,
    });
    if (dmgCtx.amount > 0) {
      console.log(`[hook] ${participant.name} takes ${dmgCtx.amount} ${this.damageType ?? ''} damage moving, from ${this.source}`.replace('  ', ' '));
      if (participant.isPlayer) {
        await applyDamageToPlayer(cid, participant, dmgCtx.amount, { sourceId: this.casterId });
      } else {
        await applyDamageToCreature(cid, this.ownerId, dmgCtx.amount, { sourceId: this.casterId });
      }
      await engine.trigger('afterDamage', dmgCtx);
    }

    if (this.consumeOnUse) engine.unregister(this.id);
  }
}
