import type { AbilityKey } from "./character.ts";
import type { CreatureType, EnemyStatBlock } from "./combat.ts";
import type { HookDuration, ReactionTrigger } from "./combat-hooks.ts";
import type { Condition } from "./conditions.ts";

// One tier of a scaling progression, e.g. { atLevel: 5, value: '2d10' }
export interface ScalingTier {
  atLevel: number;
  value: string;
}

// 'cantrip' scales with character level (5/11/17); 'spell-slot' scales with the slot level cast
// at; 'ability-mod' ignores base/tiers entirely and resolves to the caster's spellcasting
// ability modifier instead (Heroism's temp HP "equal to your spellcasting ability modifier") —
// formatted as "1d1+N" (same flat-value idiom Armor of Agathys already uses for a fixed number)
// so it still flows through the ordinary dice-string pipeline (resolveSpellDamageDice/rollDice)
// unmodified everywhere else. 'cantrip-plus-ability-mod' stacks the two: base/tiers pick a
// cantrip-scaled dice string same as 'cantrip' (empty base below the first tier is valid — no
// dice at all yet), and the caster's ability modifier is always added on top (Green-Flame
// Blade's splash: flat mod alone below level 5, mod+1d8 at 5, etc).
export interface Scaling {
  mode: "cantrip" | "spell-slot" | "ability-mod" | "cantrip-plus-ability-mod";
  base: string;
  tiers: ScalingTier[];
}

export interface EffectSpec {
  type: "damage" | "condition" | "push" | "pull" | "heal" | "tempHp";
  damageType?: string; // Fire, Acid, Force, ... — the default/fallback when damageTypeOptions is set
  /** Caster picks one at cast time (Chromatic Orb, Chaos Bolt) — damageType above is the default. */
  damageTypeOptions?: string[];
  scaling?: Scaling; // present for damage/heal/tempHp effects
  condition?: Condition;
  duration?: {
    value: number;
    unit: "round" | "minute" | "hour" | "until-save" | "instant";
  };
  distance?: number; // feet, present for push/pull effects
  /** Pull only (Lightning Lure): a sibling 'damage' effect on the same onHit only lands if the pull actually ends the target within this many feet of the caster — checked as a dry run before the real move happens. */
  requireEndWithinFt?: number;
  // Gates this effect to targets matching the condition — e.g. Divine Smite's +1d8 vs
  // Fiend/Undead is a second onHit damage effect with appliesIf.creatureType: ['Fiend','Undead'].
  // Omitted entirely = applies to any target.
  appliesIf?: { creatureType?: CreatureType[] };
  /**
   * Only applies if the target fails a save — for bundled weapon-hit smites where the damage
   * lands unconditionally but a secondary effect doesn't (Thunderous Smite's push+Prone land
   * only on a failed STR save; the 2d6 Thunder damage next to it has no gate at all).
   * Unset/false = always applies, same as before this field existed.
   */
  gatedBySave?: boolean;
}

/**
 * The hook behaviours a spell can declare in data. Kept deliberately small — a new type is
 * only worth adding when no existing one covers the spell, the same discipline EffectSpec
 * follows. 'acModifier' is Shield's +5; 'recurringDamage' is Tasha's Caustic Brew's 2d4 at
 * the start of each affected creature's turn; 'onHitBonusDamage' is Hunter's Mark's extra
 * 1d6 whenever its caster (the owner) hits the marked target; 'damageResistance' is Absorb
 * Elements' resistance to the triggering type (also how innate stat-block resistances register);
 * 'acOverride' is Mage Armor's replace-the-base-formula (13 + Dex), not an additive bonus —
 * see AcOverrideHook for why that has to be a different hook from acModifier. 'retaliateDamage'
 * is Armor of Agathys' automatic (no reaction spent) damage back at whoever hits its owner —
 * sibling to recurringDamage but triggered by being hit rather than by turn start.
 * 'attackerDisadvantage' is Protection from Evil and Good's disadvantage imposed on the listed
 * creature types when they attack the warded owner — the inverse shape of grantAdvantage.
 * 'sanctuaryWard' is Sanctuary's ward — no value of its own, the DC comes from ctx.dc (the
 * caster's spell save DC, computed once at cast time, same pattern recurringDamage's saveToEnd
 * uses) since a plain-hooks spell never otherwise needs a DC. 'speedModifier' is Wardaway's
 * halved speed — a multiplier read at turn-start (see emitTurn), not enforced against actual
 * movement distance since nothing server-side is today (see Participant's action-economy note).
 * 'linkedActionEconomy' is Wardaway's "action or bonus action, not both" — arms itself on the
 * owner's next beforeTurn and disarms on that same turn's afterTurn regardless of whether it
 * fired, so `duration` is always 'endOfCombat' (self-managed, no generic expiry needed).
 */
