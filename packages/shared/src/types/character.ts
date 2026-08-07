import type { Item, Weapon, Armor, Consumable, Ammunition } from "./items.ts";
import type { ActiveCondition } from "./conditions.ts";

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export interface CharacterStats {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface Character {
  id: string;
  campaignId: string;
  name: string;
  species: string;
  background: string;
  class: string;
  backstory?: string;
  stats: CharacterStats;
  skillProficiencies: string[];
  password: string;
  portraitPath: string;
  tokenPath: string;
  createdAt: string;
  inventory?: Array<Item | Weapon | Armor | Consumable | Ammunition>;
  gold?: number;
  speed?: number;
  initiativeBonus?: number;
  xp?: number;
  level?: number;
  proficiencyBonus?: number;
  maxHp?: number;
  currentHp?: number;
  maxSpellSlots1?: number;
  currentSpellSlots1?: number;
  hitDiceUsed?: number;
  spells?: string[]; // learned spell names
  equipment?: {
    head?: string;
    body?: string;
    gloves?: string;
    boots?: string;
    mainHand?: string;
    offHand?: string;
  };
  // `| undefined` (not bare `?:`) so functional updaters like `c => ({ ...c, conditions })`
  // can assign a variable that's sometimes undefined under exactOptionalPropertyTypes.
  conditions?: ActiveCondition[] | undefined;
}

// Level-1 max spell slots: Warlock's Pact Magic starts with 1, every other spellcasting
// class with the Spellcasting feat starts with 2. No slots beyond level 1 tracked yet —
// no class has spells-known growth past level 1 in this app either (see CLASS_SPELL_ALLOWANCE).
export function spellSlotsForClass(className: string): number {
  if (className === "Warlock") return 1;
  return className in CLASS_SPELLCASTING_ABILITY ? 2 : 0;
}

export const CLASS_SPELLCASTING_ABILITY: Record<string, AbilityKey> = {
  Artificer: "int",
  Bard: "cha",
  Cleric: "wis",
  Druid: "wis",
  Paladin: "cha",
  Ranger: "wis",
  Sorcerer: "cha",
  Warlock: "cha",
  Wizard: "int",
};

// Canonical source — client/src/character-creation/srd.ts imports this rather than
// keeping its own (uppercase-keyed) copy.
export const CLASS_SAVING_THROWS: Record<string, [AbilityKey, AbilityKey]> = {
  Artificer: ["int", "con"],
  Barbarian: ["str", "con"],
  Bard: ["dex", "cha"],
  Cleric: ["wis", "cha"],
  Druid: ["int", "wis"],
  Fighter: ["str", "con"],
  Monk: ["str", "dex"],
  Paladin: ["wis", "cha"],
  Ranger: ["str", "dex"],
  Rogue: ["dex", "int"],
  Sorcerer: ["con", "cha"],
  Warlock: ["wis", "cha"],
  Wizard: ["int", "wis"],
};

export type WeaponProficiency = "simple" | "martial";
export type ArmorTraining = "light" | "medium" | "heavy" | "shield";

export const CLASS_WEAPON_PROFS: Record<string, WeaponProficiency[]> = {
  Artificer: ["simple"],
  Barbarian: ["simple", "martial"],
  Bard: ["simple"],
  Cleric: ["simple"],
  Druid: ["simple"],
  Fighter: ["simple", "martial"],
  Monk: ["simple"],
  Paladin: ["simple", "martial"],
  Ranger: ["simple", "martial"],
  Rogue: ["simple"],
  Sorcerer: ["simple"],
  Warlock: ["simple"],
  Wizard: ["simple"],
};

export const CLASS_ARMOR_TRAINING: Record<string, ArmorTraining[]> = {
  Artificer: ["light", "medium", "shield"],
  Barbarian: ["light", "medium", "shield"],
  Bard: ["light"],
  Cleric: ["light", "medium", "shield"],
  Druid: ["light", "medium", "shield"],
  Fighter: ["light", "medium", "heavy", "shield"],
  Monk: [],
  Paladin: ["light", "medium", "heavy", "shield"],
  Ranger: ["light", "medium", "shield"],
  Rogue: ["light"],
  Sorcerer: [],
  Warlock: ["light"],
  Wizard: [],
};

export function statMod(score: number) {
  return Math.floor((score - 10) / 2);
}

export interface ACBreakdownPart {
  label: string;
  value: number;
}

export interface ACBreakdown {
  total: number;
  parts: ACBreakdownPart[];
}

/** Compute a character's AC breakdown from their equipped armor, applying D&D 5e dex-mod rules per armor type. */
export function calcACBreakdown(character: Character): ACBreakdown {
  const dex = statMod(character.stats.dex);
  const inv = character.inventory ?? [];

  // Only what's actually equipped counts — body armor slot, shield in the off hand.
  const bodyArmorId = character.equipment?.body;
  const offHandId = character.equipment?.offHand;
  const bodyArmor = inv.find(
    (i): i is Armor =>
      i.id === bodyArmorId && i.type === "armor" && !(i as Armor).isShield,
  ) as Armor | undefined;
  const shield = inv.find(
    (i): i is Armor =>
      i.id === offHandId && i.type === "armor" && (i as Armor).isShield,
  ) as Armor | undefined;
  const shieldAc = shield ? (shield as Armor).acBonus : 0;

  const parts: ACBreakdownPart[] = [];
  if (shield) parts.push({ label: `Shield (${shield.name})`, value: shieldAc });

  if (!bodyArmor) {
    // Unarmored — class special cases
    if (character.class === "Barbarian") {
      const con = statMod(character.stats.con);
      parts.unshift(
        { label: "Con modifier (Unarmored Defense)", value: con },
        { label: "Dex modifier", value: dex },
        { label: "Base", value: 10 },
      );
      return { total: 10 + dex + con + shieldAc, parts };
    }
    if (character.class === "Monk") {
      const wis = statMod(character.stats.wis);
      parts.unshift(
        { label: "Wis modifier (Unarmored Defense)", value: wis },
        { label: "Dex modifier", value: dex },
        { label: "Base", value: 10 },
      );
      return { total: 10 + dex + wis, parts };
    }
    parts.unshift(
      { label: "Dex modifier", value: dex },
      { label: "Base", value: 10 },
    );
    return { total: 10 + dex + shieldAc, parts };
  }

  const base = (bodyArmor as Armor).acBonus;
  parts.unshift({ label: `Armor (${bodyArmor.name})`, value: base });
  switch ((bodyArmor as Armor).armorType) {
    case "light":
      parts.push({ label: "Dex modifier", value: dex });
      return { total: base + dex + shieldAc, parts };
    case "medium": {
      const cappedDex = Math.min(dex, 2);
      parts.push({ label: "Dex modifier (max +2)", value: cappedDex });
      return { total: base + cappedDex + shieldAc, parts };
    }
    case "heavy":
      return { total: base + shieldAc, parts };
    default:
      parts.push({ label: "Dex modifier", value: dex });
      return { total: base + dex + shieldAc, parts };
  }
}

/** Compute a character's AC from their inventory armor, applying D&D 5e dex-mod rules per armor type. */
export function calcAC(character: Character): number {
  return calcACBreakdown(character).total;
}
