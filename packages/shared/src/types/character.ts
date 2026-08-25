import type { Item, Weapon, Armor, Consumable, Ammunition } from "./items.ts";
import type { ActiveCondition } from "./conditions.ts";
import type { Manoeuvre } from "./tactics.ts";

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
  platinum?: number;
  electrum?: number;
  silver?: number;
  bronze?: number;
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
  /** Per-feature limited-use pools (Rage, Second Wind, Bardic Inspiration, ...) — see RESOURCE_DEFS. Keyed entries missing here default to full (resourceCurrent). */
  resourceUses?: Record<string, number> | undefined;
  /** Gained from Musician's performance (or a DM award) — spend it to give a just-rolled d20 Test Advantage, same mechanical effect as rerolling and taking the higher result. Granting always overwrites, never stacks (RAW). */
  heroicInspiration?: boolean;
  spells?: string[]; // learned spell names
  spellSources?: Record<string, string>; // spell name → source label (class name or feat/species name), for display only
  /** Origin feat picked at creation (e.g. 'Magic Initiate (Cleric)') — drives FEAT_SPELL_GRANTS below. */
  speciesOriginFeat?: string;
  /** Fighting Style feature pick at creation (Fighter's level 1 choice) — e.g. 'Archery', 'Dueling'. */
  fightingStyle?: string;
  /** Divine Order (Cleric) or Primal Order (Druid) pick at creation — e.g. 'Protector', 'Thaumaturge', 'Magician', 'Warden'. See effectiveWeaponProfs/effectiveArmorTraining. */
  classOrder?: string;
  /** Eldritch Invocations picked at creation (Warlock's level 1 choice, choose 2) — selection only, no mechanics wired yet. */
  invocations?: string[];
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
  // Lifetime combat tallies — accumulated in-memory per encounter (runtime.ts combatScores)
  // and flushed onto the character sheet once, in endCombat.
  enemiesKilled?: number;
  damageDealt?: number;
  damageReceived?: number;
  /** Offline-party-member mode: this session, the server plays their turns via `tactics` instead of waiting on the client. */
  aiControlled?: boolean;
  /** Competing manoeuvre chains, scored step-by-step each turn when `aiControlled` — see combat/tactics/. */
  tactics?: Manoeuvre[];
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

/**
 * Weapon/armor proficiency, adjusted for a Cleric's Divine Order or Druid's Primal Order pick
 * (Character.classOrder) — Protector and Warden are the only picks that widen the class's base
 * table (Martial weapons for both, Heavy armor for Protector only). Every consumer of
 * CLASS_WEAPON_PROFS/CLASS_ARMOR_TRAINING that checks a specific character's proficiency (not
 * just "what does this class get by default") should read through these instead of the raw
 * tables, or a Protector/Warden pick silently has no effect.
 */
export function effectiveWeaponProfs(character: Pick<Character, "class" | "classOrder">): WeaponProficiency[] {
  const base = CLASS_WEAPON_PROFS[character.class] ?? [];
  const grantsMartial =
    (character.class === "Cleric" && character.classOrder === "Protector") ||
    (character.class === "Druid" && character.classOrder === "Warden");
  return grantsMartial && !base.includes("martial") ? [...base, "martial"] : base;
}

export function effectiveArmorTraining(character: Pick<Character, "class" | "classOrder">): ArmorTraining[] {
  const base = CLASS_ARMOR_TRAINING[character.class] ?? [];
  const grantsHeavy = character.class === "Cleric" && character.classOrder === "Protector";
  return grantsHeavy && !base.includes("heavy") ? [...base, "heavy"] : base;
}

/** The 5 currency denominations tracked on a Character sheet — see InventoryTab's currency block. */
export type CurrencyDenomination = 'platinum' | 'gold' | 'electrum' | 'silver' | 'bronze';

export function currencyAmount(character: Pick<Character, CurrencyDenomination>, denom: CurrencyDenomination): number {
  return character[denom] ?? 0;
}

/** Returns the character's next amount for that denomination after adding. */
export function addCurrency(character: Pick<Character, CurrencyDenomination>, denom: CurrencyDenomination, amount: number): number {
  return currencyAmount(character, denom) + amount;
}

/** Returns the character's next amount for that denomination after spending — floored at 0, never goes negative. */
export function removeCurrency(character: Pick<Character, CurrencyDenomination>, denom: CurrencyDenomination, amount: number): number {
  return Math.max(0, currencyAmount(character, denom) - amount);
}

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