export type HookType = "acModifier" | "recurringDamage" | "onHitBonusDamage" | "grantAdvantage" | "damageResistance" | "acOverride" | "retaliateDamage" | "attackerDisadvantage" | "sanctuaryWard" | "speedModifier" | "linkedActionEconomy" | "reactionLock" | "actionUnlock" | "rollModifier" | "conditionImmunity" | "illusionTag" | "movementDamage";

/**
 * A hook declared by a spell, instantiated into a live Hook class by the engine's factory
 * when the spell is cast. Expiry hooks are not declarable here — the engine derives those
 * from `duration`.
 */
export interface HookSpec {
  type: HookType;
  /**
   * Which stage this fires on is a property of the hook class, not the data — and which
   * participant it attaches to is decided by the casting path (the caster for a reaction,
   * each failed-save target for an area effect). Neither is declared here.
   */
  duration: HookDuration;
  /** Higher runs first. Modifiers should outrank reaction offers so an offer sees the final value. */
  priority?: number;
  value?: number; // acModifier: the AC bonus
  scaling?: Scaling; // recurringDamage/onHitBonusDamage: dice, upcast-aware
  damageType?: string; // recurringDamage/onHitBonusDamage/damageResistance: Fire, Acid, Force, ...
  /** damageResistance only — which way the multiplier goes. */
  resistanceMode?: "resistance" | "vulnerability" | "immunity";
  /** damageResistance only — gate by the damage's source spell instead of its type (Shield's "no damage from Magic Missile"). Takes priority over damageType when both would be set. */
  spellName?: string;
  /** acOverride only — the flat part of the replacement formula (13 for Mage Armor); + Dex mod is added live. */
  baseValue?: number;
  /** acOverride only — self-disables (rather than needing early teardown) the moment the target has body armor equipped. */
  requiresUnarmored?: boolean;
  /** recurringDamage only — named condition to apply while this hook is registered, cleared when it ends (Searing Smite's Burning). For more than one at once (Tasha's Hideous Laughter's Prone+Incapacitated), use conditionNames instead. */
  conditionName?: Condition;
  /** recurringDamage only — same as conditionName but for applying/clearing several conditions together as one unit, sharing the same expiry/saveToEnd roll (Tasha's Hideous Laughter). */
  conditionNames?: Condition[];
  /** recurringDamage only — grants temp HP each tick instead of/alongside a damage tick (Heroism's "temp HP at the start of each of its turns"). Same scaling shape as `scaling`, just applied as healing. */
  tempHpScaling?: Scaling;
  /** recurringDamage only — unregisters (and clears any tracked condition) the moment this hook's own caster deals its owner damage, in addition to its normal duration (Animal Friendship/Charm Person's "ends if you damage it" — allies aren't tracked, only the caster). */
  endsIfCasterDamages?: boolean;
  /** recurringDamage only — rerolled at the same time as the tick; a success unregisters the hook (and clears the tracked condition(s)) instead of just skipping that tick's damage. */
  saveToEnd?: { ability: AbilityKey };
  /** recurringDamage only — player-initiated escape (spend an action, roll this skill vs the hook's own dc) instead of an automatic per-turn save (Ensnaring Strike/Entangle's Strength (Athletics) check, as opposed to saveToEnd's Searing Smite-style reroll). Skill name must be a key of SKILL_ABILITY. */
  escapeSkillCheck?: string;
  /** recurringDamage only — 'afterTurn' for RAW's "repeats the save at the end of each of its turns" (Cause Fear, Wrathful Smite's Frightened) instead of the usual start-of-turn tick. Defaults to 'beforeTurn'. */
  recurringStage?: "beforeTurn" | "afterTurn";
  /** attackerDisadvantage only — which creature types get the disadvantage imposed on them (Protection from Evil and Good). */
  creatureTypes?: CreatureType[];
  /** Same meaning as EffectSpec.gatedBySave — this hook only registers if the triggering save was failed (Searing Smite's Burning starts only if the weapon-hit STR/CON save is failed). */
  gatedBySave?: boolean;
  /** grantAdvantage/onHitBonusDamage only — unregisters itself after firing once (Guiding Bolt's single next attack, Zephyr Strike's one-shot bonus damage) instead of lasting the full duration (Faerie Fire's whole concentration, Divine Favor's every hit). */
  consumeOnUse?: boolean;
  /** speedModifier only — fraction of base speed available (0.5 = halved). Omit for a pure-bonusFt modifier (Longstrider). */
  multiplier?: number;
  /** speedModifier only — flat feet added to base speed before multiplier (Longstrider's +10). */
  bonusFt?: number;
  /**
   * grantAdvantage only — false (default) grants advantage to attacks made AGAINST the hook's
   * owner (Faerie Fire's outline, Guiding Bolt's guiding light). true flips it: advantage on
   * attacks made BY the owner (Zephyr Strike's "give yourself advantage on one attack") — a
   * different query site (combat.ts checks the attacker's own hooks, not the target's), so it's
   * registered under a different kind ('grantAdvantageSelf') to keep the two lookups apart.
   */
  self?: boolean;
  /** grantAdvantage only, self:true — flips it to disadvantage instead (Frostbite's "disadvantage on the next weapon attack it makes"). Registers under kind 'grantDisadvantageSelf' rather than 'grantAdvantageSelf'. */
  disadvantage?: boolean;
  /** grantAdvantage only, self:true — feet of speed granted immediately (not through the normal per-turn speedModifier query) the moment the hook fires, hit or miss (Zephyr Strike's +30ft on that attack). Sent straight to the owner's own socket since movement is client-owned. */
  speedBonusOnUseFt?: number;
  /** actionUnlock only — which HUD action this makes available this turn (Expeditious Retreat's 'dash-bonus', Jump's 'jump') — see ACTION_UNLOCKS in CombatDock.tsx for what each one costs/grants. */
  action?: string;
  /** rollModifier only — the die added to (Bless) or subtracted from (Bane) every attack roll/save, rerolled fresh each time. 4 for both spells' 1d4. */
  dieSize?: number;
  /** rollModifier only — 1 to add (Bless), -1 to subtract (Bane). */
  sign?: 1 | -1;
  /** conditionImmunity only — condition(s) this hook's owner can't be given while it's registered (Heroism's Frightened immunity) — checked by applyCondition (runtime.ts), which silently no-ops instead of applying a listed condition. */
  immuneConditions?: Condition[];
  /** illusionTag only — label for what's being concealed (Disguise Self's "Disguised"), shown back to whoever successfully investigates it. The DC itself is always the caster's own spell save DC (ctx.dc), not authored here. */
  illusionTagName?: string;
  /** movementDamage only — how many feet the owner has to move in one leg before this fires (Booming Blade's 5ft). Reuses `scaling`/`damageType` from the damage effect fields above. */
  thresholdFt?: number;
  /** reactionLock only — narrows the block to Opportunity Attacks specifically (Shocking Grasp) instead of every reaction (Arms of Hadar's full block). */
  opportunityOnly?: boolean;
  /**
   * Same meaning and shape as EffectSpec.appliesIf — gates the whole spec (hook AND any
   * conditionName it applies) to targets of a matching creature type, checked once against
   * the actual target at registration time. Reuses Divine Smite's allow-list shape rather than
   * adding exclude-list semantics: Cause Fear's "immune if Construct or Undead" is authored as
   * an explicit allow-list of the other 12 types, same as Protection from Evil and Good's list.
   * Omitted entirely = applies to any target, same as EffectSpec's.
   */
  appliesIf?: { creatureType?: CreatureType[] };
}

