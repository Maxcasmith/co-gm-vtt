export const SPECIES = [
  'Aasimar', 'Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath',
  'Half-Elf', 'Half-Orc', 'Halfling', 'Human', 'Orc', 'Tiefling',
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
  "Half-Elf": [
    { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light." },
    { name: "Fey Ancestry", description: "You have Advantage on saving throws against the Charmed condition." },
    { name: "Skill Versatility", description: "You gain proficiency in two skills of your choice." },
  ],
  "Half-Orc": [
    { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light." },
    { name: "Menacing", description: "You gain proficiency in the Intimidation skill." },
    { name: "Relentless Endurance", description: "When you are reduced to 0 Hit Points but not killed outright, you can drop to 1 Hit Point instead. Once you use this trait you can't do so again until you finish a Long Rest." },
    { name: "Savage Attacks", description: "When you score a critical hit with a melee weapon attack, you can roll one of the weapon's damage dice one additional time and add it to the extra damage of the critical hit." },
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

export const BACKGROUND_FEAT: Record<string, BackgroundFeat> = {
  Acolyte:    { name: "Magic Initiate (Cleric)", description: "You learn two cantrips and one 1st-level spell from the Cleric spell list. You can cast the 1st-level spell once per Long Rest without a spell slot, or use spell slots if you have them. Wisdom is your spellcasting ability for these spells." },
  Artisan:    { name: "Crafter", description: "You gain proficiency with three Artisan's Tools of your choice. Whenever you buy a non-magical item, you receive a 20% discount. You can also craft items faster using your proficient tools." },
  Charlatan:  { name: "Skilled", description: "You gain proficiency in three skills of your choice." },
  Criminal:   { name: "Alert", description: "You gain a +5 bonus to Initiative rolls and you can't be surprised while conscious." },
  Entertainer:{ name: "Musician", description: "You gain proficiency with three Musical Instruments of your choice. You can use a Musical Instrument as a Spellcasting Focus. Creatures who hear you play for at least 1 minute gain Heroic Inspiration, up to your Proficiency Bonus per Long Rest." },
  Farmer:     { name: "Tough", description: "Your hit point maximum increases by 2 for every character level you have, and it increases by 2 again each time you gain a level." },
  Guard:      { name: "Alert", description: "You gain a +5 bonus to Initiative rolls and you can't be surprised while conscious." },
  Guide:      { name: "Magic Initiate (Druid)", description: "You learn two cantrips and one 1st-level spell from the Druid spell list. You can cast the 1st-level spell once per Long Rest without a spell slot. Wisdom is your spellcasting ability for these spells." },
  Hermit:     { name: "Magic Initiate (Druid)", description: "You learn two cantrips and one 1st-level spell from the Druid spell list. You can cast the 1st-level spell once per Long Rest without a spell slot. Wisdom is your spellcasting ability for these spells." },
  Merchant:   { name: "Lucky", description: "You have 3 Luck Points. Whenever you make an attack roll, ability check, or saving throw, you can spend 1 Luck Point to roll an additional d20 and choose which die to use. You regain expended Luck Points when you finish a Long Rest." },
  Noble:      { name: "Skilled", description: "You gain proficiency in three skills of your choice." },
  Sage:       { name: "Magic Initiate (Wizard)", description: "You learn two cantrips and one 1st-level spell from the Wizard spell list. You can cast the 1st-level spell once per Long Rest without a spell slot. Intelligence is your spellcasting ability for these spells." },
  Sailor:     { name: "Lucky", description: "You have 3 Luck Points. Whenever you make an attack roll, ability check, or saving throw, you can spend 1 Luck Point to roll an additional d20 and choose which die to use. You regain expended Luck Points when you finish a Long Rest." },
  Scribe:     { name: "Skilled", description: "You gain proficiency in three skills of your choice." },
  Soldier:    { name: "Savage Attacker", description: "Once per turn when you hit a target with a weapon attack, you can roll the weapon's damage dice twice and use either total." },
  Wayfarer:   { name: "Lucky", description: "You have 3 Luck Points. Whenever you make an attack roll, ability check, or saving throw, you can spend 1 Luck Point to roll an additional d20 and choose which die to use. You regain expended Luck Points when you finish a Long Rest." },
};

// ── Classes ───────────────────────────────────────────────────────────────────

export const HIT_DICE: Record<string, number> = {
  Artificer: 8,  Barbarian: 12, Bard: 8,      Cleric: 8,  Druid: 8,
  Fighter: 10,   Monk: 8,       Paladin: 10,   Ranger: 10, Rogue: 8,
  Sorcerer: 6,   Warlock: 8,    Wizard: 6,
};

export interface ClassFeature { name: string; description: string }

export const CLASS_FEATURES: Record<string, ClassFeature[]> = {
  Artificer: [
    { name: "Magical Tinkering", description: "You can use your tools to imbue a Tiny nonmagical object with one of several minor magical properties, such as shedding light, emitting a recorded message, or producing an odor." },
    { name: "Spellcasting", description: "You've studied the workings of magic and can cast Artificer spells. Intelligence is your spellcasting ability. You prepare spells from the Artificer spell list each long rest." },
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
    { name: "Lay on Hands", description: "You have a pool of healing power equal to 5 x your Paladin level. As an action you can touch a creature to restore any number of hit points from your pool, or expend 5 points to cure one disease or poison." },
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

export const CLASS_SAVING_THROWS: Record<string, [StatName, StatName]> = {
  Artificer:  ['INT', 'CON'],
  Barbarian:  ['STR', 'CON'],
  Bard:       ['DEX', 'CHA'],
  Cleric:     ['WIS', 'CHA'],
  Druid:      ['INT', 'WIS'],
  Fighter:    ['STR', 'CON'],
  Monk:       ['STR', 'DEX'],
  Paladin:    ['WIS', 'CHA'],
  Ranger:     ['STR', 'DEX'],
  Rogue:      ['DEX', 'INT'],
  Sorcerer:   ['CON', 'CHA'],
  Warlock:    ['WIS', 'CHA'],
  Wizard:     ['INT', 'WIS'],
};

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
  properties?: string[];
  isFinesse?: boolean;
  mastery?: string;
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'longsword',         name: 'Longsword',          cost: 15, description: '1d8 slashing. Versatile (1d10).',                  type: 'weapon', damage: '1d8', damageType: 'slashing',  attackBonus: 0, range:  5, properties: ['versatile', 'martial'] },
  { id: 'shield',            name: 'Shield',              cost: 10, description: '+2 AC bonus.' },
  { id: 'handaxe',           name: 'Handaxe',             cost:  5, description: '1d6 slashing. Light, thrown (20/60 ft).',          type: 'weapon', damage: '1d6', damageType: 'slashing',  attackBonus: 0, range:  5, properties: ['light', 'thrown', 'simple'] },
  { id: 'leather-armour',    name: 'Leather Armour',      cost: 10, description: 'AC 11 + DEX modifier.' },
  { id: 'potion-of-healing', name: 'Potion of Healing',   cost: 50, description: 'Restores 2d4+2 HP.' },
  { id: 'shortbow',          name: 'Shortbow',            cost: 25, description: '1d6 piercing. Ammunition (arrow), two-handed. Range 80/320 ft.', type: 'weapon', damage: '1d6', damageType: 'piercing', attackBonus: 0, range: 80, extendedRange: 320, properties: ['ammunition', 'two-handed', 'simple'], mastery: 'Vex' },
  { id: 'arrows',            name: 'Arrows (20)',         cost:  1, description: 'Ammunition for shortbows and longbows. Bundle of 20.' },
];

export const ORIGIN_FEAT_DETAILS: Record<string, BackgroundFeat> = {
  'Alert':                    { name: "Alert", description: "You gain a +5 bonus to Initiative rolls and you can't be surprised while conscious." },
  'Crafter':                  { name: "Crafter", description: "You gain proficiency with three Artisan's Tools of your choice and receive a 20% discount when purchasing nonmagical items." },
  'Healer':                   { name: "Healer", description: "You can use a Healer's Kit as a Bonus Action to stabilize a creature at 0 HP. When you use a Healer's Kit to restore HP, the target also regains 1d6 + 4 additional HP." },
  'Lucky':                    { name: "Lucky", description: "You have 3 Luck Points. Spend one to roll an extra d20 on any attack roll, ability check, or saving throw and choose which die to use. Luck Points refresh on a Long Rest." },
  'Magic Initiate (Cleric)':  { name: "Magic Initiate (Cleric)", description: "You learn two Cleric cantrips and one 1st-level Cleric spell, castable once per Long Rest without a spell slot. Wisdom is your spellcasting ability." },
  'Magic Initiate (Druid)':   { name: "Magic Initiate (Druid)", description: "You learn two Druid cantrips and one 1st-level Druid spell, castable once per Long Rest without a spell slot. Wisdom is your spellcasting ability." },
  'Magic Initiate (Wizard)':  { name: "Magic Initiate (Wizard)", description: "You learn two Wizard cantrips and one 1st-level Wizard spell, castable once per Long Rest without a spell slot. Intelligence is your spellcasting ability." },
  'Musician':                 { name: "Musician", description: "You gain proficiency with three Musical Instruments. Creatures who hear you play for 1 minute gain Heroic Inspiration (up to your Proficiency Bonus per Long Rest)." },
  'Savage Attacker':          { name: "Savage Attacker", description: "Once per turn when you hit with a weapon, roll the damage dice twice and use either total." },
  'Skilled':                  { name: "Skilled", description: "You gain proficiency in three skills of your choice." },
  'Tavern Brawler':           { name: "Tavern Brawler", description: "Your unarmed strikes deal 1d4 + STR damage. You can use improvised weapons. Once per turn when you hit with an unarmed strike or improvised weapon, you can attempt to grapple as a Bonus Action." },
  'Tough':                    { name: "Tough", description: "Your hit point maximum increases by 2 for every character level you have, and increases by 2 again each time you gain a level." },
};
