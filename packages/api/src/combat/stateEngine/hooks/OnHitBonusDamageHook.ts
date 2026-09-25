import type { DamageContext, Scaling } from 'shared';
import { resolveSpellDamageDice } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { rollDice } from '../../dice.ts';

/**
 * Adds extra damage whenever its owner (the caster) lands a hit — Hunter's Mark's 1d6 Force
 * (locked to `markedTargetId`, its only target) or Divine Favor's 1d4 Radiant (no
 * markedTargetId — every weapon hit for the buff's duration, regardless of target). Registered
 * on the caster rather than the target, unlike AcModifierHook/RecurringDamageHook, per the
 * "self spec" owner case registerSpellHooks already anticipates.
 *
 * `consumeOnUse` (Zephyr Strike's one-shot 1d8) unregisters after the first hit it boosts,
 * same idea as GrantAdvantageHook's.
 */
export class OnHitBonusDamageHook extends Hook<'beforeDamage'> {
  readonly stage = 'beforeDamage' as const;
  private readonly markedTargetId: string | undefined;
  private readonly scaling: Scaling | undefined;
  private readonly damageType: string | undefined;
  private readonly casterLevel: number;
  private readonly slotLevel: number;
  private readonly consumeOnUse: boolean;
  private readonly requiresOneHandedMeleeNoOffhand: boolean;
  private readonly requiresSneakAttackConditions: boolean;

  constructor(props: HookProps & {
    markedTargetId?: string | undefined;
    scaling?: Scaling | undefined;
    damageType?: string | undefined;
    casterLevel: number;
    slotLevel: number;
    consumeOnUse?: boolean | undefined;
    /** Dueling Fighting Style: only fires on a Melee weapon hit made one-handed, with no other weapon equipped. */
    requiresOneHandedMeleeNoOffhand?: boolean | undefined;
    /**
     * Sneak Attack (2024 PHB): fires only on a Finesse/Ranged weapon hit that either had
     * Advantage, or had a non-Incapacitated ally within 5ft of the target while the attacker
     * didn't have Disadvantage.
     */
    requiresSneakAttackConditions?: boolean | undefined;
  }) {
    super(props);
    this.markedTargetId = props.markedTargetId;
    this.scaling = props.scaling;
    this.damageType = props.damageType;
    this.casterLevel = props.casterLevel;
    this.slotLevel = props.slotLevel;
    this.consumeOnUse = props.consumeOnUse ?? false;
    this.requiresOneHandedMeleeNoOffhand = props.requiresOneHandedMeleeNoOffhand ?? false;
    this.requiresSneakAttackConditions = props.requiresSneakAttackConditions ?? false;
  }

  matches(ctx: DamageContext): boolean {
    if (ctx.sourceId !== this.ownerId) return false;
    if (this.markedTargetId !== undefined && ctx.targetId !== this.markedTargetId) return false;
    if (this.requiresOneHandedMeleeNoOffhand && !(ctx.isMelee && !ctx.weaponTwoHanded && !ctx.hasOffhandWeapon)) return false;
    if (this.requiresSneakAttackConditions) {
      if (!ctx.isFinesseOrRangedWeapon) return false;
      const hadAdvantage = ctx.attackRollMode === 'advantage';
      const allyHelped = !!ctx.allyAdjacentToTargetNotIncapacitated && ctx.attackRollMode !== 'disadvantage';
      if (!hadAdvantage && !allyHelped) return false;
    }
    return true;
  }

  apply(ctx: DamageContext, engine: StateEngine): void {
    const dice = resolveSpellDamageDice(this.scaling, this.casterLevel, this.slotLevel) ?? this.scaling?.base;
    if (!dice) return;
    const bonus = rollDice(dice);
    ctx.amount += bonus;
    ctx.bonusSources = [...(ctx.bonusSources ?? []), { sourceName: this.source, amount: bonus, damageType: this.damageType }];
    console.log(`[hook] ${ctx.targetName} takes +${bonus} ${this.damageType ?? ''} bonus damage from ${this.source}`.replace('  ', ' '));
    if (this.consumeOnUse) engine.unregister(this.id);
  }
}