export interface SpellCombatMeta {
  /** No attack roll or save — the target is affected automatically (Hunter's Mark, Hex). */
  autoHit?: boolean;
  resolution: "attack" | "save" | "auto" | "none";
  attackType?: "melee" | "ranged"; // when resolution === 'attack'
  save?: { ability: AbilityKey; halfOnSave: boolean }; // when resolution === 'save'
  area?: {
    shape: "sphere" | "cone" | "cube" | "line" | "cylinder" | "emanation";
    size: number;
    width?: number;
    origin: "point" | "self";
  };
  /**
   * Places a hidden trap on the battlefield at the targeted cell instead of resolving against
   * creatures now (Snare) — `save`/`onHit` describe what fires when something steps on it later,
   * via the same trap-trigger path dungeon-authored traps use (see checkTrapAt).
   */
  placesTrap?: boolean;
  /**
   * placesTrap only — how far (feet, Chebyshev/cell distance) from the placed cell something can
   * step before triggering it (Alarm's 20-ft cube). Omitted = single exact-cell trigger, same as
   * a pressure-plate trap (Snare).
   */
  trapRadiusFt?: number;
  /**
   * Blocks this spell from being cast at all while combat is active (Ceremony) — no mechanical
   * resolution ever happens, it just spends the slot and posts a journal/chat entry. Implies
   * explorationCastable's action-economy bypass; a spell doesn't need both flags set.
   */
  journalOnly?: boolean;
  /**
   * Castable outside combat (Snare) — same spell slot spend, but skips the action-economy gate
   * entirely (no action cost, no turn requirement) since there's no turn structure to spend
   * against during exploration. Cast mid-combat, the spell falls through to the normal
   * action-gated path instead — this only changes behavior when nothing's fighting.
   */
  explorationCastable?: boolean;
  // Discrete non-AoE multi-target casts — click one creature per target during targeting until
  // the max is reached (Magic Missile's darts, Bless/Aid's "up to three creatures"). Both
  // default to 1 (ordinary single-target spell) when omitted.
  targetsMin?: number;
  targetsMax?: number;
  /** +1 to targetsMax per slot level cast above the spell's own level (Magic Missile's extra dart per upcast). */
  targetsScaleWithSlot?: boolean;
  /** targetsMax grows with character level instead of slot level (Eldritch Blast's extra beam at 5/11/17) — cantrips have no slot to upcast into, so this is the cantrip-scaling equivalent of targetsScaleWithSlot. */
  targetsScaleWithCantripLevel?: boolean;
  onHit?: EffectSpec[];
  onSave?: EffectSpec[];
  /** Persistent effects this spell registers with the StateEngine when cast. */
  hooks?: HookSpec[];
  /** Ring color pulsing on the caster while this self-buff is armed (see pendingWeaponBonuses). */
  auraColor?: string;
  /** Burst color played on the target when the armed buff's weapon hit lands. */
  impactColor?: string;
  /** Visual variant for the aura — omit for the default crackling-ring look. */
  auraStyle?: 'fire';
  /** Visual variant for the impact burst — omit for the default starburst look. */
  impactStyle?: 'fire';
  /**
   * Present on reaction-cast spells (castingTime 'Reaction', see actionCostFromCastingTime).
   * Tells the engine what mid-resolution event should offer this spell to its owner.
   */
  reactionTrigger?: ReactionTrigger;
  /** GM/engine-only note that this spell's mechanics are partial — what's missing and why, not player-facing. */
  todo?: string;
  /** Drops N copies of a Consumable straight into the caster's inventory on cast (Goodberry's ten berries) — no attack/save/hook involved. */
  grantsItem?: { name: string; quantity: number; description: string; effect: string; actionCost: "action" | "bonusAction" };
  /**
   * Every other living creature within this many feet of the resolved target also rolls the
   * same save against the same gated damage effects (Hail of Thorns' "target and each creature
   * within 5ft", Ice Knife's Cold burst). Read differently depending on `resolution`: for a
   * bundled weapon-hit spell it gates `onHit`'s `gatedBySave` damage effects; for an
   * attack-resolution spell it applies to `onSave`'s effects instead, independent of whether the
   * attack roll itself hit.
   */
  splashRadiusFt?: number;
  /**
   * Green-Flame Blade's splash: a single nearest enemy within splashRadiusFt of the hit target
   * takes this flat damage automatically, no save involved — distinct from the Hail-of-Thorns
   * save-based splash above (splashRadiusFt + gatedBySave onHit effects). Only meaningful when
   * `resolution` is 'none' (the bundled weapon-hit path); a spell should set either this or the
   * save-based splash, not both.
   */
  splashOnHit?: EffectSpec[];
  /**
   * Summons a companion creature on cast (Find Familiar, Unseen Servant) — joins the caster's
   * side via the same persistent party-ally pipeline a recruited NPC uses (party_join effect):
   * its own Creature/Participant, its own rolled initiative and turn-order slot if combat is
   * active, HP/AC/attacks all real. Reuses that system's existing lifecycle wholesale — no
   * separate dismiss/expiry flow, same as any other party ally today.
   */
  grantsCompanion?: Omit<EnemyStatBlock, "id">;
  /**
   * Conjures a followable, non-creature object at the caster's own position (Tenser's Floating
   * Disk) — a DungeonEntity of type 'object' with followsId set to the caster, snapped to catch
   * up whenever token:move puts them past leashFt away. Weight capacity is NOT modeled — the
   * codebase has no item-weight field anywhere (Item/Weapon/Armor/Consumable), and adding one
   * is a schema change affecting every item in the game, not something to smuggle in for one
   * ritual spell.
   */
  followingObject?: { name: string; leashFt: number };
  /**
   * Lays Difficult Terrain over this spell's area on cast (Entangle, Grease) — extra feet-per-cell
   * a walked path costs while crossing it, cleared after durationRounds. Read client-side (see
   * Canvas.tsx's drag-cost calculation against Dungeon.hazardCells) since movement cost is
   * entirely client-owned today; not enforced server-side, same trust model as movementRemaining
   * itself.
   */
  difficultTerrain?: { multiplier: number; durationRounds: number };
  /**
   * Lays Heavily Obscured over this spell's area on cast (Fog Cloud) — any attack roll whose
   * line between attacker and target crosses one of these cells (or whose target stands in one)
   * gets disadvantage, both directions (see crossesObscuredArea, checked in both combat:attack
   * and combat:spell:attack). Combat-only: round-based expiry has nothing to advance against
   * outside an active encounter, so — unlike gameTime hooks — this isn't placed when the spell
   * is cast during exploration, only mid-combat.
   */
  obscuresArea?: { durationRounds: number };
  /** Buttons offered at cast time for a "choose one of these named options" spell (Command's Approach/Drop/Flee/Grovel/Halt) — same idea as an EffectSpec's damageTypeOptions, just spell-wide instead of per-effect since Command's options aren't all damage. Picked value arrives as chosenCommand; a free-text one-word entry is always available alongside these too (see SpellsTab.tsx). */
  commandOptions?: string[];
  /** How difficultTerrain/obscuresArea's cells are drawn on the map (Entangle's vines, Grease/Fog Cloud's smudge) — see Dungeon.hazardCells.style. */
  hazardVisual?: { style: "vines" | "smudge"; color: string };
  /** Drops a stationary, purely cosmetic DungeonEntity (type 'object', no followsId) at the targeted cell on cast (Silent Image) — a labeled marker only, no illusion-detection/movement mechanics behind it. */
  placesIllusion?: boolean;
}

