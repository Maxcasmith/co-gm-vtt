import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Shillelagh — while active, its owner's melee weapon attacks use their spellcasting ability
 * modifier instead of Strength/Dexterity for both the attack and damage rolls, and (if
 * `damageDie` is set) the weapon's own damage die is replaced with this level-scaled one instead
 * of Shillelagh's real d8→d10→d12→2d6 progression, resolved once at cast time same as any other
 * frozen-at-cast value (dc, casterAbilityMod). Pure bookkeeping like RollModifierHook: nothing
 * reads `apply()`, combat:attack queries it directly via getHooksOwnedBy before computing its own
 * stat bonus.
 *
 * ponytail: doesn't validate the equipped weapon is actually a Club/Quarterstaff (RAW's
 * restriction), and doesn't offer the Force-or-weapon's-normal-type damage choice — always keeps
 * the weapon's own damage type. Same trust-the-player model movementRemaining already uses.
 */
export class WeaponAttackOverrideHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  readonly damageDie: string | undefined;

  constructor(props: HookProps & { damageDie?: string | undefined }) {
    super(props);
    this.damageDie = props.damageDie;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}
