import type { ActionResource, Character, Spell, StoredFamiliar } from "shared";
import { isWeapon, actionCostFromCastingTime, parseRangeFeet, magicInitiateKeyForSpell, resourceCurrent, invocationSpell } from "shared";
import { dispatch } from "../events.ts";

// Shared by the character sheet's Spells tab and the combat hotbar, so both cast through the
// exact same gates and dispatches.

export interface CastContext {
  character: Character;
  combatActive: boolean;
  isMyTurn: boolean;
  resources: Record<ActionResource, boolean>;
  currentSpellSlots1: number;
}

export interface SpellChoices {
  damageType?: string | undefined;
  command?: string | undefined;
  skill?: string | undefined;
  /** Find Familiar only — the FindFamiliarModal's pick. */
  familiar?: StoredFamiliar | undefined;
}

export function damageTypeOptionsFor(spell: Spell): string[] | undefined {
  return spell.combat?.onHit?.find((e) => e.damageTypeOptions?.length)?.damageTypeOptions
    ?? spell.combat?.hooks?.find((h) => h.damageTypeOptions?.length)?.damageTypeOptions;
}

export function commandOptionsFor(spell: Spell): string[] | undefined {
  return spell.combat?.commandOptions;
}

export function skillOptionsFor(spell: Spell): string[] | undefined {
  return spell.combat?.skillOptions;
}

export function hasSpellChoices(spell: Spell): boolean {
  return !!(damageTypeOptionsFor(spell) || commandOptionsFor(spell) || skillOptionsFor(spell));
}

export function defaultSpellChoices(spell: Spell): SpellChoices {
  const damageTypes = damageTypeOptionsFor(spell);
  return {
    damageType: damageTypes ? (damageTypes.includes("Thunder") ? "Thunder" : damageTypes[0]) : undefined,
    command: commandOptionsFor(spell)?.[0],
    skill: skillOptionsFor(spell)?.[0],
  };
}

// Casting times outside action/bonus/reaction (Snare/Alarm's "1 Min.", ...) cost a full
// action in this app's simplified combat model.
export function spellActionCost(spell: Spell): ActionResource {
  return actionCostFromCastingTime(spell.castingTime) ?? "action";
}

function mainHandWeaponOf(character: Character) {
  const item = character.inventory?.find((i) => i.id === character.equipment?.mainHand);
  return item && isWeapon(item) ? item : undefined;
}

// One-shot self-buffs that only matter on the weapon hit they're cast for (Divine Smite,
// Booming Blade/Green-Flame Blade, ...) — bundle cast + attack into one interaction rather than
// a separate "next hit" queue. Duration buffs like Divine Favor/Zephyr Strike stay on the old
// immediate-self-cast path below — they carry hooks now, not an onHit damage effect, so the
// damage-effect check below already excludes them without needing a duration check too.
export function isBundledSmite(spell: Spell): boolean {
  return (
    spell.combat?.resolution !== "attack" &&
    !spell.combat?.save &&
    parseRangeFeet(spell.range) === 0 &&
    !!spell.combat?.onHit?.some((e) => e.type === "damage")
  );
}

// Redirecting an already-sustained spell (Hunter's Mark, Witch Bolt) is free — no slot spent —
// so the empty-slots gate must not block it.
function isFreeRecast(character: Character, spell: Spell): boolean {
  return character.conditions?.some(
    (c) => c.name === "Concentrating" && c.concentration?.spellName === spell.name,
  ) ?? false;
}

// Only level-1 slots are tracked today, so a leveled spell is castable only while that
// pool has slots left — no higher tier exists yet to upcast into when it's empty. A Magic
// Initiate spell with its once-per-Long-Rest charge unspent needs no slot (trySpendSpellSlot),
// nor does an invocation's at-will spell (Armor of Shadows, Pact of the Chain).
function noSlotFor(ctx: CastContext, spell: Spell): boolean {
  const miKey = magicInitiateKeyForSpell(ctx.character, spell.name);
  const miCharge = !!miKey && resourceCurrent(ctx.character, miKey) > 0;
  return spell.level >= 1 && ctx.currentSpellSlots1 <= 0 && !miCharge && !isFreeRecast(ctx.character, spell) && !invocationSpell(ctx.character, spell.name);
}

export function castBlocked(ctx: CastContext, spell: Spell): boolean {
  // Exploration-castable spells (Snare) skip the action-economy gate entirely outside combat —
  // same spell slot spend, no action/turn requirement. Cast mid-fight, they're gated normally.
  // journalOnly (Ceremony) needs the same bypass since it never resolves through combat at all
  // — the server hard-blocks it separately if combat is active.
  const explorationCast = (spell.combat?.explorationCastable || spell.combat?.journalOnly) && !ctx.combatActive;
  return (
    (!explorationCast && (!ctx.combatActive || !ctx.isMyTurn || !ctx.resources[spellActionCost(spell)])) ||
    noSlotFor(ctx, spell) ||
    (isBundledSmite(spell) && (!mainHandWeaponOf(ctx.character) || !ctx.resources.action))
  );
}

export function castSpell(ctx: CastContext, spell: Spell, choices: SpellChoices) {
  if (castBlocked(ctx, spell)) return;
  const { character } = ctx;

  if (isBundledSmite(spell)) {
    dispatch("vtt:sheet:closed", {});
    dispatch("vtt:targeting:start", {
      kind: "weapon",
      // Non-null: castBlocked above already rejects a bundled smite with no main-hand weapon.
      weapon: mainHandWeaponOf(character)!,
      actionType: "action",
      bonusSpell: spell,
    });
    return;
  }

  dispatch("vtt:sheet:closed", {});

  // Nothing to pick on the map, so resolve immediately on the caster: self-range buffs/utility,
  // Armor of Shadows' self-only Mage Armor (despite its Touch range), summons (Find Familiar), and
  // any exploration cast outside combat — the canvas only targets during a fight (traps aside).
  const selfCast = parseRangeFeet(spell.range) === 0
    || invocationSpell(character, spell.name)?.selfOnly
    || spell.combat?.grantsCompanion
    || (!ctx.combatActive && spell.combat?.explorationCastable && !spell.combat.placesTrap);
  if (selfCast && !spell.combat?.area) {
    dispatch("vtt:combat:spell:cast", {
      casterName: character.name,
      casterId: character.id,
      spell,
      slotLevel: spell.level,
      targetIds: [character.id],
      chosenFamiliar: choices.familiar,
    });
    return;
  }
  dispatch("vtt:targeting:start", {
    kind: "spell",
    spell,
    casterId: character.id,
    actionType: spellActionCost(spell),
    chosenDamageType: damageTypeOptionsFor(spell) ? choices.damageType : undefined,
    chosenCommand: commandOptionsFor(spell) ? choices.command : undefined,
    chosenSkill: skillOptionsFor(spell) ? choices.skill : undefined,
    casterLevel: character.level,
  });
}
