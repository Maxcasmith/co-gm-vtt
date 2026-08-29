import type { AbilityKey } from 'shared';
import { CLASS_SAVING_THROWS as CLASS_SAVING_THROWS_SHARED } from 'shared';

export const SPECIES = [
  'Aasimar', 'Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath',
  'Halfling', 'Human', 'Orc', 'Tiefling',
];

export const BACKGROUNDS = [
  'Acolyte', 'Artisan', 'Charlatan', 'Criminal', 'Entertainer',
  'Farmer', 'Guard', 'Guide', 'Hermit', 'Merchant', 'Noble',
  'Sage', 'Sailor', 'Scribe', 'Soldier', 'Wayfarer',
];

export const CLASSES = [
  'Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid',
  'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue',
  'Sorcerer', 'Warlock', 'Wizard',
];

export const STAT_NAMES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;
export type StatName = typeof STAT_NAMES[number];

// ── Species ───────────────────────────────────────────────────────────────────

export const SPECIES_SUBSPECIES: Record<string, string[]> = {
  Dragonborn: ['Chromatic', 'Gem', 'Metallic'],
  Elf:        ['Drow', 'High Elf', 'Wood Elf'],
  Gnome:      ['Forest Gnome', 'Rock Gnome'],
  Tiefling:   ['Abyssal', 'Chthonic', 'Infernal'],
};

export interface SpeciesFeature { name: string; description: string }

