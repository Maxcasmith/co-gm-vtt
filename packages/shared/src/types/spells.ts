import type { AbilityKey } from "./character.ts";
import type { CreatureType } from "./combat.ts";

// One tier of a scaling progression, e.g. { atLevel: 5, value: '2d10' }
export interface ScalingTier {
  atLevel: number;
  value: string;
}

// 'cantrip' scales with character level (5/11/17); 'spell-slot' scales with the slot level cast at.
export interface Scaling {
  mode: "cantrip" | "spell-slot";
  base: string;
  tiers: ScalingTier[];
}

export const CONDITIONS = [
  "Blinded",
  "Charmed",
  "Deafened",
  "Exhaustion",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface EffectSpec {
  type: "damage" | "condition" | "push" | "pull";
  damageType?: string; // Fire, Acid, Force, ...
  scaling?: Scaling; // present for damage effects
  condition?: Condition;
  duration?: {
    value: number;
    unit: "round" | "minute" | "hour" | "until-save" | "instant";
  };
  distance?: number; // feet, present for push/pull effects
  // Gates this effect to targets matching the condition — e.g. Divine Smite's +1d8 vs
  // Fiend/Undead is a second onHit damage effect with appliesIf.creatureType: ['Fiend','Undead'].
  // Omitted entirely = applies to any target.
  appliesIf?: { creatureType?: CreatureType[] };
}

export interface SpellCombatMeta {
  resolution: "attack" | "save" | "auto" | "none";
  attackType?: "melee" | "ranged"; // when resolution === 'attack'
  save?: { ability: AbilityKey; halfOnSave: boolean }; // when resolution === 'save'
  area?: {
    shape: "sphere" | "cone" | "cube" | "line" | "cylinder" | "emanation";
    size: number;
    width?: number;
    origin: "point" | "self";
  };
  targets?: number; // discrete non-AoE multi-target (e.g. Magic Missile darts)
  onHit?: EffectSpec[];
  onSave?: EffectSpec[];
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

/** 'Action' → 'action', 'Bonus Action' → 'bonusAction', reactions → 'reaction'; rituals/long casts → null (not castable mid-combat). */
export function actionCostFromCastingTime(
  castingTime: string,
): "action" | "bonusAction" | "reaction" | null {
  const t = castingTime.trim().toLowerCase();
  if (t === "action") return "action";
  if (t === "bonus" || t === "bonus action") return "bonusAction";
  if (t.includes("reaction")) return "reaction";
  return null;
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
 * the slot it was cast at qualifies for (i.e. upcasting).
 */
export function resolveSpellDamageDice(
  scaling: Scaling | undefined,
  casterLevel: number,
  slotLevel: number,
): string | undefined {
  if (!scaling) return undefined;
  const level = scaling.mode === "cantrip" ? casterLevel : slotLevel;
  let value = scaling.base;
  for (const tier of scaling.tiers) {
    if (level >= tier.atLevel) value = tier.value;
  }
  return value;
}

/** True if an effect's appliesIf condition (if any) is satisfied by the target's creature type. */
export function effectApplies(effect: Pick<EffectSpec, "appliesIf">, targetCreatureType: CreatureType): boolean {
  const types = effect.appliesIf?.creatureType;
  return !types || types.includes(targetCreatureType);
}
