import type { DamageContext, Scaling } from 'shared';
import { resolveSpellDamageDice } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { encounters } from '../../../state.ts';
import { rollDice } from '../../dice.ts';
import { applyDamageToCreature } from '../../runtime.ts';

/**
 * Damages whoever just hit its owner — Armor of Agathys' cold damage back at a melee attacker.
 * Automatic (no reaction spent, no player choice), unlike RetaliationOfferHook — sibling to
 * RecurringDamageHook but triggered by being hit rather than by the owner's turn starting.
 *
 * ponytail: fires on afterDamage with no melee/range gate of its own — the only path that deals
 * damage to a player is runEnemyAI's adjacency-gated attack loop (finalDist <= 1), which is
 * already melee-only by construction (see its own "isMelee: true" note), so there's nothing
 * else this could fire against. Revisit if a ranged-enemy-attack path is ever added.
 *
 * Self-unregisters once its owner's temp HP hits 0 — Armor of Agathys "ends early if you have
 * no temporary hit points". Checked after the triggering hit resolves (applyDamage* already ran
 * by afterDamage), so the hit that drains the last temp HP still retaliates; only later hits stop.
 */
export class RetaliationDamageHook extends Hook<'afterDamage'> {
  readonly stage = 'afterDamage' as const;
  private readonly scaling: Scaling | undefined;
  private readonly damageType: string | undefined;

  constructor(props: HookProps & { scaling?: Scaling | undefined; damageType?: string | undefined }) {
    super(props);
    this.scaling = props.scaling;
    this.damageType = props.damageType;
  }

  matches(ctx: DamageContext): boolean {
    return ctx.targetId === this.ownerId && ctx.amount > 0 && ctx.sourceId !== this.ownerId;
  }

  async apply(ctx: DamageContext, engine: StateEngine): Promise<void> {
    const cid = engine.campaignId;
    const dice = resolveSpellDamageDice(this.scaling, 1, 1) ?? this.scaling?.base;
    const attacker = encounters.get(cid)?.findParticipant(ctx.sourceId);
    if (dice && attacker && !attacker.isPlayer && !attacker.isDead()) {
      const amount = rollDice(dice);
      console.log(`[hook] ${attacker.name} takes ${amount} ${this.damageType ?? ''} retaliation from ${this.source}`.replace('  ', ' '));
      await applyDamageToCreature(cid, attacker.id, amount);
    }

    const owner = encounters.get(cid)?.findParticipant(this.ownerId);
    if (owner && owner.tempHp <= 0) engine.unregister(this.id);
  }
}
