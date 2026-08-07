import type { DamageContext, Scaling } from 'shared';
import { resolveSpellDamageDice } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import { rollDice } from '../../dice.ts';

/**
 * Adds extra damage whenever its owner (the caster) hits a specific marked target —
 * Hunter's Mark's 1d6 Force. Registered on the caster rather than the target, unlike
 * AcModifierHook/RecurringDamageHook, per the "self spec" owner case registerSpellHooks
 * already anticipates.
 */
export class OnHitBonusDamageHook extends Hook<'beforeDamage'> {
  readonly stage = 'beforeDamage' as const;
  private readonly markedTargetId: string;
  private readonly scaling: Scaling | undefined;
  private readonly damageType: string | undefined;
  private readonly casterLevel: number;
  private readonly slotLevel: number;

  constructor(props: HookProps & {
    markedTargetId: string;
    scaling?: Scaling | undefined;
    damageType?: string | undefined;
    casterLevel: number;
    slotLevel: number;
  }) {
    super(props);
    this.markedTargetId = props.markedTargetId;
    this.scaling = props.scaling;
    this.damageType = props.damageType;
    this.casterLevel = props.casterLevel;
    this.slotLevel = props.slotLevel;
  }

  matches(ctx: DamageContext): boolean {
    return ctx.sourceId === this.ownerId && ctx.targetId === this.markedTargetId;
  }

  apply(ctx: DamageContext): void {
    const dice = resolveSpellDamageDice(this.scaling, this.casterLevel, this.slotLevel) ?? this.scaling?.base;
    if (!dice) return;
    const bonus = rollDice(dice);
    ctx.amount += bonus;
    console.log(`[hook] ${ctx.targetName} takes +${bonus} ${this.damageType ?? ''} bonus damage from ${this.source}`.replace('  ', ' '));
  }
}