/**
 * A limited-use class-feature pool (Rage charges, Second Wind, Bardic Inspiration, ...) — the
 * generic resource this app was missing versus the one-off spell-slot/hit-dice counters above.
 * `max` is a formula, not a stored number, so it never drifts out of sync with level/stats.
 */
export interface ResourceDef {
  key: string;
  label: string;
  /** Owning class — resourceMax/applyResourceRestRegain only grant this pool to a matching character. Omit for a feat-gated pool (see featGate). */
  class?: string;
  /** Origin feat that grants this pool instead of a class (e.g. Lucky, Musician) — checked via hasOriginFeat. */
  featGate?: string;
  max: (character: Character) => number;
  /** Amount regained on finishing that rest type; 'full' tops off to max. Omit a rest type if the feature doesn't regain on it (e.g. most features don't regain on a short rest). */
  regain: { short?: "full" | number; long?: "full" | number };
}

/** Populated per-feature as each is wired up (see build audit) — empty is a valid, fully-functional state. */
export const RESOURCE_DEFS: Record<string, ResourceDef> = {
  // 2024 PHB: 2 uses at level 1, +1 at 5/11/17. Regains 1 on a Short Rest, all on a Long Rest.
  secondWind: {
    key: "secondWind",
    label: "Second Wind",
    class: "Fighter",
    max: character => {
      const level = character.level ?? 1;
      return 2 + (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0);
    },
    regain: { short: 1, long: "full" },
  },
  // 2024 PHB Barbarian Rage uses table: 2 (1-2), 3 (3-5), 4 (6-11), 5 (12-16), 6 (17-19),
  // Unlimited at 20 — capped here rather than modeled as Infinity, since nothing in this app
  // reaches level 20 yet (see spellSlotsForClass's same "level 1 only" scope note above).
  // No Short Rest regain — Rage only comes back on a Long Rest.
  rage: {
    key: "rage",
    label: "Rage",
    class: "Barbarian",
    max: character => {
      const level = character.level ?? 1;
      if (level >= 17) return 6;
      if (level >= 12) return 5;
      if (level >= 6) return 4;
      if (level >= 3) return 3;
      return 2;
    },
    regain: { long: "full" },
  },
  // 2024 PHB: uses equal to proficiency bonus, all regained on a Long Rest only.
  innateSorcery: {
    key: "innateSorcery",
    label: "Innate Sorcery",
    class: "Sorcerer",
    max: character => character.proficiencyBonus ?? 2,
    regain: { long: "full" },
  },
  // 2024 PHB Ranger: 2 free Hunter's Mark casts, both regained on a Long Rest only.
  favoredEnemy: {
    key: "favoredEnemy",
    label: "Favored Enemy",
    class: "Ranger",
    max: () => 2,
    regain: { long: "full" },
  },
  // 2024 PHB Bard: uses equal to proficiency bonus, all regained on a Long Rest only.
  bardicInspiration: {
    key: "bardicInspiration",
    label: "Bardic Inspiration",
    class: "Bard",
    max: character => character.proficiencyBonus ?? 2,
    regain: { long: "full" },
  },
  // 2024 PHB Artificer: uses equal to Intelligence modifier (minimum 1), all regained on a Long Rest only.
  tinkersMagic: {
    key: "tinkersMagic",
    label: "Tinker's Magic",
    class: "Artificer",
    max: character => Math.max(1, statMod(character.stats.int)),
    regain: { long: "full" },
  },
  // 2024 PHB Paladin: pool of 5 HP per Paladin level, spent in any amount up to what remains.
  // No Short Rest regain — only a Long Rest tops it back up.
  layOnHands: {
    key: "layOnHands",
    label: "Lay on Hands",
    class: "Paladin",
    max: character => 5 * (character.level ?? 1),
    regain: { long: "full" },
  },
  // 2024 PHB Wizard: usable once per Long Rest, but only by finishing a Short Rest — see
  // applyShortRest (rest.ts), which is the only place this ever gets spent. max:1 rather than a
  // boolean so it reads through the same resourceCurrent/resourceMax plumbing as every other pool.
  arcaneRecovery: {
    key: "arcaneRecovery",
    label: "Arcane Recovery",
    class: "Wizard",
    max: () => 1,
    regain: { long: "full" },
  },
  // Origin feat Lucky: uses equal to proficiency bonus, spent on a d20 Test for Advantage or on
  // an incoming attack roll for Disadvantage. All regained on a Long Rest only.
  luckPoints: {
    key: "luckPoints",
    label: "Luck Points",
    featGate: "Lucky",
    max: character => character.proficiencyBonus ?? 2,
    regain: { long: "full" },
  },
  // Magic Initiate's 1st-level spell: castable once per Long Rest with no spell slot spent —
  // its own pool, separate from the character's class slots (see FEAT_SPELL_GRANTS above). One
  // def per variant since a character only ever has one of the three.
  magicInitiateClericSpell: { key: "magicInitiateClericSpell", label: "Magic Initiate: Cleric Spell", featGate: "Magic Initiate (Cleric)", max: () => 1, regain: { long: "full" } },
  magicInitiateDruidSpell:  { key: "magicInitiateDruidSpell",  label: "Magic Initiate: Druid Spell",  featGate: "Magic Initiate (Druid)",  max: () => 1, regain: { long: "full" } },
  magicInitiateWizardSpell: { key: "magicInitiateWizardSpell", label: "Magic Initiate: Wizard Spell", featGate: "Magic Initiate (Wizard)", max: () => 1, regain: { long: "full" } },
  // Origin feat Crafter's Fast Crafting: one item from FAST_CRAFTING_TABLE, once per Long Rest.
  fastCrafting: { key: "fastCrafting", label: "Fast Crafting", featGate: "Crafter", max: () => 1, regain: { long: "full" } },
  // Origin feat Musician: play an instrument once per Short or Long Rest to grant Heroic
  // Inspiration to nearby allies (see grantMusicianInspiration, runtime.ts).
  musicianPerformance: { key: "musicianPerformance", label: "Musician's Performance", featGate: "Musician", max: () => 1, regain: { short: "full", long: "full" } },
};