export interface Spell {
  name: string;
  source: string;
  level: number; // 0 = cantrip, 1–9 = spell level
  levelLabel: string; // 'Cantrip' | '1st' | '2nd' | …
  castingTime: string;
  duration: string;
  school: string; // normalized, e.g. 'Evocation' (ritual stripped out)
  range: string;
  components: string;
  classes: string[]; // canonical class names, e.g. ['Wizard', 'Sorcerer']
  text: string;
  atHigherLevels: string;
  isRitual: boolean;
  combat?: SpellCombatMeta; // GM/engine-only metadata; not for player-facing display
}

/**
 * The per-turn action economy resources a participant spends. Named here because the same
 * union is the return of actionCostFromCastingTime, the client's targeting actionType, and
 * the server-side budget on Participant.
 */
export type ActionResource = "action" | "bonusAction" | "reaction";

/** 'Action' → 'action', 'Bonus Action' → 'bonusAction', reactions → 'reaction'; rituals/long casts → null (not castable mid-combat). */
export function actionCostFromCastingTime(
  castingTime: string,
): ActionResource | null {
  const t = castingTime.trim().toLowerCase();
  if (t === "action") return "action";
  if (t === "bonus" || t === "bonus action") return "bonusAction";
  if (t.includes("reaction")) return "reaction";
  return null;
}

