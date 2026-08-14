import type { DamageContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Multiplies incoming damage of one type — resistance halves (rounded down, 5e RAW), vulnerability
 * doubles, immunity zeroes. Registered two ways: innate stat-block resistances get one of these per
 * entry at combat start with an endOfCombat duration (see registerStaticDamageModifiers); a spell
 * like Absorb Elements registers one with a real duration and whatever damage type triggered it.
 *
 * `spellName` swaps the gate from damage type to source spell — Shield's "you take no damage from
 * Magic Missile" isn't about Force damage in general, just that one named spell.
 *
 * ponytail: RAW says resistance+vulnerability to the same type cancel out rather than compounding,
 * and multiple resistances to the same type don't stack — this applies each matching hook in
 * sequence instead, which only coincidentally lands on the right number for the single-source case.
 * Fine until a creature has two resistance sources to the same type; worth a dedupe pass then.
 */
export class DamageResistanceHook extends Hook<'beforeDamage'> {
  readonly stage = 'beforeDamage' as const;
  private readonly damageType: string | undefined;
  private readonly spellName: string | undefined;
  private readonly mode: 'resistance' | 'vulnerability' | 'immunity';

  constructor(props: HookProps & { damageType?: string | undefined; spellName?: string | undefined; mode: 'resistance' | 'vulnerability' | 'immunity' }) {
    super(props);
    this.damageType = props.damageType;
    this.spellName = props.spellName;
    this.mode = props.mode;
  }

  matches(ctx: DamageContext): boolean {
    if (ctx.targetId !== this.ownerId) return false;
    if (this.spellName) return ctx.sourceName === this.spellName;
    return !!ctx.damageType && !!this.damageType && ctx.damageType.toLowerCase() === this.damageType.toLowerCase();
  }

  apply(ctx: DamageContext): void {
    if (this.mode === 'immunity') ctx.amount = 0;
    else if (this.mode === 'resistance') ctx.amount = Math.floor(ctx.amount / 2);
    else ctx.amount *= 2;
  }
}