/**
 * Origin feat Crafter's Fast Crafting table (2024 PHB) — items a Crafter can produce on a Long
 * Rest, gone at the next one. Tool-proficiency gating is skipped: this app doesn't track tool
 * proficiencies at all (Tinker's own "proficiency with Tinker's Tools" is flavor-only here too),
 * so every item on the table is offered rather than filtering by a tool the character can't record.
 */
export const FAST_CRAFTING_TABLE = [
  'Acid', 'Alchemist\'s Fire', 'Antitoxin', 'Firework', 'Perfume', 'Soap', 'Basic Poison',
] as const;

/** Which RESOURCE_DEFS key holds this character's Magic Initiate freebie-spell use, if any. */
export function magicInitiateResourceKey(character: Pick<Character, "background" | "species" | "speciesOriginFeat">): string | undefined {
  if (hasOriginFeat(character, "Magic Initiate (Cleric)")) return "magicInitiateClericSpell";
  if (hasOriginFeat(character, "Magic Initiate (Druid)")) return "magicInitiateDruidSpell";
  if (hasOriginFeat(character, "Magic Initiate (Wizard)")) return "magicInitiateWizardSpell";
  return undefined;
}

function ownsResource(character: Character, def: ResourceDef): boolean {
  if (def.class) return def.class === character.class;
  if (def.featGate) return hasOriginFeat(character, def.featGate);
  return false;
}

export function resourceMax(character: Character, key: string): number {
  const def = RESOURCE_DEFS[key];
  if (!def || !ownsResource(character, def)) return 0;
  return def.max(character);
}

/** Unspent (never touched this character) reads as full, same convention as currentSpellSlots1. */
export function resourceCurrent(character: Character, key: string): number {
  return character.resourceUses?.[key] ?? resourceMax(character, key);
}

/** Spends one use of `key` if available. Returns the next resourceUses map, or undefined if the pool is empty. */
export function trySpendResource(character: Character, key: string): Record<string, number> | undefined {
  const current = resourceCurrent(character, key);
  if (current <= 0) return undefined;
  return { ...(character.resourceUses ?? {}), [key]: current - 1 };
}

/** Spends a chosen amount from an HP-style pool (Lay on Hands) rather than a fixed single use. */
export function trySpendResourceAmount(character: Character, key: string, amount: number): Record<string, number> | undefined {
  const current = resourceCurrent(character, key);
  if (amount <= 0 || amount > current) return undefined;
  return { ...(character.resourceUses ?? {}), [key]: current - amount };
}

/** Applies every RESOURCE_DEFS regain rule for one rest type, returning the character's next resourceUses map. */
export function applyResourceRestRegain(character: Character, restType: "short" | "long"): Record<string, number> {
  const next: Record<string, number> = { ...(character.resourceUses ?? {}) };
  for (const def of Object.values(RESOURCE_DEFS)) {
    if (!ownsResource(character, def)) continue;
    const regain = def.regain[restType];
    if (regain === undefined) continue;
    const max = def.max(character);
    const current = next[def.key] ?? max;
    next[def.key] = regain === "full" ? max : Math.min(max, current + regain);
  }
  return next;
}
