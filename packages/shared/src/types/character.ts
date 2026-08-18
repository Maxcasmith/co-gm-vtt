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

/** The 5e skill list, keyed to the ability score it's rolled with — matched against Character.skillProficiencies' free-text entries by rollSkillCheck (runtime.ts). */
export const SKILL_ABILITY: Record<string, AbilityKey> = {
  Athletics: "str",
  Acrobatics: "dex",
  "Sleight of Hand": "dex",
  Stealth: "dex",
  Arcana: "int",
  History: "int",
  Investigation: "int",
  Nature: "int",
  Religion: "int",
  "Animal Handling": "wis",
  Insight: "wis",
  Medicine: "wis",
  Perception: "wis",
  Survival: "wis",
  Deception: "cha",
  Intimidation: "cha",
  Performance: "cha",
  Persuasion: "cha",
};

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
  expertiseSkills?: string[];
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
  tempHp?: number;
  // Innate damage-type modifiers from species/class features (e.g. a Tiefling's Fire resistance).
  // Same shape and application path as EnemyStatBlock's — see DamageResistanceHook.
  damageResistances?: string[];
  damageVulnerabilities?: string[];
  damageImmunities?: string[];
  maxSpellSlots1?: number;
  currentSpellSlots1?: number;
  hitDiceUsed?: number;
  spells?: string[]; // learned spell names
  spellSources?: Record<string, string>; // spell name → source label (class name or feat/species name), for display only
  /** Origin feat picked at creation (e.g. 'Magic Initiate (Cleric)') — drives FEAT_SPELL_GRANTS below. */
  speciesOriginFeat?: string;
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

/**
 * Grants temp HP per 5e/5.5e rules: a grant replaces the current pool, it never stacks
 * additively — 2 current + 7 granted = 7, not 9. Only takes effect if higher than what's
 * already there, so the largest active grant always wins.
 */
export function setTempHp(current: number | undefined, granted: number): number {
  return Math.max(current ?? 0, granted);
}

// Level-1 max spell slots: Warlock's Pact Magic starts with 1, every other spellcasting
// class with the Spellcasting feat starts with 2. No slots beyond level 1 tracked yet —
// no class has spells-known growth past level 1 in this app either (see CLASS_SPELL_ALLOWANCE).
export function spellSlotsForClass(className: string): number {
  if (className === "Warlock") return 1;
  return className in CLASS_SPELLCASTING_ABILITY ? 2 : 0;
}

/**
 * Feats that grant spells from a class other than the character's own (Magic Initiate) — kept
 * separate from the character's normal class allowance so the two never merge into one pool:
 * these spells are learnable/displayed under their own "Magic Initiate (X)" bucket, capped at
 * exactly `cantrips`/`spells` regardless of what the character's own class already allows.
 */
export const FEAT_SPELL_GRANTS: Record<string, { cantrips: number; spells: number; forClass: string }> = {
  'Magic Initiate (Cleric)': { cantrips: 2, spells: 1, forClass: 'Cleric' },
  'Magic Initiate (Druid)':  { cantrips: 2, spells: 1, forClass: 'Druid'  },
  'Magic Initiate (Wizard)': { cantrips: 2, spells: 1, forClass: 'Wizard' },
};

// The Origin feat every Background grants at 1st level (2024 PHB). Canonical here rather than
// client-only because API-side mechanics (Savage Attacker, Tough, Alert, ...) need it too.
export const BACKGROUND_FEAT: Record<string, string> = {
  Acolyte:     'Magic Initiate (Cleric)',
  Artisan:     'Crafter',
  Charlatan:   'Skilled',
  Criminal:    'Alert',
  Entertainer: 'Musician',
  Farmer:      'Tough',
  Guard:       'Alert',
  Guide:       'Magic Initiate (Druid)',
  Hermit:      'Healer',
  Merchant:    'Lucky',
  Noble:       'Skilled',
  Sage:        'Magic Initiate (Wizard)',
  Sailor:      'Tavern Brawler',
  Scribe:      'Skilled',
  Soldier:     'Savage Attacker',
  Wayfarer:    'Lucky',
};

/**
 * Whether a character has a given Origin feat, from either source: their Background's fixed
 * feat (everyone), or a Human's separate "Versatile" bonus feat pick (Human only, 2024 PHB).
 */
export function hasOriginFeat(char: Pick<Character, 'background' | 'species' | 'speciesOriginFeat'>, featName: string): boolean {
  return BACKGROUND_FEAT[char.background] === featName ||
    (char.species === 'Human' && char.speciesOriginFeat === featName);
}

/**
 * Every passive perception-adjacent sense the canvas lighting pipeline needs to reason about —
 * darkvision is just the one kind with real data today. Blindsight/truesight/devilsSight/
 * tremorsense exist in the type so a future feature (monster stat blocks, invocation tracking,
 * ...) can grant them without another refactor; nothing in SPECIES_SENSES populates them yet.
 */
export type SenseKind = "darkvision" | "blindsight" | "truesight" | "devilsSight" | "tremorsense";
export interface Sense { kind: SenseKind; rangeFt: number }

/** Species-granted senses (2024 PHB). Species not listed have none. Subspecies overrides (Drow's Superior Darkvision, 120ft) aren't tracked — Character has no subspecies field. Activated/limited-use senses (Dwarf's Stonecunning Tremorsense) stay character-sheet flavor text only, not modeled here — they're not passive/always-on like everything else in this table. */
export const SPECIES_SENSES: Record<string, Sense[]> = {
  Aasimar: [{ kind: "darkvision", rangeFt: 60 }],
  Dragonborn: [{ kind: "darkvision", rangeFt: 60 }],
  Dwarf: [{ kind: "darkvision", rangeFt: 120 }],
  Elf: [{ kind: "darkvision", rangeFt: 60 }],
  Gnome: [{ kind: "darkvision", rangeFt: 60 }],
  "Half-Elf": [{ kind: "darkvision", rangeFt: 60 }],
  "Half-Orc": [{ kind: "darkvision", rangeFt: 60 }],
  Orc: [{ kind: "darkvision", rangeFt: 120 }],
  Tiefling: [{ kind: "darkvision", rangeFt: 60 }],
};

export function getSenses(species: string): Sense[] {
  return SPECIES_SENSES[species] ?? [];
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

/** Light radius (ft) from whatever's equipped in either hand (a torch) — 0 if nothing's lit. Both hands checked and maxed rather than just one, in case a light item ever ends up off-hand. */
export function characterLightRangeFt(character: Character): number {
  const heldIds = [character.equipment?.mainHand, character.equipment?.offHand].filter((id): id is string => !!id);
  const heldItems = heldIds.map(id => character.inventory?.find(i => i.id === id)).filter((i): i is NonNullable<typeof i> => !!i);
  return heldItems.reduce((max, i) => Math.max(max, i.lightEmissionRangeFt ?? 0), 0);
}