export const SPECIES_FEATURES: Record<string, SpeciesFeature[]> = {
  Aasimar: [
    { name: "Celestial Resistance", description: "You have Resistance to Necrotic and Radiant damage." },
    { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light." },
    { name: "Healing Hands", description: "As a Magic action, you can touch a creature and restore a number of Hit Points equal to your Proficiency Bonus. Once you use this trait you can't do so again until you finish a Long Rest." },
    { name: "Light Bearer", description: "You know the Light cantrip. Charisma is your spellcasting ability for it." },
    { name: "Celestial Revelation", description: "When you reach 3rd level, choose Necrotic Shroud, Radiant Consumption, or Radiant Soul. This transformation manifests as wings and an aura for 1 minute, granting bonus effects once per Long Rest." },
  ],
  Dragonborn: [
    { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light." },
    { name: "Draconic Ancestry", description: "Your lineage grants a damage type: Chromatic (acid/lightning/poison/fire/cold), Gem (psychic/radiant/thunder/force/necrotic), or Metallic (fire/cold, with secondary effects)." },
    { name: "Breath Weapon", description: "When you take the Attack action, you can replace one attack with an exhalation of magical energy in a 15-foot cone or 30-foot line. Each creature in that area must make a Dexterity saving throw (DC = 8 + CON modifier + proficiency bonus). Damage equals 1d10 per two character levels." },
    { name: "Damage Resistance", description: "You have Resistance to the damage type associated with your Draconic Ancestry." },
  ],
  Chromatic: [
    { name: "Chromatic Warding", description: "Starting at 5th level, as an action you can channel your draconic power to grant yourself immunity to the damage type of your Chromatic Ancestry for 10 minutes, once per Long Rest." },
  ],
  Gem: [
    { name: "Psionic Mind", description: "You can send telepathic messages to any creature you can see within 30 feet. The creature doesn't need to share a language, but must be able to understand at least one language." },
    { name: "Gem Flight", description: "Starting at 5th level, as a Bonus Action you sprout spectral wings and gain a Fly Speed equal to your Speed for 1 minute, once per Long Rest." },
  ],
  Metallic: [
    { name: "Metallic Breath Weapon", description: "When you use your Breath Weapon, you can use this alternate form: creatures must succeed on a Constitution saving throw or become Incapacitated (Enervating Breath) or Frightened (Repulsion Breath) until the start of your next turn." },
  ],
  Dwarf: [
    { name: "Darkvision", description: "You can see in dim light within 120 feet as if it were bright light." },
    { name: "Dwarven Resilience", description: "You have Advantage on saving throws against the Poisoned condition, and you have Resistance to Poison damage." },
    { name: "Dwarven Toughness", description: "Your hit point maximum increases by 1, and it increases by 1 again whenever you gain a level." },
    { name: "Stonecunning", description: "As a Bonus Action you gain Tremorsense of 60 feet for 10 minutes, detecting vibrations in stone. You can use this trait a number of times equal to your Proficiency Bonus per Long Rest." },
  ],
  Elf: [
    { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light." },
    { name: "Fey Ancestry", description: "You have Advantage on saving throws you make to avoid or end the Charmed condition." },
    { name: "Keen Senses", description: "You have proficiency in the Perception skill." },
    { name: "Trance", description: "You don't need to sleep. Instead you meditate for 4 hours per day, after which you gain the same benefit as a Human from 8 hours of sleep." },
  ],
  Drow: [
    { name: "Superior Darkvision", description: "Your Darkvision has a range of 120 feet." },
    { name: "Drow Magic", description: "You know the Dancing Lights cantrip. Starting at 3rd level you can cast Faerie Fire once per Long Rest. At 5th level you can also cast Darkness once per Long Rest. Charisma is your spellcasting ability." },
    { name: "Drow Weapon Training", description: "You have proficiency with rapiers, shortswords, and hand crossbows." },
  ],
  "High Elf": [
    { name: "Cantrip", description: "You know one cantrip of your choice from the Wizard spell list. Intelligence is your spellcasting ability for it." },
    { name: "Elf Weapon Training", description: "You have proficiency with longswords, shortswords, shortbows, and longbows." },
  ],
  "Wood Elf": [
    { name: "Fleet of Foot", description: "Your Speed increases to 35 feet." },
    { name: "Mask of the Wild", description: "You can attempt to Hide even when only lightly obscured by foliage, heavy rain, falling snow, mist, or other natural phenomena." },
    { name: "Elf Weapon Training", description: "You have proficiency with longswords, shortswords, shortbows, and longbows." },
  ],
  Gnome: [
    { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light." },
    { name: "Gnomish Cunning", description: "You have Advantage on Intelligence, Wisdom, and Charisma saving throws against magic." },
  ],
  "Forest Gnome": [
    { name: "Natural Illusionist", description: "You know the Minor Illusion cantrip. Intelligence is your spellcasting ability for it." },
    { name: "Speak with Small Beasts", description: "Through sounds and gestures you can communicate simple ideas to Small or smaller beasts." },
  ],
  "Rock Gnome": [
    { name: "Artificer's Lore", description: "Whenever you make an Intelligence (History) check related to magic items, alchemical objects, or technological devices, you can add twice your Proficiency Bonus." },
    { name: "Tinker", description: "You have proficiency with Artisan's Tools (Tinker's Tools). Using those tools you can spend 1 hour and 10 GP worth of materials to construct a Tiny clockwork device." },
  ],
  Goliath: [
    { name: "Giant Ancestry", description: "You are descended from giants. Choose one giant type (Cloud, Fire, Frost, Hill, Stone, or Storm) to determine your Giant Legacy trait, which you can use once per Long Rest." },
    { name: "Large Form", description: "Starting at 5th level, as a Bonus Action you become Large for 1 minute. While Large, you have Advantage on Strength checks and your Speed increases by 10 feet." },
    { name: "Powerful Build", description: "You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift." },
    { name: "Stone's Endurance", description: "When you take damage, you can use your Reaction to roll a d12. Add your Constitution modifier to the number rolled and reduce the damage by that total. Once used, you must finish a Short or Long Rest." },
  ],
  Halfling: [
    { name: "Brave", description: "You have Advantage on saving throws you make to avoid or end the Frightened condition." },
    { name: "Halfling Nimbleness", description: "You can move through the space of any creature that is of a size larger than yours." },
    { name: "Lucky", description: "When you roll a 1 on the d20 for an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll." },
    { name: "Naturally Stealthy", description: "You can attempt to Hide even when obscured only by a creature that is at least one size larger than you." },
  ],
  Human: [
    { name: "Resourceful", description: "You gain Heroic Inspiration whenever you finish a Long Rest." },
    { name: "Skillful", description: "You gain proficiency in one skill of your choice." },
    { name: "Versatile", description: "You gain an Origin feat of your choice." },
  ],
  Orc: [
    { name: "Adrenaline Rush", description: "You can take the Dash action as a Bonus Action. When you do, you gain a number of Temporary Hit Points equal to your Proficiency Bonus. You can use this trait a number of times equal to your Proficiency Bonus per Long Rest." },
    { name: "Darkvision", description: "You can see in dim light within 120 feet as if it were bright light." },
    { name: "Powerful Build", description: "You count as one size larger when determining carrying capacity and weight you can push, drag, or lift." },
    { name: "Relentless Endurance", description: "When you are reduced to 0 Hit Points but not killed outright, you can drop to 1 Hit Point instead, once per Long Rest." },
  ],
  Tiefling: [
    { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light." },
    { name: "Fiendish Legacy", description: "You have a supernatural connection to one of three fiendish realms. Choose Abyssal (demonic), Chthonic (devilish), or Infernal (fiendish) to determine your resistance and innate spells." },
  ],
  Abyssal: [
    { name: "Abyssal Resilience", description: "You have Resistance to Poison damage, and you know the Poison Spray cantrip. At 3rd level you can cast Ray of Sickness once per Long Rest. At 5th level you can cast Hold Person once per Long Rest. Charisma is your spellcasting ability." },
  ],
  Chthonic: [
    { name: "Chthonic Resilience", description: "You have Resistance to Necrotic damage, and you know the Chill Touch cantrip. At 3rd level you can cast False Life once per Long Rest. At 5th level you can cast Ray of Enfeeblement once per Long Rest. Charisma is your spellcasting ability." },
  ],
  Infernal: [
    { name: "Infernal Legacy", description: "You have Resistance to Fire damage, and you know the Thaumaturgy cantrip. At 3rd level you can cast Hellish Rebuke once per Long Rest. At 5th level you can cast Darkness once per Long Rest. Charisma is your spellcasting ability." },
  ],
};

// ── Backgrounds ───────────────────────────────────────────────────────────────

export const BACKGROUND_ASI: Record<string, StatName[]> = {
  Acolyte:    ['INT', 'WIS', 'CHA'],
  Artisan:    ['STR', 'DEX', 'INT'],
  Charlatan:  ['DEX', 'CON', 'CHA'],
  Criminal:   ['DEX', 'CON', 'INT'],
  Entertainer:['STR', 'DEX', 'CHA'],
  Farmer:     ['STR', 'CON', 'WIS'],
  Guard:      ['STR', 'INT', 'CHA'],
  Guide:      ['DEX', 'CON', 'WIS'],
  Hermit:     ['CON', 'INT', 'WIS'],
  Merchant:   ['CON', 'INT', 'CHA'],
  Noble:      ['STR', 'INT', 'CHA'],
  Sage:       ['CON', 'INT', 'WIS'],
  Sailor:     ['STR', 'DEX', 'CON'],
  Scribe:     ['DEX', 'INT', 'WIS'],
  Soldier:    ['STR', 'DEX', 'CON'],
  Wayfarer:   ['DEX', 'WIS', 'CHA'],
};

export interface BackgroundFeat { name: string; description: string }

// ── Classes ───────────────────────────────────────────────────────────────────

export const HIT_DICE: Record<string, number> = {
  Artificer: 8,  Barbarian: 12, Bard: 8,      Cleric: 8,  Druid: 8,
  Fighter: 10,   Monk: 8,       Paladin: 10,   Ranger: 10, Rogue: 8,
  Sorcerer: 6,   Warlock: 8,    Wizard: 6,
};

/** 2024 PHB multiclass prerequisites — the ability score(s) needed in a class you don't already have levels in before you can take your first level in it. 'all' = every listed stat needs 13+, 'any' = just one of them (Fighter's Str-or-Dex). No prereq is checked against classes you already have levels in — only the new one. */
export const MULTICLASS_PREREQS: Record<string, { stats: AbilityKey[]; mode: 'all' | 'any' }> = {
  Artificer: { stats: ['int'], mode: 'all' },
  Barbarian: { stats: ['str'], mode: 'all' },
  Bard:      { stats: ['cha'], mode: 'all' },
  Cleric:    { stats: ['wis'], mode: 'all' },
  Druid:     { stats: ['wis'], mode: 'all' },
  Fighter:   { stats: ['str', 'dex'], mode: 'any' },
  Monk:      { stats: ['dex', 'wis'], mode: 'all' },
  Paladin:   { stats: ['str', 'cha'], mode: 'all' },
  Ranger:    { stats: ['dex', 'wis'], mode: 'all' },
  Rogue:     { stats: ['dex'], mode: 'all' },
  Sorcerer:  { stats: ['cha'], mode: 'all' },
  Warlock:   { stats: ['cha'], mode: 'all' },
  Wizard:    { stats: ['int'], mode: 'all' },
};

export function meetsMulticlassPrereq(className: string, stats: Record<AbilityKey, number>): boolean {
  const req = MULTICLASS_PREREQS[className];
  if (!req) return true;
  const scores = req.stats.map(s => stats[s]);
  return req.mode === 'any' ? scores.some(v => v >= 13) : scores.every(v => v >= 13);
}

export interface ClassFeature { name: string; description: string }

export const CLASS_FEATURES: Record<string, ClassFeature[]> = {
  Artificer: [
    { name: "Spellcasting", description: "You've studied the workings of magic and can cast Artificer spells. Intelligence is your spellcasting ability. You prepare spells from the Artificer spell list each long rest." },
    { name: "Tinker's Magic", description: "You know the Mending cantrip. As a Magic action while holding Tinker's Tools, you can create one mundane item (Rope, Caltrops, a Grappling Hook, and more) in an unoccupied space within 5 feet of yourself. The item lasts until you finish a Long Rest, then vanishes. Usable a number of times equal to your Intelligence modifier (minimum of once) per Long Rest." },
  ],
  Barbarian: [
    { name: "Rage", description: "On your turn you can enter a Rage as a Bonus Action. While raging you gain Advantage on Strength checks and saves, +2 to damage with Strength-based attacks, and Resistance to Bludgeoning, Piercing, and Slashing damage." },
    { name: "Unarmored Defense", description: "While you aren't wearing armor, your Armor Class equals 10 + your Dexterity modifier + your Constitution modifier. You can use a Shield and still gain this benefit." },
    { name: "Weapon Mastery", description: "Your training with weapons allows you to use the Mastery property of two kinds of Simple or Martial Melee weapons. You can change your chosen weapons whenever you finish a Long Rest." },
  ],
  Bard: [
    { name: "Bardic Inspiration", description: "As a Bonus Action you can give one creature within 60 feet a d6 Bardic Inspiration die. The creature can add the die to one ability check, attack roll, or saving throw within the next 10 minutes." },
    { name: "Spellcasting", description: "You have learned to cast spells through your bardic arts. Charisma is your spellcasting ability. You know a fixed list of spells and can cast any of them using your spell slots." },
  ],
  Cleric: [
    { name: "Divine Order", description: "You have dedicated yourself to one of two sacred roles. Protector grants proficiency with Martial weapons and Heavy armor. Thaumaturge grants one additional cantrip and extra languages from the Divine domain." },
    { name: "Spellcasting", description: "You draw magic from the divine. Wisdom is your spellcasting ability. You prepare spells from the entire Cleric spell list each long rest, choosing from spells of levels you can cast." },
  ],
  Druid: [
    { name: "Primal Order", description: "You align yourself with one of two primal roles at 1st level. Magician grants an extra cantrip and access to the Druidic Focus spellcasting. Warden grants proficiency with Martial weapons and the Druidic language." },
    { name: "Spellcasting", description: "Attuned to the natural world, you can cast Druid spells. Wisdom is your spellcasting ability. You prepare spells each long rest from the full Druid spell list." },
    { name: "Druidic", description: "You know Druidic, the secret language of Druids. You can speak it and use it to leave hidden messages, which require a DC 15 Perception check to find and a DC 15 Arcana check to decode." },
  ],
  Fighter: [
    { name: "Fighting Style", description: "You adopt a particular style of fighting. Options include Archery, Defense, Dueling, Great Weapon Fighting, Protection, and Two-Weapon Fighting, each granting a different combat bonus." },
    { name: "Second Wind", description: "As a Bonus Action you can regain hit points equal to 1d10 + your Fighter level. Once you use this feature you can't use it again until you finish a Short or Long Rest." },
    { name: "Weapon Mastery", description: "You can use the Mastery property of three kinds of weapons. You may change your choices whenever you finish a Long Rest." },
  ],
  Monk: [
    { name: "Martial Arts", description: "Your practice of martial arts gives you mastery of combat styles using unarmed strikes and Monk weapons. You can use Dexterity for attack and damage rolls with these weapons, and your unarmed strike damage die increases as you level." },
    { name: "Unarmored Defense", description: "While you aren't wearing armor or wielding a Shield, your Armor Class equals 10 + your Dexterity modifier + your Wisdom modifier." },
  ],
  Paladin: [
    { name: "Lay on Hands", description: "You have a pool of healing power equal to 5 x your Paladin level. As a Bonus Action you can touch a creature to restore any number of hit points from your pool, or expend 5 points to cure one disease or poison." },
    { name: "Spellcasting", description: "You draw divine power to cast Paladin spells. Charisma is your spellcasting ability. You prepare spells from the Paladin list each long rest." },
    { name: "Weapon Mastery", description: "You can use the Mastery property of two kinds of weapons. You may change your choices whenever you finish a Long Rest." },
  ],
  Ranger: [
    { name: "Expertise", description: "You gain Expertise in two skills of your choice from your skill proficiencies, doubling your proficiency bonus for those skills." },
    { name: "Favored Enemy", description: "You always have the Hunter's Mark spell prepared and it doesn't count against your prepared spells. You can cast it twice before a Long Rest without expending a spell slot." },
    { name: "Spellcasting", description: "You have learned to channel the magic of the wilderness. Wisdom is your spellcasting ability. You prepare spells from the Ranger spell list each long rest." },
    { name: "Weapon Mastery", description: "You can use the Mastery property of two kinds of weapons. You may change your choices whenever you finish a Long Rest." },
  ],
  Rogue: [
    { name: "Expertise", description: "You gain Expertise in two skills of your choice, doubling your proficiency bonus for those skills." },
    { name: "Sneak Attack", description: "Once per turn you can deal 1d6 extra damage to one creature you hit with an attack if you have Advantage on the roll, or if an ally is adjacent to the target. The extra damage increases as you gain levels." },
    { name: "Thieves' Cant", description: "You know the secret language of rogues. You can communicate with other Rogues through seemingly innocent conversations, and you can decode most written Thieves' Cant." },
    { name: "Weapon Mastery", description: "You can use the Mastery property of two kinds of weapons. You may change your choices whenever you finish a Long Rest." },
  ],
  Sorcerer: [
    { name: "Innate Sorcery", description: "As a Bonus Action you can unleash the sorcerous power within for 1 minute. While active you gain Advantage on attack rolls of sorcerer spells and the saving throw DC of your spells increases by 1." },
    { name: "Spellcasting", description: "An innate talent for sorcery lets you cast spells. Charisma is your spellcasting ability. Unlike other casters you know a fixed number of spells, but can cast any of them with your spell slots." },
  ],
  Warlock: [
    { name: "Eldritch Invocations", description: "In your study of occult lore you have unearthed eldritch invocations — fragments of forbidden knowledge. You learn two Invocations of your choice that each grant a constant or triggered magical benefit." },
    { name: "Pact Magic", description: "Your arcane research and your patron's power give you a small number of high-level spell slots that refresh on a Short Rest. Charisma is your spellcasting ability." },
  ],
  Wizard: [
    { name: "Arcane Recovery", description: "Once per Long Rest when you finish a Short Rest, you can recover expended spell slots with a combined level equal to or less than half your Wizard level (rounded up)." },
    { name: "Spellcasting", description: "As a student of arcane magic you have a spellbook and can prepare spells from it each Long Rest. Intelligence is your spellcasting ability. You begin with six 1st-level spells in your book." },
  ],
};

// ── Fighting Styles (Fighter level 1 choice) ─────────────────────────────────

export interface FightingStyle { name: string; description: string }

export const FIGHTING_STYLES: FightingStyle[] = [
  { name: "Archery", description: "You gain a +2 bonus to attack rolls you make with Ranged weapons." },
  { name: "Defense", description: "While you are wearing Armor, you gain a +1 bonus to Armor Class." },
  { name: "Dueling", description: "While you are wielding a Melee weapon in one hand and no other weapons, you gain a +2 bonus to damage rolls with that weapon." },
  { name: "Great Weapon Fighting", description: "When you roll a 1 or 2 on a damage die for an attack you make with a Melee weapon that you are wielding with two hands, you can reroll the die and must use the new roll, even if the new roll is a 1 or a 2. The weapon must have the Two-Handed or Versatile property to gain this benefit." },
  { name: "Protection", description: "When a creature you can see attacks a target other than you that is within 5 feet of you, you can take a Reaction to impose Disadvantage on the attack roll. You must be wielding a Shield." },
  { name: "Two-Weapon Fighting", description: "When you engage in Two-Weapon Fighting, you can add your ability modifier to the damage of the second attack." },
];

// ── Divine Order / Primal Order (Cleric / Druid level 1 choice) ──────────────
// Only the mechanically-wired half of each description is asserted here (weapon/armor
// proficiency, the bonus cantrip) — see effectiveWeaponProfs/effectiveArmorTraining (shared) and
// SpellsTab's orderCantripBonus.

export interface ClassOrder { name: string; description: string }

export const DIVINE_ORDERS: ClassOrder[] = [
  { name: "Protector", description: "You are trained for battle. You gain proficiency with Martial weapons and Heavy armor." },
  { name: "Thaumaturge", description: "You know one extra cantrip from the Cleric spell list, on top of the cantrips granted by Spellcasting." },
];

export const PRIMAL_ORDERS: ClassOrder[] = [
  { name: "Magician", description: "You know one extra cantrip from the Druid spell list, on top of the cantrips granted by Spellcasting." },
  { name: "Warden", description: "Trained for battle, you gain proficiency with Martial weapons." },
];

// ── Eldritch Invocations (Warlock level 1 choice, choose 2) ──────────────────
// 2024 PHB's full invocation list has ~28 entries, most gated behind Warlock level 2+ or a
// prerequisite invocation — this is only the subset with no prerequisite at all, i.e. what's
// actually choosable at level 1. Selection only for now — no mechanical effects wired yet.

export interface Invocation { name: string; description: string }

export const ELDRITCH_INVOCATIONS: Invocation[] = [
  { name: "Armor of Shadows", description: "You can cast Mage Armor on yourself without expending a spell slot." },
  { name: "Eldritch Mind", description: "You have Advantage on Constitution saving throws that you make to maintain Concentration." },
  { name: "Pact of the Blade", description: "As a Bonus Action, you can conjure a pact weapon in your hand — a Simple or Martial Melee weapon of your choice with which you bond. Until the bond ends, you have proficiency with the weapon, and you can use it as a Spellcasting Focus. Whenever you attack with the bonded weapon, you can use your Charisma modifier for the attack and damage rolls instead of Strength or Dexterity." },
  { name: "Pact of the Chain", description: "You learn the Find Familiar spell and can cast it as a Magic action without expending a spell slot. When you take the Attack action, you can forgo one of your own attacks to let your familiar make one attack with its Reaction." },
  { name: "Pact of the Tome", description: "A Book of Shadows appears in your hand at the end of a Short or Long Rest. Choose three cantrips and two 1st-level Ritual spells from any class's spell list — while the book is on your person, you have them prepared as Warlock spells. You can also use the book as a Spellcasting Focus." },
];

// Sourced from shared (server needs the same table for spell save resolution);
// re-cased to uppercase here since StatName/STAT_NAMES are uppercase throughout this file.
export const CLASS_SAVING_THROWS: Record<string, [StatName, StatName]> = Object.fromEntries(
  Object.entries(CLASS_SAVING_THROWS_SHARED).map(
    ([cls, [a, b]]) => [cls, [a.toUpperCase(), b.toUpperCase()] as [StatName, StatName]]
  )
);

// ── Skills ────────────────────────────────────────────────────────────────────

export interface Skill { name: string; stat: StatName }

export const SKILLS: Skill[] = [
  { name: 'Athletics',      stat: 'STR' },
  { name: 'Acrobatics',     stat: 'DEX' },
  { name: 'Sleight of Hand',stat: 'DEX' },
  { name: 'Stealth',        stat: 'DEX' },
  { name: 'Arcana',         stat: 'INT' },
  { name: 'History',        stat: 'INT' },
  { name: 'Investigation',  stat: 'INT' },
  { name: 'Nature',         stat: 'INT' },
  { name: 'Religion',       stat: 'INT' },
  { name: 'Animal Handling',stat: 'WIS' },
  { name: 'Insight',        stat: 'WIS' },
  { name: 'Medicine',       stat: 'WIS' },
  { name: 'Perception',     stat: 'WIS' },
  { name: 'Survival',       stat: 'WIS' },
  { name: 'Deception',      stat: 'CHA' },
  { name: 'Intimidation',   stat: 'CHA' },
  { name: 'Performance',    stat: 'CHA' },
  { name: 'Persuasion',     stat: 'CHA' },
];

export const BACKGROUND_SKILLS: Record<string, string[]> = {
  Acolyte:     ['Insight', 'Religion'],
  Artisan:     ['Investigation', 'Persuasion'],
  Charlatan:   ['Deception', 'Sleight of Hand'],
  Criminal:    ['Sleight of Hand', 'Stealth'],
  Entertainer: ['Acrobatics', 'Performance'],
  Farmer:      ['Animal Handling', 'Nature'],
  Guard:       ['Athletics', 'Perception'],
  Guide:       ['Athletics', 'Survival'],
  Hermit:      ['Medicine', 'Religion'],
  Merchant:    ['Animal Handling', 'Persuasion'],
  Noble:       ['History', 'Persuasion'],
  Sage:        ['Arcana', 'History'],
  Sailor:      ['Acrobatics', 'Perception'],
  Scribe:      ['Investigation', 'Perception'],
  Soldier:     ['Athletics', 'Intimidation'],
  Wayfarer:    ['Insight', 'Stealth'],
};

// empty skills array = any skill allowed
export const CLASS_SKILLS: Record<string, { skills: string[]; count: number }> = {
  Artificer:  { count: 2, skills: ['Arcana', 'History', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Sleight of Hand'] },
  Barbarian:  { count: 2, skills: ['Animal Handling', 'Athletics', 'Intimidation', 'Nature', 'Perception', 'Survival'] },
  Bard:       { count: 3, skills: [] },
  Cleric:     { count: 2, skills: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'] },
  Druid:      { count: 2, skills: ['Arcana', 'Animal Handling', 'Insight', 'Medicine', 'Nature', 'Perception', 'Religion', 'Survival'] },
  Fighter:    { count: 2, skills: ['Acrobatics', 'Animal Handling', 'Athletics', 'History', 'Insight', 'Intimidation', 'Perception', 'Survival'] },
  Monk:       { count: 2, skills: ['Acrobatics', 'Athletics', 'History', 'Insight', 'Religion', 'Stealth'] },
  Paladin:    { count: 2, skills: ['Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion'] },
  Ranger:     { count: 3, skills: ['Animal Handling', 'Athletics', 'Insight', 'Investigation', 'Nature', 'Perception', 'Stealth', 'Survival'] },
  Rogue:      { count: 4, skills: ['Acrobatics', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Perception', 'Performance', 'Persuasion', 'Sleight of Hand', 'Stealth'] },
  Sorcerer:   { count: 2, skills: ['Arcana', 'Deception', 'Insight', 'Intimidation', 'Persuasion', 'Religion'] },
  Warlock:    { count: 2, skills: ['Arcana', 'Deception', 'History', 'Intimidation', 'Investigation', 'Nature', 'Religion'] },
  Wizard:     { count: 2, skills: ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion'] },
};

// ── Origin Feats (Human Versatile + chooseable) ───────────────────────────────

export const ORIGIN_FEATS = [
  'Alert', 'Crafter', 'Healer', 'Lucky',
  'Magic Initiate (Cleric)', 'Magic Initiate (Druid)', 'Magic Initiate (Wizard)',
  'Musician', 'Savage Attacker', 'Skilled', 'Tavern Brawler', 'Tough',
];

export interface ShopItem {
  id: string;
  name: string;
  cost: number;
  description: string;
  // weapon fields — stored to inventory verbatim when bought
  type?: string;
  damage?: string;
  damageType?: string;
  attackBonus?: number;
  range?: number;
  extendedRange?: number;
  // armor fields — stored to inventory verbatim when bought
  armorType?: 'light' | 'medium' | 'heavy' | 'none';
  acBonus?: number;
  isShield?: boolean;
  slot?: 'head' | 'body' | 'gloves' | 'boots';
  properties?: string[];
  isFinesse?: boolean;
  mastery?: string;
  iconPath?: string;
  twoHanded?: boolean;
  quantityPerPurchase?: number;
  ammoSlug?: string;
  usableBySlug?: string;
  lightEmissionRangeFt?: number;
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'longsword',         name: 'Longsword',          cost: 15, description: '1d8 slashing. Versatile (1d10).',                  type: 'weapon', damage: '1d8', damageType: 'slashing',  attackBonus: 0, range:  5, properties: ['versatile', 'martial'] },
  { id: 'shield',            name: 'Shield',              cost: 10, description: '+2 AC bonus.',                                                                            type: 'armor', armorType: 'none', acBonus: 2,  isShield: true },
  { id: 'handaxe',           name: 'Handaxe',             cost:  5, description: '1d6 slashing. Light, thrown (20/60 ft).',          type: 'weapon', damage: '1d6', damageType: 'slashing',  attackBonus: 0, range:  5, properties: ['light', 'thrown', 'simple'] },
  { id: 'leather-armour',    name: 'Leather Armour',      cost: 10, description: 'AC 11 + DEX modifier. Light armor.',                                            type: 'armor', armorType: 'light', acBonus: 11, isShield: false, slot: 'body' },
  { id: 'potion-of-healing', name: 'Potion of Healing',   cost: 50, description: 'Restores 2d4+4 HP.' },
  { id: 'shortbow',          name: 'Shortbow',            cost: 25, description: '1d6 piercing. Ammunition (arrow), two-handed. Range 80/320 ft.', type: 'weapon', damage: '1d6', damageType: 'piercing', attackBonus: 0, range: 80, extendedRange: 320, properties: ['ammunition', 'two-handed', 'simple'], mastery: 'Vex', twoHanded: true, ammoSlug: 'arrow' },
  { id: 'arrows',            name: 'Arrow',               cost:  1, description: 'Ammunition for shortbows and longbows (batch of 20).', type: 'ammunition', quantityPerPurchase: 20, usableBySlug: 'arrow' },
  { id: 'whip',              name: 'Whip',                cost:  2, description: '1d4 slashing. Finesse, Reach (10 ft).',              type: 'weapon', damage: '1d4', damageType: 'slashing',  attackBonus: 0, range: 10, properties: ['finesse', 'reach', 'martial'], isFinesse: true, mastery: 'Slow' },
  { id: 'scale-mail',        name: 'Scale Mail',          cost: 50, description: 'AC 14 + DEX modifier (max 2). Medium armor.',                                          type: 'armor', armorType: 'medium', acBonus: 14, isShield: false, slot: 'body' },
  { id: 'chain-mail',        name: 'Chain Mail',          cost: 75, description: 'AC 16. Heavy armor.',                                                                  type: 'armor', armorType: 'heavy',  acBonus: 16, isShield: false, slot: 'body' },
  { id: 'dagger',            name: 'Dagger',              cost:  2, description: '1d4 piercing. Finesse, light, thrown (20/60 ft).', type: 'weapon', damage: '1d4', damageType: 'piercing', attackBonus: 0, range: 5, extendedRange: 60, properties: ['finesse', 'light', 'thrown', 'simple'], isFinesse: true },
  { id: 'warhammer',         name: 'Warhammer',           cost: 15, description: '1d8 bludgeoning. Versatile (1d10).',               type: 'weapon', damage: '1d8', damageType: 'bludgeoning', attackBonus: 0, range: 5, properties: ['versatile', 'martial'] },
  { id: 'torch',             name: 'Torch',               cost:  1, description: '1d4 bludgeoning. Light, simple. Sheds light in a 20-foot radius while held.', type: 'weapon', damage: '1d4', damageType: 'bludgeoning', attackBonus: 0, range: 5, properties: ['light', 'simple'], lightEmissionRangeFt: 20 },
  { id: 'healers-kit',       name: "Healer's Kit",       cost:  5, description: 'Origin feat Healer: tend a creature within 5ft for HP (batch of 10 uses).', type: 'consumable', quantityPerPurchase: 10 },
  { id: 'lockpick',          name: 'Lockpick',           cost:  5, description: 'Consumed on use. Rolls a DEX (Thieves\' Tools) check against a locked door within 5ft — success unlocks it (batch of 5).', type: 'consumable', quantityPerPurchase: 5 },
  { id: 'trap-disarm-kit',   name: 'Trap Disarm Kit',    cost: 10, description: 'Consumed on use. Rolls a DEX (Thieves\' Tools) check against a discovered trap within 5ft — success removes it safely (batch of 3).', type: 'consumable', quantityPerPurchase: 3 },
  { id: 'greataxe',          name: 'Greataxe',            cost: 30, description: '1d12 slashing. Heavy, two-handed.',                type: 'weapon', damage: '1d12', damageType: 'slashing', attackBonus: 0, range: 5, properties: ['heavy', 'two-handed', 'martial'], twoHanded: true },
];

export const ORIGIN_FEAT_DETAILS: Record<string, BackgroundFeat> = {
  'Alert':                    { name: "Alert", description: "You can add your Proficiency Bonus to Initiative rolls. Immediately after you roll Initiative, you can swap it with a willing ally's in the same combat (neither of you can be Incapacitated)." },
  'Crafter':                  { name: "Crafter", description: "You gain proficiency with three Artisan's Tools of your choice, receive a 20% discount when purchasing nonmagical items, and can craft one item from the Fast Crafting table when you finish a Long Rest (if you're proficient with the tool it requires). The item lasts until you finish another Long Rest, then falls apart." },
  'Healer':                   { name: "Healer", description: "As a Utilize action, expend a use of a Healer's Kit to tend a creature within 5 feet. That creature spends one of its Hit Point Dice, which you roll — it regains HP equal to the roll plus your Proficiency Bonus. Any die rolled to restore HP this way or with a spell can be rerolled once if it comes up 1." },
  'Lucky':                    { name: "Lucky", description: "You have a number of Luck Points equal to your Proficiency Bonus. Spend one when you roll a d20 for a D20 Test to give yourself Advantage on it, or when a creature makes an attack roll against you to impose Disadvantage on it. Luck Points refresh on a Long Rest." },
  'Magic Initiate (Cleric)':  { name: "Magic Initiate (Cleric)", description: "You learn two Cleric cantrips and one 1st-level Cleric spell, castable once per Long Rest without a spell slot. Wisdom is your spellcasting ability." },
  'Magic Initiate (Druid)':   { name: "Magic Initiate (Druid)", description: "You learn two Druid cantrips and one 1st-level Druid spell, castable once per Long Rest without a spell slot. Wisdom is your spellcasting ability." },
  'Magic Initiate (Wizard)':  { name: "Magic Initiate (Wizard)", description: "You learn two Wizard cantrips and one 1st-level Wizard spell, castable once per Long Rest without a spell slot. Intelligence is your spellcasting ability." },
  'Musician':                 { name: "Musician", description: "You gain proficiency with three Musical Instruments. As you finish a Short or Long Rest, you can play one and give Heroic Inspiration to a number of allies who hear it equal to your Proficiency Bonus." },
  'Savage Attacker':          { name: "Savage Attacker", description: "Once per turn when you hit with a weapon, roll the damage dice twice and use either total." },
  'Skilled':                  { name: "Skilled", description: "You gain proficiency in any combination of three skills or tools of your choice." },
  'Tavern Brawler':           { name: "Tavern Brawler", description: "Your unarmed strikes deal 1d4 + STR bludgeoning damage instead of the normal amount, and the damage die can be rerolled once if it comes up 1. You're proficient with improvised weapons. Once per turn, when you hit with an unarmed strike as part of the Attack action, you can also push the target 5 feet away." },
  'Tough':                    { name: "Tough", description: "Your hit point maximum increases by 2 for every character level you have, and increases by 2 again each time you gain a level." },
};

export { BACKGROUND_FEAT } from 'shared';

// ── Spell allowances at level 1 ───────────────────────────────────────────────
// cantrips: max cantrips learnable; spells: max 1st-level spells learnable.
// Classes not listed (Barbarian, Fighter, Monk, Rogue) have no spellcasting at level 1.
export interface SpellAllowance { cantrips: number; spells: number; spellLevels: number[] }

export const CLASS_SPELL_ALLOWANCE: Record<string, SpellAllowance> = {
  Artificer: { cantrips: 2, spells: 2, spellLevels: [1] },
  Bard:      { cantrips: 2, spells: 4, spellLevels: [1] },
  Cleric:    { cantrips: 3, spells: 2, spellLevels: [1] },
  Druid:     { cantrips: 2, spells: 2, spellLevels: [1] },
  Paladin:   { cantrips: 0, spells: 2, spellLevels: [1] },
  Ranger:    { cantrips: 0, spells: 2, spellLevels: [1] },
  Sorcerer:  { cantrips: 4, spells: 2, spellLevels: [1] },
  Warlock:   { cantrips: 2, spells: 2, spellLevels: [1] },
  Wizard:    { cantrips: 3, spells: 6, spellLevels: [1] },
};

export { FEAT_SPELL_GRANTS } from 'shared';
