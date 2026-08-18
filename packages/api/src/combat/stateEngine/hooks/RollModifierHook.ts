import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks its owner adding (Bless) or subtracting (Bane) a die, rerolled fresh every time, to
 * every attack roll and saving throw they make until the spell ends — RAW's "whenever a target
 * makes an attack roll or a saving throw before the spell ends." Pure bookkeeping like
 * SpeedModifierHook: nothing reads `apply()`, callers query it directly via
 * StateEngine.getHooksOwnedBy at every place a d20 gets rolled for an attack or a save
 * (combat:attack, combat:spell:attack, rollSavingThrow) and roll `1d{dieSize}` fresh each time,
 * signed by `sign` — never once at cast time, since the die is randomized per-roll, not fixed
 * for the whole duration.
 *
 * Blade Ward registers the identical class under kind 'rollModifierVsAttacker' instead (see
 * registerSpellHooks' rollModifier case) — same die-and-sign shape, but read the other direction:
 * bladeWardPenalty (combat/runtime.ts) looks it up on the DEFENDER and subtracts from whoever is
 * attacking them, instead of getHooksOwnedBy(attackerId, 'rollModifier') reading the roller's own.
 *
 * Guidance registers it a third way, under kind 'rollModifierCheck' with `skill` set to the
 * caster's cast-time pick — queried by roll:check (socketHandlers/rolls.ts), filtered to hooks
 * whose `skill` matches the one being rolled, since Guidance only bonuses ONE named skill's
 * checks rather than every attack/save the way Bless/Bane do.
 *
 * stage is 'beforeTurn' only so it has *a* stage to sit on — never fires meaningfully off it,
 * same as the other query-only hooks.
 */
export class RollModifierHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  readonly dieSize: number;
  readonly sign: 1 | -1;
  readonly skill: string | undefined;

  constructor(props: HookProps & { dieSize: number; sign: 1 | -1; skill?: string | undefined }) {
    super(props);
    this.dieSize = props.dieSize;
    this.sign = props.sign;
    this.skill = props.skill;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}