/** True for spells whose `duration` text starts with 'Concentration' (e.g. 'Concentration, up to 1 minute'). */
export function requiresConcentration(spell: Spell): boolean {
  return spell.duration.trim().toLowerCase().startsWith("concentration");
}

/** Parses a spell's `range` field into feet for targeting math. 'Self'→0, 'Touch'→5, 'Sight'/'Unlimited'→Infinity. */
export function parseRangeFeet(range: string): number {
  const t = range.trim().toLowerCase();
  if (t === "self" || t.startsWith("self (")) return 0;
  if (t === "touch") return 5;
  if (t === "sight" || t === "unlimited") return Infinity;
  const m = t.match(/(\d+)\s*feet/);
  return m ? Number(m[1]) : 0;
}

/**
 * Resolves a Scaling to the dice formula to roll. Cantrip mode picks the highest tier
 * the caster's character level qualifies for; spell-slot mode picks the highest tier
 * the slot it was cast at qualifies for (i.e. upcasting); ability-mod ignores level/slot
 * entirely and returns the caster's spellcasting modifier as a flat "1d1+N" formula.
 */
export function resolveSpellDamageDice(
  scaling: Scaling | undefined,
  casterLevel: number,
  slotLevel: number,
  casterAbilityMod?: number,
): string | undefined {
  if (!scaling) return undefined;
  if (scaling.mode === "ability-mod") {
    const mod = casterAbilityMod ?? 0;
    return `1d1${mod >= 0 ? "+" : ""}${mod}`;
  }
  const level = scaling.mode === "cantrip" || scaling.mode === "cantrip-plus-ability-mod" ? casterLevel : slotLevel;
  let value = scaling.base;
  for (const tier of scaling.tiers) {
    if (level >= tier.atLevel) value = tier.value;
  }
  if (scaling.mode === "cantrip-plus-ability-mod") {
    const mod = casterAbilityMod ?? 0;
    const modStr = `${mod >= 0 ? "+" : ""}${mod}`;
    return value ? `${value}${modStr}` : `1d1${modStr}`;
  }
  return value;
}

/** How many discrete targets a spell needs picked before it fires — {min:1,max:1} for any ordinary single-target spell. */
export function spellTargetCount(spell: Spell, slotLevel: number, casterLevel?: number): { min: number; max: number } {
  const combat = spell.combat;
  const baseMax = combat?.targetsMax ?? 1;
  let max = combat?.targetsScaleWithSlot ? baseMax + Math.max(0, slotLevel - spell.level) : baseMax;
  // Eldritch Blast's shape: extra beams by character level (1/5/11/17), not by slot — cantrips
  // don't upcast, so targetsScaleWithSlot's slotLevel math doesn't apply here at all.
  if (combat?.targetsScaleWithCantripLevel) {
    const level = casterLevel ?? 1;
    max = baseMax + (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0);
  }
  return { min: combat?.targetsMin ?? 1, max };
}

/** True if an effect's appliesIf condition (if any) is satisfied by the target's creature type. */
export function effectApplies(effect: Pick<EffectSpec, "appliesIf">, targetCreatureType: CreatureType): boolean {
  const types = effect.appliesIf?.creatureType;
  return !types || types.includes(targetCreatureType);
}
