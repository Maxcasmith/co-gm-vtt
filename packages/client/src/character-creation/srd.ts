import type { AbilityKey } from "shared";
import { CLASS_SAVING_THROWS as CLASS_SAVING_THROWS_SHARED } from "shared";

export const SPECIES = [
  "Aasimar",
  "Dragonborn",
  "Dwarf",
  "Elf",
  "Gnome",
  "Goliath",
  "Halfling",
  "Human",
  "Orc",
  "Tiefling",
];

export const BACKGROUNDS = [
  "Acolyte",
  "Artisan",
  "Charlatan",
  "Criminal",
  "Entertainer",
  "Farmer",
  "Guard",
  "Guide",
  "Hermit",
  "Merchant",
  "Noble",
  "Sage",
  "Sailor",
  "Scribe",
  "Soldier",
  "Wayfarer",
];

export const CLASSES = [
  "Artificer",
  "Barbarian",
  "Bard",
  "Cleric",
  "Druid",
  "Fighter",
  "Monk",
  "Paladin",
  "Ranger",
  "Rogue",
  "Sorcerer",
  "Warlock",
  "Wizard",
];

export const STAT_NAMES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type StatName = (typeof STAT_NAMES)[number];

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const POINT_BUY_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};

// ── Species ───────────────────────────────────────────────────────────────────

export const SPECIES_SUBSPECIES: Record<string, string[]> = {
  Dragonborn: ["Chromatic", "Gem", "Metallic"],
  Elf: ["Drow", "High Elf", "Wood Elf"],
  Gnome: ["Forest Gnome", "Rock Gnome"],
  Tiefling: ["Abyssal", "Chthonic", "Infernal"],
};

// TODO: Max isn't happy with the current wording of SPECIES_BLURBS, SPECIES_PLAIN_PERKS,
// CLASS_BLURBS, and CLASS_PLAIN_PERKS below — revisit and rewrite these later.
export const SPECIES_BLURBS: Record<string, string> = {
  Aasimar:
    "Aasimar carry a spark of celestial power in their blood, quite literally touched by something otherworldly and divine.",
  Dragonborn:
    "Dragonborn are the descendants of dragons, proud and honor-bound, and yes, they can breathe elemental energy just like the real thing.",
  Dwarf:
    "Dwarves are stout, hardy, and built to outlast pretty much anything — mountains, poison, you name it.",
  Elf: "Elves are graceful, long-lived, and come in a few distinct flavors, each with their own trick up their sleeve.",
  Gnome:
    "Gnomes are small, clever, and endlessly curious, with a natural knack for magic and mischief.",
  Goliath:
    "Goliaths are towering mountain-dwellers built for extremes, all raw physical presence and endurance.",
  Halfling:
    "Halflings are small, lucky, and easy to underestimate — which usually works out just fine for them.",
  Human:
    "Humans don't get a flashy gimmick, they just adapt to anything and pick up an extra edge wherever they need it.",
  Orc: "Orcs are relentless and hard to put down, channeling their endurance into short bursts of unstoppable action.",
  Tiefling:
    "Tieflings carry a bit of fiendish or otherworldly blood, and it shows up as a handful of useful innate magic.",
};

// Plain-English perk summaries for beginners — no rules jargon (no "long rest", "saving throw", etc).
// Keep separate from SPECIES_FEATURES below, which stays rules-accurate for the character sheet.
export const SPECIES_PLAIN_PERKS: Record<string, string[]> = {
  Aasimar: [
    "You're naturally resistant to negative-energy and radiant damage.",
    "You can see in the dark.",
    "You can heal a creature by touch once a day.",
    "You know a simple spell that creates light.",
    "At higher levels, you can transform temporarily to unleash a burst of holy power.",
  ],
  Dragonborn: [
    "You can see in the dark.",
    "You pick a damage type — fire, poison, lightning, take your pick — tied to your draconic bloodline.",
    "You can unleash a breath weapon that hits a wide area with that damage type, a few times a day.",
    "You're naturally resistant to that same damage type.",
  ],
  Dwarf: [
    "You can see in the dark, further than most.",
    "You're highly resistant to poison, including being poisoned outright.",
    "You get a small pool of extra hit points that grows as you level up.",
    "You can sense vibrations through stone to detect what's nearby.",
  ],
  Elf: [
    "You can see in the dark.",
    "You're hard to charm or magically manipulate.",
    "You're naturally perceptive — you notice things others miss.",
    "You don't sleep the normal way, you rest in a short meditative trance instead.",
  ],
  Gnome: [
    "You can see in the dark.",
    "You're naturally resistant to having your mind magically controlled or read.",
  ],
  Goliath: [
    "You inherit a unique power from a legendary giant bloodline.",
    "At higher levels, you can grow to a larger size for a short time.",
    "You can carry and lift far more than your size would suggest.",
    "You can shrug off part of an incoming hit once a day.",
  ],
  Halfling: [
    "You're hard to frighten.",
    "You can slip past larger creatures without any trouble.",
    "Whenever you roll the worst possible result, you get to try again.",
    "You can duck out of sight behind allies or objects bigger than you.",
  ],
  Human: [
    "You start each day with a bit of good luck you can call on when it matters.",
    "You get an extra skill to be good at.",
    "You get an extra special ability, an Origin feat of your choice.",
  ],
  Orc: [
    "You can burst into a sprint and shrug off a bit of extra damage while doing it, a few times a day.",
    "You can see in the dark, further than most.",
    "You can carry and lift far more than your size would suggest.",
    "Once a day, you can survive a hit that would otherwise knock you out.",
  ],
  Tiefling: [
    "You can see in the dark.",
    "You pick a fiendish bloodline that grants resistance to a damage type.",
    "You learn a few innate spells tied to that bloodline as you level up.",
  ],
};

export interface SpeciesFeature {
  name: string;
  description: string;
}

export const SPECIES_FEATURES: Record<string, SpeciesFeature[]> = {
  Aasimar: [
    {
      name: "Celestial Resistance",
      description: "You have Resistance to Necrotic and Radiant damage.",
    },
    {
      name: "Darkvision",
      description:
        "You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.",
    },
    {
      name: "Healing Hands",
      description:
        "As a Magic action, you can touch a creature and restore a number of Hit Points equal to your Proficiency Bonus. Once you use this trait you can't do so again until you finish a Long Rest.",
    },
    {
      name: "Light Bearer",
      description:
        "You know the Light cantrip. Charisma is your spellcasting ability for it.",
    },
    {
      name: "Celestial Revelation",
      description:
        "When you reach 3rd level, choose Necrotic Shroud, Radiant Consumption, or Radiant Soul. This transformation manifests as wings and an aura for 1 minute, granting bonus effects once per Long Rest.",
    },
  ],
  Dragonborn: [
    {
      name: "Darkvision",
      description:
        "You can see in dim light within 60 feet as if it were bright light.",
    },
    {
      name: "Draconic Ancestry",
      description:
        "Your lineage grants a damage type: Chromatic (acid/lightning/poison/fire/cold), Gem (psychic/radiant/thunder/force/necrotic), or Metallic (fire/cold, with secondary effects).",
    },
    {
      name: "Breath Weapon",
      description:
        "When you take the Attack action, you can replace one attack with an exhalation of magical energy in a 15-foot cone or 30-foot line. Each creature in that area must make a Dexterity saving throw (DC = 8 + CON modifier + proficiency bonus). Damage equals 1d10 per two character levels.",
    },
    {
      name: "Damage Resistance",
      description:
        "You have Resistance to the damage type associated with your Draconic Ancestry.",
    },
  ],
  Chromatic: [
    {
      name: "Chromatic Warding",
      description:
        "Starting at 5th level, as an action you can channel your draconic power to grant yourself immunity to the damage type of your Chromatic Ancestry for 10 minutes, once per Long Rest.",
    },
  ],
  Gem: [
    {
      name: "Psionic Mind",
      description:
        "You can send telepathic messages to any creature you can see within 30 feet. The creature doesn't need to share a language, but must be able to understand at least one language.",
    },
    {
      name: "Gem Flight",
      description:
        "Starting at 5th level, as a Bonus Action you sprout spectral wings and gain a Fly Speed equal to your Speed for 1 minute, once per Long Rest.",
    },
  ],
  Metallic: [
    {
      name: "Metallic Breath Weapon",
      description:
        "When you use your Breath Weapon, you can use this alternate form: creatures must succeed on a Constitution saving throw or become Incapacitated (Enervating Breath) or Frightened (Repulsion Breath) until the start of your next turn.",
    },
  ],
  Dwarf: [
    {
      name: "Darkvision",
      description:
        "You can see in dim light within 120 feet as if it were bright light.",
    },
    {
      name: "Dwarven Resilience",
      description:
        "You have Advantage on saving throws against the Poisoned condition, and you have Resistance to Poison damage.",
    },
    {
      name: "Dwarven Toughness",
      description:
        "Your hit point maximum increases by 1, and it increases by 1 again whenever you gain a level.",
    },
    {
      name: "Stonecunning",
      description:
        "As a Bonus Action you gain Tremorsense of 60 feet for 10 minutes, detecting vibrations in stone. You can use this trait a number of times equal to your Proficiency Bonus per Long Rest.",
    },
  ],
  Elf: [
    {
      name: "Darkvision",
      description:
        "You can see in dim light within 60 feet as if it were bright light.",
    },
    {
      name: "Fey Ancestry",
      description:
        "You have Advantage on saving throws you make to avoid or end the Charmed condition.",
    },
    {
      name: "Keen Senses",
      description: "You have proficiency in the Perception skill.",
    },
    {
      name: "Trance",
      description:
        "You don't need to sleep. Instead you meditate for 4 hours per day, after which you gain the same benefit as a Human from 8 hours of sleep.",
    },
  ],
  Drow: [
    {
      name: "Superior Darkvision",
      description: "Your Darkvision has a range of 120 feet.",
    },
    {
      name: "Drow Magic",
      description:
        "You know the Dancing Lights cantrip. At 3rd level you learn Faerie Fire, and at 5th level Darkness. Each can be cast once per Long Rest without a spell slot, or with any spell slots you have.",
    },
  ],
  "High Elf": [
    {
      name: "High Elf Magic",
      description:
        "You know the Prestidigitation cantrip. Whenever you finish a Long Rest, you can replace it with a different Wizard cantrip. At 3rd level you learn Detect Magic, and at 5th level Misty Step. Each can be cast once per Long Rest without a spell slot, or with any spell slots you have.",
    },
  ],
  "Wood Elf": [
    { name: "Fleet of Foot", description: "Your Speed increases to 35 feet." },
    {
      name: "Wood Elf Magic",
      description:
        "You know the Druidcraft cantrip. At 3rd level you learn Longstrider, and at 5th level Pass without Trace. Each can be cast once per Long Rest without a spell slot, or with any spell slots you have.",
    },
  ],
  Gnome: [
    {
      name: "Darkvision",
      description:
        "You can see in dim light within 60 feet as if it were bright light.",
    },
    {
      name: "Gnomish Cunning",
      description:
        "You have Advantage on Intelligence, Wisdom, and Charisma saving throws.",
    },
  ],
  "Forest Gnome": [
    {
      name: "Forest Gnome Magic",
      description:
        "You know the Minor Illusion cantrip. You always have Speak with Animals prepared, and can cast it without a spell slot a number of times equal to your Proficiency Bonus per Long Rest.",
    },
  ],
  "Rock Gnome": [
    {
      name: "Rock Gnome Magic",
      description:
        "You know the Mending and Prestidigitation cantrips. You can spend 10 minutes casting Prestidigitation to create a Tiny clockwork device (AC 5, 1 HP) that produces one of Prestidigitation's effects when activated. You can have up to three at a time, and each falls apart after 8 hours.",
    },
  ],
  Goliath: [
    {
      name: "Giant Ancestry",
      description:
        "You are descended from giants. Choose one giant type (Cloud, Fire, Frost, Hill, Stone, or Storm) to determine your Giant Legacy trait, which you can use once per Long Rest.",
    },
    {
      name: "Large Form",
      description:
        "Starting at 5th level, as a Bonus Action you become Large for 1 minute. While Large, you have Advantage on Strength checks and your Speed increases by 10 feet.",
    },
    {
      name: "Powerful Build",
      description:
        "You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift.",
    },
    {
      name: "Stone's Endurance",
      description:
        "When you take damage, you can use your Reaction to roll a d12. Add your Constitution modifier to the number rolled and reduce the damage by that total. Once used, you must finish a Short or Long Rest.",
    },
  ],
  Halfling: [
    {
      name: "Brave",
      description:
        "You have Advantage on saving throws you make to avoid or end the Frightened condition.",
    },
    {
      name: "Halfling Nimbleness",
      description:
        "You can move through the space of any creature that is of a size larger than yours.",
    },
    {
      name: "Lucky",
      description:
        "When you roll a 1 on the d20 for an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll.",
    },
    {
      name: "Naturally Stealthy",
      description:
        "You can attempt to Hide even when obscured only by a creature that is at least one size larger than you.",
    },
  ],
  Human: [
    {
      name: "Resourceful",
      description:
        "You gain Heroic Inspiration whenever you finish a Long Rest.",
    },
    {
      name: "Skillful",
      description: "You gain proficiency in one skill of your choice.",
    },
    {
      name: "Versatile",
      description: "You gain an Origin feat of your choice.",
    },
  ],
  Orc: [
    {
      name: "Adrenaline Rush",
      description:
        "You can take the Dash action as a Bonus Action. When you do, you gain a number of Temporary Hit Points equal to your Proficiency Bonus. You can use this trait a number of times equal to your Proficiency Bonus per Long Rest.",
    },
    {
      name: "Darkvision",
      description:
        "You can see in dim light within 120 feet as if it were bright light.",
    },
    {
      name: "Powerful Build",
      description:
        "You count as one size larger when determining carrying capacity and weight you can push, drag, or lift.",
    },
    {
      name: "Relentless Endurance",
      description:
        "When you are reduced to 0 Hit Points but not killed outright, you can drop to 1 Hit Point instead, once per Long Rest.",
    },
  ],
  Tiefling: [
    {
      name: "Darkvision",
      description:
        "You can see in dim light within 60 feet as if it were bright light.",
    },
    {
      name: "Fiendish Legacy",
      description:
        "You have a supernatural connection to one of three fiendish realms. Choose Abyssal, Chthonic, or Infernal to determine your resistance and innate spells. Each legacy spell can be cast once per Long Rest without a spell slot, or with any spell slots you have.",
    },
    {
      name: "Otherworldly Presence",
      description: "You know the Thaumaturgy cantrip.",
    },
  ],
  Abyssal: [
    {
      name: "Abyssal Legacy",
      description:
        "You have Resistance to Poison damage, and you know the Poison Spray cantrip. At 3rd level you learn Ray of Sickness, and at 5th level Hold Person.",
    },
  ],
  Chthonic: [
    {
      name: "Chthonic Legacy",
      description:
        "You have Resistance to Necrotic damage, and you know the Chill Touch cantrip. At 3rd level you learn False Life, and at 5th level Ray of Enfeeblement.",
    },
  ],
  Infernal: [
    {
      name: "Infernal Legacy",
      description:
        "You have Resistance to Fire damage, and you know the Fire Bolt cantrip. At 3rd level you learn Hellish Rebuke, and at 5th level Darkness.",
    },
  ],
};

/**
 * Cantrips a species/lineage grants (2024 PHB), keyed by lineage when the species has one.
 * Auto-learned when the lineage is picked (SpeciesTab), under their own `label` pool in the
 * Spells step. `cantrips` are the defaults; with `forClass` any cantrip from that class list can
 * replace them (High Elf), otherwise the defaults are the only eligible picks. Tiefling's
 * Otherworldly Presence (Thaumaturgy) is folded into each legacy.
 */
export const SPECIES_SPELL_GRANTS: Record<string, { label: string; cantrips: string[]; forClass?: string }> = {
  Aasimar:        { label: "Aasimar", cantrips: ["Light"] },
  "High Elf":     { label: "High Elf (Wizard)", cantrips: ["Prestidigitation"], forClass: "Wizard" },
  Drow:           { label: "Drow", cantrips: ["Dancing Lights"] },
  "Wood Elf":     { label: "Wood Elf", cantrips: ["Druidcraft"] },
  "Forest Gnome": { label: "Forest Gnome", cantrips: ["Minor Illusion"] },
  "Rock Gnome":   { label: "Rock Gnome", cantrips: ["Mending", "Prestidigitation"] },
  Abyssal:        { label: "Abyssal Tiefling", cantrips: ["Poison Spray", "Thaumaturgy"] },
  Chthonic:       { label: "Chthonic Tiefling", cantrips: ["Chill Touch", "Thaumaturgy"] },
  Infernal:       { label: "Infernal Tiefling", cantrips: ["Fire Bolt", "Thaumaturgy"] },
};

export function speciesSpellGrant(species: string, subspecies: string) {
  return SPECIES_SPELL_GRANTS[subspecies] ?? SPECIES_SPELL_GRANTS[species];
}

// ── Backgrounds ───────────────────────────────────────────────────────────────

export const BACKGROUND_ASI: Record<string, StatName[]> = {
  Acolyte: ["INT", "WIS", "CHA"],
  Artisan: ["STR", "DEX", "INT"],
  Charlatan: ["DEX", "CON", "CHA"],
  Criminal: ["DEX", "CON", "INT"],
  Entertainer: ["STR", "DEX", "CHA"],
  Farmer: ["STR", "CON", "WIS"],
  Guard: ["STR", "INT", "CHA"],
  Guide: ["DEX", "CON", "WIS"],
  Hermit: ["CON", "INT", "WIS"],
  Merchant: ["CON", "INT", "CHA"],
  Noble: ["STR", "INT", "CHA"],
  Sage: ["CON", "INT", "WIS"],
  Sailor: ["STR", "DEX", "CON"],
  Scribe: ["DEX", "INT", "WIS"],
  Soldier: ["STR", "DEX", "CON"],
  Wayfarer: ["DEX", "WIS", "CHA"],
};

export interface BackgroundFeat {
  name: string;
  description: string;
}

// ── Classes ───────────────────────────────────────────────────────────────────

export const HIT_DICE: Record<string, number> = {
  Artificer: 8,
  Barbarian: 12,
  Bard: 8,
  Cleric: 8,
  Druid: 8,
  Fighter: 10,
  Monk: 8,
  Paladin: 10,
  Ranger: 10,
  Rogue: 8,
  Sorcerer: 6,
  Warlock: 8,
  Wizard: 6,
};

/** 2024 PHB multiclass prerequisites — the ability score(s) needed in a class you don't already have levels in before you can take your first level in it. 'all' = every listed stat needs 13+, 'any' = just one of them (Fighter's Str-or-Dex). No prereq is checked against classes you already have levels in — only the new one. */
export const MULTICLASS_PREREQS: Record<
  string,
  { stats: AbilityKey[]; mode: "all" | "any" }
> = {
  Artificer: { stats: ["int"], mode: "all" },
  Barbarian: { stats: ["str"], mode: "all" },
  Bard: { stats: ["cha"], mode: "all" },
  Cleric: { stats: ["wis"], mode: "all" },
  Druid: { stats: ["wis"], mode: "all" },
  Fighter: { stats: ["str", "dex"], mode: "any" },
  Monk: { stats: ["dex", "wis"], mode: "all" },
  Paladin: { stats: ["str", "cha"], mode: "all" },
  Ranger: { stats: ["dex", "wis"], mode: "all" },
  Rogue: { stats: ["dex"], mode: "all" },
  Sorcerer: { stats: ["cha"], mode: "all" },
  Warlock: { stats: ["cha"], mode: "all" },
  Wizard: { stats: ["int"], mode: "all" },
};

export function meetsMulticlassPrereq(
  className: string,
  stats: Record<AbilityKey, number>,
): boolean {
  const req = MULTICLASS_PREREQS[className];
  if (!req) return true;
  const scores = req.stats.map((s) => stats[s]);
  return req.mode === "any"
    ? scores.some((v) => v >= 13)
    : scores.every((v) => v >= 13);
}

export const CLASS_BLURBS: Record<string, string> = {
  Artificer:
    "Think mad scientist crossed with a spellcaster — Artificers turn ordinary junk into magic gadgets, then cast spells on top of that.",
  Barbarian:
    "Barbarians solve most problems by getting angry and hitting them very hard, and honestly, it works.",
  Bard: "Bards talk, sing, and charm their way through problems just as often as they solve them with a spell — a proper jack-of-all-trades.",
  Cleric:
    "Clerics channel a god's power to heal, protect, or smite, depending on how their deity is feeling that day.",
  Druid:
    "Druids pull magic straight from nature, and if things get hairy, they can just turn into a bear and sort it out that way.",
  Fighter:
    "Fighters don't overthink it — pick a weapon, get good with it, and hit things until the problem goes away.",
  Monk: "Monks fight bare-handed using speed and discipline instead of steel, and somehow still hit like a truck.",
  Paladin:
    "Paladins are knights with a holy oath backing them up — heavy armor, a big weapon, and a bit of divine magic on the side.",
  Ranger:
    "Rangers are at home in the wild, mixing archery or dual-wielding with just enough nature magic to keep the woods on their side.",
  Rogue:
    "Rogues get things done quietly — one good hit from the shadows beats ten in a straight fight.",
  Sorcerer:
    "Sorcerers are born with magic already in them, no books required, which makes them a little unpredictable but a lot of fun.",
  Warlock:
    "Warlocks made a deal with something powerful and otherworldly, and now they get to borrow its magic — no strings attached, probably.",
  Wizard:
    "Wizards earn their magic the hard way, through books and study, and end up knowing a spell for pretty much anything.",
};

// Plain-English perk summaries for beginners — no rules jargon (no "long rest", "spell slot", etc).
// Keep separate from CLASS_FEATURES below, which stays rules-accurate for the character sheet.
export const CLASS_PLAIN_PERKS: Record<string, string[]> = {
  Artificer: [
    "You can turn everyday objects into magic gadgets and tools.",
    "You cast spells through cleverness and know-how, not raw magical talent.",
    "You know the Mending cantrip and can conjure a handy mundane item out of thin air.",
    "You're great at souping up gear and inventing useful items on the fly.",
  ],
  Barbarian: [
    "You can fly into a rage that makes your attacks hit harder and makes you tougher to hurt.",
    "You fight just fine without armor — raw grit does the job instead.",
    "You train hard with two chosen weapon types, unlocking extra combat tricks with them.",
    "You're one of the toughest, hardest-hitting fighters around in melee.",
  ],
  Bard: [
    "You use music and performance to inspire allies, helping them succeed at things.",
    "You cast a wide variety of spells for support, trickery, and damage.",
    "You're great at talking, entertaining, and thinking on your feet.",
    "You're a flexible jack-of-all-trades — rarely useless in any situation.",
  ],
  Cleric: [
    "You channel the power of a god to heal allies and smite enemies.",
    "You're one of the best healers in the game, full stop.",
    "You choose to lean toward front-line fighting or scholarly divine magic — your call.",
    "You can prepare a huge range of divine spells to fit whatever the day throws at you.",
  ],
  Druid: [
    "You draw on nature magic to heal, control the battlefield, and support allies.",
    "You can transform into animals to fight, scout, or just get around faster.",
    "You feel right at home in forests and wild places, and you know the secret language of druids.",
    "You choose to lean toward extra spellcasting tricks or frontline durability — your call.",
  ],
  Fighter: [
    "You're the most straightforward, reliable warrior — excels with any weapon or armor.",
    "You pick a personal combat style, like archery or dual-wielding, for a steady bonus.",
    "You can patch yourself up mid-fight with a burst of quick healing.",
    "You get more attacks per turn than almost any other class.",
    "Easy to learn, hard to kill.",
  ],
  Monk: [
    "You fight unarmed or with simple weapons using speed, precision, and inner energy.",
    "You're extremely mobile — great at closing distance and dodging danger.",
    "You can throw out extra unarmed strikes, landing a lot of hits over multiple attacks.",
    "No spells, no gear — just raw skill and discipline.",
  ],
  Paladin: [
    "You're a holy knight, mixing sword-and-armor combat with divine magic.",
    "You can heal, protect allies, and smite evil with holy power.",
    "You swear an oath that shapes your abilities and grants unique bonuses.",
    "You can sense evil and fey creatures nearby before they get the drop on you.",
  ],
  Ranger: [
    "You're a skilled hunter, combining archery or dual-wielding with nature magic.",
    "You're excellent at tracking, surviving in the wild, and fighting from range.",
    "A blend of fighter and spellcaster, right at home outdoors.",
    "You train with weapons to unlock extra combat tricks, just like a Fighter.",
  ],
  Rogue: [
    "You rely on stealth, cunning, and precision instead of brute strength.",
    "You deal huge burst damage by striking targets that never saw you coming.",
    "You're excellent at sneaking, lockpicking, and avoiding danger altogether.",
    "You react fast — dodging out of danger and thinking on your feet better than most.",
  ],
  Sorcerer: [
    "You're born with magic in your blood rather than learning it from books.",
    "You can bend and combine spells in unique ways other classes simply can't.",
    "A flexible, powerful spellcaster with a wild, unpredictable streak.",
    "You spend a limited pool of personal magic points to twist spells for extra effect.",
  ],
  Warlock: [
    "You gain magic power through a bargain with a mysterious, otherworldly being.",
    "You have fewer spells than a Wizard, but they recharge quickly and hit hard.",
    "You learn invocations — small permanent magical perks — from your patron.",
    "You get very good at one flashy signature spell, and you'll cast it again and again.",
  ],
  Wizard: [
    "You master magic through rigorous study and a carefully kept spellbook.",
    "You can learn more spells over time than any other class.",
    "Incredibly versatile — you've got a spell for almost every situation.",
    "You can recover some spent magic after a short breather, no full rest needed.",
  ],
};

// Beginner-friendly ability-score guidance per class — plain language, no jargon. stats should begin with capital letters Charisma, Strength, etc
export const CLASS_ATTRIBUTE_ADVICE: Record<string, string> = {
  Artificer:
    "Intelligence is your main stat here, it drives your spell attacks and all your infusions, so that's the one to prioritize. After that I like Constitution — you'll often be right in the middle of things fiddling with gadgets while stuff is trying to hit you, and Artificers can wear armor anyway, so a lower Dexterity isn't the end of the world. Honestly though, Artificers are hard to build wrong, just make cool gadgets and beat the game.",
  Barbarian:
    "Many people like to play Barbarians with Strength and a greataxe — big number, big damage, definitely viable. If this is you, boost that Strength, enter Rage, and get on in there. I myself like to put my highest stat in Constitution. Barbarians have the highest natural health pool in the game, and strengthening this and getting in the thick of the fight gives my party members the space they need to do the real damage. Either playstyle, you can't go wrong, just remember to RAAAAGE!",
  Bard: "Whilst there's absolutely potential for a well-built battle Bard, and when you get it right it feels so right, Bards naturally excel at everything outside combat. You'll find that as your party advances, you're the one consistently scoring high on skill checks, and you always seem to have a spell for every occasion. Charisma powers a Bard's spells — I'd live and die by this stat, the higher the better. Pick a handful of out-of-combat spells, then round that out with a solid core of in-combat spells you can use to control the battlefield, support your allies, and make your enemies regret showing up. Bards aren't built to trade blows, so stay back out of melee and let your spells and support do the work. Once your Charisma is sorted, turn your attention to whichever skills you want to excel at most.",
  Cleric:
    "Wisdom is your bread and butter here, it drives your spellcasting so don't skimp on it. Where you go next depends on how you want to play: pick Protector and you're basically a holy Fighter, so pour some points into Strength or Constitution and get in there swinging your mace. Pick Thaumaturge and you're leaning more into being a walking miracle machine, so Constitution and a bit of Dexterity will serve you better hanging back and keeping everyone alive.",
  Druid:
    "Wisdom drives everything for a Druid — your spells, your Wild Shape, all of it — so that's your first pick every time. After that I always put my next points into Constitution. You'll be spending a lot of time as a bear or a wolf poking things with your face, and that Constitution score carries over even while you're transformed, so it keeps you standing longer.",
  Fighter:
    "Honestly, Fighters are hard to mess up. Pick Strength if you're swinging something heavy and wearing plate, or Dexterity if you'd rather be quick with a bow or a rapier — either one works. Whichever you go with, don't neglect Constitution, more hit points just means more turns where you get to keep hitting things, and that's the whole point of a Fighter.",
  Monk: "Congratulations, you picked right! For Monks you want two things: Dexterity and Wisdom. Focus on Dexterity first, as this doesn't just make you harder to hit, it also makes you hit harder! After that, max out that Wisdom, as this drives many monk abilities. Monks are very good at doing multiple smaller bites of damage that add up fast. You will almost always do damage as a Monk on your turn. Also, drop the armor, you ARE the armor. That's not just a funny line — Monks Wisdom also makes them harder to hit whilst they aren't wearing armor.",
  Paladin:
    "I heard someone say 'Paladins make the best tanks.' That's said for a reason — Paladins get the benefit of being able to wear heavy armor and wield a shield, and they have high health pools and healing magic and auras which come from their Charisma. I'd invest equally between Charisma, Strength, and Constitution. When in battle, get in your foe's face and introduce them to Mr. Divine Smite.",
  Ranger:
    "Dexterity first — whether you're loosing arrows or dual-wielding, it's doing most of the work for your attacks and your Armor Class. Wisdom comes next, it powers your spells and all your tracking and survival tricks. Get those two in a good spot and you'll be just as happy picking off enemies from a treeline as you are finding your way through one.",
  Rogue:
    "Think of your Rogue as a professional. What problems are they very good at solving? As you progress with a Rogue, you'll gradually find it harder and harder to lose at your chosen profession — eventually impossible. I would review the skills at the bottom and decide which ones I want to be the best at, my highest stats go there. If you'd like your expertise to be fighting, then Dexterity is the winner here, no contest. Rogues excel at delivering one brutal strike that has the potential to delete enemies, but they only get one shot to do it. Focus on giving yourself as many chances to get that off as you can (dual-wield, hide, play dirty), and don't ignore the 'Opportunity Attack' rule.",
  Sorcerer:
    "Charisma is everything for a Sorcerer, it's where all your power comes from, so that's your first and biggest investment. You won't have much health early on though, so I'd put my next points into Constitution and maybe a little Dexterity — that way you can actually stick around long enough to use all that power. Stay at the back, let your spells do the talking.",
  Warlock:
    "Warlocks are very customizable, two well-constructed Warlocks can look absolutely nothing alike. Their only constant is they all have good Charisma — it's used to power their spells' accuracy and potency. Warlocks benefit from being able to use Charisma for most of their problems, so after that I'd personally invest in Dexterity and hang back with long-term battlefield-control spells, this makes you harder to hit. Though it's not uncommon for people to invest in Constitution for the health increase and send their Warlock into the fray (just make sure you have 'Pact of the Blade' selected in your invocations).",
  Wizard:
    "A good Wizard is neither early nor late... but they are smart! Wizards require Intelligence for their spells' accuracy and potency. Many people also like to invest in their Constitution score, as this gives them more health to survive attacks (Wizards don't get that much health). I personally like to invest in Dexterity over Constitution, as the best way to take a punch is not to take one at all. Keep to the back line, especially during early levels. Don't worry, the Barbarian can take the punishment — you're at your most valuable at a distance.",
};

export interface ClassFeature {
  name: string;
  description: string;
}

export const CLASS_FEATURES: Record<string, ClassFeature[]> = {
  Artificer: [
    {
      name: "Spellcasting",
      description:
        "You've studied the workings of magic and can cast Artificer spells. Intelligence is your spellcasting ability. You prepare spells from the Artificer spell list each long rest.",
    },
    {
      name: "Tinker's Magic",
      description:
        "You know the Mending cantrip. As a Magic action while holding Tinker's Tools, you can create one mundane item (Rope, Caltrops, a Grappling Hook, and more) in an unoccupied space within 5 feet of yourself. The item lasts until you finish a Long Rest, then vanishes. Usable a number of times equal to your Intelligence modifier (minimum of once) per Long Rest.",
    },
  ],
  Barbarian: [
    {
      name: "Rage",
      description:
        "On your turn you can enter a Rage as a Bonus Action. While raging you gain Advantage on Strength checks and saves, +2 to damage with Strength-based attacks, and Resistance to Bludgeoning, Piercing, and Slashing damage.",
    },
    {
      name: "Unarmored Defense",
      description:
        "While you aren't wearing armor, your Armor Class equals 10 + your Dexterity modifier + your Constitution modifier. You can use a Shield and still gain this benefit.",
    },
    {
      name: "Weapon Mastery",
      description:
        "Your training with weapons allows you to use the Mastery property of two kinds of Simple or Martial Melee weapons. You can change your chosen weapons whenever you finish a Long Rest.",
    },
  ],
  Bard: [
    {
      name: "Bardic Inspiration",
      description:
        "As a Bonus Action you can give one creature within 60 feet a d6 Bardic Inspiration die. The creature can add the die to one ability check, attack roll, or saving throw within the next 10 minutes.",
    },
    {
      name: "Spellcasting",
      description:
        "You have learned to cast spells through your bardic arts. Charisma is your spellcasting ability. You know a fixed list of spells and can cast any of them using your spell slots.",
    },
  ],
  Cleric: [
    {
      name: "Divine Order",
      description:
        "You have dedicated yourself to one of two sacred roles. Protector grants proficiency with Martial weapons and Heavy armor. Thaumaturge grants one additional cantrip and extra languages from the Divine domain.",
    },
    {
      name: "Spellcasting",
      description:
        "You draw magic from the divine. Wisdom is your spellcasting ability. You prepare spells from the entire Cleric spell list each long rest, choosing from spells of levels you can cast.",
    },
  ],
  Druid: [
    {
      name: "Primal Order",
      description:
        "You align yourself with one of two primal roles at 1st level. Magician grants an extra cantrip and access to the Druidic Focus spellcasting. Warden grants proficiency with Martial weapons and the Druidic language.",
    },
    {
      name: "Spellcasting",
      description:
        "Attuned to the natural world, you can cast Druid spells. Wisdom is your spellcasting ability. You prepare spells each long rest from the full Druid spell list.",
    },
    {
      name: "Druidic",
      description:
        "You know Druidic, the secret language of Druids. You can speak it and use it to leave hidden messages, which require a DC 15 Perception check to find and a DC 15 Arcana check to decode.",
    },
  ],
  Fighter: [
    {
      name: "Fighting Style",
      description:
        "You adopt a particular style of fighting. Options include Archery, Defense, Dueling, Great Weapon Fighting, Protection, and Two-Weapon Fighting, each granting a different combat bonus.",
    },
    {
      name: "Second Wind",
      description:
        "As a Bonus Action you can regain hit points equal to 1d10 + your Fighter level. Once you use this feature you can't use it again until you finish a Short or Long Rest.",
    },
    {
      name: "Weapon Mastery",
      description:
        "You can use the Mastery property of three kinds of weapons. You may change your choices whenever you finish a Long Rest.",
    },
  ],
  Monk: [
    {
      name: "Martial Arts",
      description:
        "Your practice of martial arts gives you mastery of combat styles using unarmed strikes and Monk weapons. You can use Dexterity for attack and damage rolls with these weapons, and your unarmed strike damage die increases as you level.",
    },
    {
      name: "Unarmored Defense",
      description:
        "While you aren't wearing armor or wielding a Shield, your Armor Class equals 10 + your Dexterity modifier + your Wisdom modifier.",
    },
  ],
  Paladin: [
    {
      name: "Lay on Hands",
      description:
        "You have a pool of healing power equal to 5 x your Paladin level. As a Bonus Action you can touch a creature to restore any number of hit points from your pool, or expend 5 points to cure one disease or poison.",
    },
    {
      name: "Spellcasting",
      description:
        "You draw divine power to cast Paladin spells. Charisma is your spellcasting ability. You prepare spells from the Paladin list each long rest.",
    },
    {
      name: "Weapon Mastery",
      description:
        "You can use the Mastery property of two kinds of weapons. You may change your choices whenever you finish a Long Rest.",
    },
  ],
  Ranger: [
    {
      name: "Expertise",
      description:
        "You gain Expertise in two skills of your choice from your skill proficiencies, doubling your proficiency bonus for those skills.",
    },
    {
      name: "Favored Enemy",
      description:
        "You always have the Hunter's Mark spell prepared and it doesn't count against your prepared spells. You can cast it twice before a Long Rest without expending a spell slot.",
    },
    {
      name: "Spellcasting",
      description:
        "You have learned to channel the magic of the wilderness. Wisdom is your spellcasting ability. You prepare spells from the Ranger spell list each long rest.",
    },
    {
      name: "Weapon Mastery",
      description:
        "You can use the Mastery property of two kinds of weapons. You may change your choices whenever you finish a Long Rest.",
    },
  ],
  Rogue: [
    {
      name: "Expertise",
      description:
        "You gain Expertise in two skills of your choice, doubling your proficiency bonus for those skills.",
    },
    {
      name: "Sneak Attack",
      description:
        "Once per turn you can deal 1d6 extra damage to one creature you hit with an attack if you have Advantage on the roll, or if an ally is adjacent to the target. The extra damage increases as you gain levels.",
    },
    {
      name: "Thieves' Cant",
      description:
        "You know the secret language of rogues. You can communicate with other Rogues through seemingly innocent conversations, and you can decode most written Thieves' Cant.",
    },
    {
      name: "Weapon Mastery",
      description:
        "You can use the Mastery property of two kinds of weapons. You may change your choices whenever you finish a Long Rest.",
    },
  ],
  Sorcerer: [
    {
      name: "Innate Sorcery",
      description:
        "As a Bonus Action you can unleash the sorcerous power within for 1 minute. While active you gain Advantage on attack rolls of sorcerer spells and the saving throw DC of your spells increases by 1.",
    },
    {
      name: "Spellcasting",
      description:
        "An innate talent for sorcery lets you cast spells. Charisma is your spellcasting ability. Unlike other casters you know a fixed number of spells, but can cast any of them with your spell slots.",
    },
  ],
  Warlock: [
    {
      name: "Eldritch Invocations",
      description:
        "In your study of occult lore you have unearthed eldritch invocations — fragments of forbidden knowledge. You learn two Invocations of your choice that each grant a constant or triggered magical benefit.",
    },
    {
      name: "Pact Magic",
      description:
        "Your arcane research and your patron's power give you a small number of high-level spell slots that refresh on a Short Rest. Charisma is your spellcasting ability.",
    },
  ],
  Wizard: [
    {
      name: "Arcane Recovery",
      description:
        "Once per Long Rest when you finish a Short Rest, you can recover expended spell slots with a combined level equal to or less than half your Wizard level (rounded up).",
    },
    {
      name: "Spellcasting",
      description:
        "As a student of arcane magic you have a spellbook and can prepare spells from it each Long Rest. Intelligence is your spellcasting ability. You begin with six 1st-level spells in your book.",
    },
  ],
};

// ── Fighting Styles (Fighter level 1 choice) ─────────────────────────────────

export interface FightingStyle {
  name: string;
  description: string;
}

export const FIGHTING_STYLES: FightingStyle[] = [
  {
    name: "Archery",
    description:
      "You gain a +2 bonus to attack rolls you make with Ranged weapons.",
  },
  {
    name: "Defense",
    description:
      "While you are wearing Armor, you gain a +1 bonus to Armor Class.",
  },
  {
    name: "Dueling",
    description:
      "While you are wielding a Melee weapon in one hand and no other weapons, you gain a +2 bonus to damage rolls with that weapon.",
  },
  {
    name: "Great Weapon Fighting",
    description:
      "When you roll a 1 or 2 on a damage die for an attack you make with a Melee weapon that you are wielding with two hands, you can reroll the die and must use the new roll, even if the new roll is a 1 or a 2. The weapon must have the Two-Handed or Versatile property to gain this benefit.",
  },
  {
    name: "Protection",
    description:
      "When a creature you can see attacks a target other than you that is within 5 feet of you, you can take a Reaction to impose Disadvantage on the attack roll. You must be wielding a Shield.",
  },
  {
    name: "Two-Weapon Fighting",
    description:
      "When you engage in Two-Weapon Fighting, you can add your ability modifier to the damage of the second attack.",
  },
];

// ── Divine Order / Primal Order (Cleric / Druid level 1 choice) ──────────────
// Only the mechanically-wired half of each description is asserted here (weapon/armor
// proficiency, the bonus cantrip) — see effectiveWeaponProfs/effectiveArmorTraining (shared) and
// SpellsTab's orderCantripBonus.

export interface ClassOrder {
  name: string;
  description: string;
}

export const DIVINE_ORDERS: ClassOrder[] = [
  {
    name: "Protector",
    description:
      "You are trained for battle. You gain proficiency with Martial weapons and Heavy armor.",
  },
  {
    name: "Thaumaturge",
    description:
      "You know one extra cantrip from the Cleric spell list, on top of the cantrips granted by Spellcasting.",
  },
];

export const PRIMAL_ORDERS: ClassOrder[] = [
  {
    name: "Magician",
    description:
      "You know one extra cantrip from the Druid spell list, on top of the cantrips granted by Spellcasting.",
  },
  {
    name: "Warden",
    description:
      "Trained for battle, you gain proficiency with Martial weapons.",
  },
];

// ── Eldritch Invocations (Warlock level 1 choice, choose 2) ──────────────────
// 2024 PHB's full invocation list has ~28 entries, most gated behind Warlock level 2+ or a
// prerequisite invocation — this is only the subset with no prerequisite at all, i.e. what's
// actually choosable at level 1. Selection only for now — no mechanical effects wired yet.

export interface Invocation {
  name: string;
  description: string;
}

export const ELDRITCH_INVOCATIONS: Invocation[] = [
  {
    name: "Armor of Shadows",
    description:
      "You can cast Mage Armor on yourself without expending a spell slot.",
  },
  {
    name: "Eldritch Mind",
    description:
      "You have Advantage on Constitution saving throws that you make to maintain Concentration.",
  },
  {
    name: "Pact of the Blade",
    description:
      "As a Bonus Action, you can conjure a pact weapon in your hand — a Simple or Martial Melee weapon of your choice with which you bond. Until the bond ends, you have proficiency with the weapon, and you can use it as a Spellcasting Focus. Whenever you attack with the bonded weapon, you can use your Charisma modifier for the attack and damage rolls instead of Strength or Dexterity.",
  },
  {
    name: "Pact of the Chain",
    description:
      "You learn the Find Familiar spell and can cast it as a Magic action without expending a spell slot. When you take the Attack action, you can forgo one of your own attacks to let your familiar make one attack with its Reaction.",
  },
  {
    name: "Pact of the Tome",
    description:
      "A Book of Shadows appears in your hand at the end of a Short or Long Rest. Choose three cantrips and two 1st-level Ritual spells from any class's spell list — while the book is on your person, you have them prepared as Warlock spells. You can also use the book as a Spellcasting Focus.",
  },
];

// Sourced from shared (server needs the same table for spell save resolution);
// re-cased to uppercase here since StatName/STAT_NAMES are uppercase throughout this file.
export const CLASS_SAVING_THROWS: Record<string, [StatName, StatName]> =
  Object.fromEntries(
    Object.entries(CLASS_SAVING_THROWS_SHARED).map(([cls, [a, b]]) => [
      cls,
      [a.toUpperCase(), b.toUpperCase()] as [StatName, StatName],
    ]),
  );

// ── Skills ────────────────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  stat: StatName;
}

export const SKILLS: Skill[] = [
  { name: "Athletics", stat: "STR" },
  { name: "Acrobatics", stat: "DEX" },
  { name: "Sleight of Hand", stat: "DEX" },
  { name: "Stealth", stat: "DEX" },
  { name: "Arcana", stat: "INT" },
  { name: "History", stat: "INT" },
  { name: "Investigation", stat: "INT" },
  { name: "Nature", stat: "INT" },
  { name: "Religion", stat: "INT" },
  { name: "Animal Handling", stat: "WIS" },
  { name: "Insight", stat: "WIS" },
  { name: "Medicine", stat: "WIS" },
  { name: "Perception", stat: "WIS" },
  { name: "Survival", stat: "WIS" },
  { name: "Deception", stat: "CHA" },
  { name: "Intimidation", stat: "CHA" },
  { name: "Performance", stat: "CHA" },
  { name: "Persuasion", stat: "CHA" },
];

export const BACKGROUND_SKILLS: Record<string, string[]> = {
  Acolyte: ["Insight", "Religion"],
  Artisan: ["Investigation", "Persuasion"],
  Charlatan: ["Deception", "Sleight of Hand"],
  Criminal: ["Sleight of Hand", "Stealth"],
  Entertainer: ["Acrobatics", "Performance"],
  Farmer: ["Animal Handling", "Nature"],
  Guard: ["Athletics", "Perception"],
  Guide: ["Athletics", "Survival"],
  Hermit: ["Medicine", "Religion"],
  Merchant: ["Animal Handling", "Persuasion"],
  Noble: ["History", "Persuasion"],
  Sage: ["Arcana", "History"],
  Sailor: ["Acrobatics", "Perception"],
  Scribe: ["Investigation", "Perception"],
  Soldier: ["Athletics", "Intimidation"],
  Wayfarer: ["Insight", "Stealth"],
};

// empty skills array = any skill allowed
export const CLASS_SKILLS: Record<string, { skills: string[]; count: number }> =
{
  Artificer: {
    count: 2,
    skills: [
      "Arcana",
      "History",
      "Investigation",
      "Medicine",
      "Nature",
      "Perception",
      "Sleight of Hand",
    ],
  },
  Barbarian: {
    count: 2,
    skills: [
      "Animal Handling",
      "Athletics",
      "Intimidation",
      "Nature",
      "Perception",
      "Survival",
    ],
  },
  Bard: { count: 3, skills: [] },
  Cleric: {
    count: 2,
    skills: ["History", "Insight", "Medicine", "Persuasion", "Religion"],
  },
  Druid: {
    count: 2,
    skills: [
      "Arcana",
      "Animal Handling",
      "Insight",
      "Medicine",
      "Nature",
      "Perception",
      "Religion",
      "Survival",
    ],
  },
  Fighter: {
    count: 2,
    skills: [
      "Acrobatics",
      "Animal Handling",
      "Athletics",
      "History",
      "Insight",
      "Intimidation",
      "Perception",
      "Survival",
    ],
  },
  Monk: {
    count: 2,
    skills: [
      "Acrobatics",
      "Athletics",
      "History",
      "Insight",
      "Religion",
      "Stealth",
    ],
  },
  Paladin: {
    count: 2,
    skills: [
      "Athletics",
      "Insight",
      "Intimidation",
      "Medicine",
      "Persuasion",
      "Religion",
    ],
  },
  Ranger: {
    count: 3,
    skills: [
      "Animal Handling",
      "Athletics",
      "Insight",
      "Investigation",
      "Nature",
      "Perception",
      "Stealth",
      "Survival",
    ],
  },
  Rogue: {
    count: 4,
    skills: [
      "Acrobatics",
      "Athletics",
      "Deception",
      "Insight",
      "Intimidation",
      "Investigation",
      "Perception",
      "Performance",
      "Persuasion",
      "Sleight of Hand",
      "Stealth",
    ],
  },
  Sorcerer: {
    count: 2,
    skills: [
      "Arcana",
      "Deception",
      "Insight",
      "Intimidation",
      "Persuasion",
      "Religion",
    ],
  },
  Warlock: {
    count: 2,
    skills: [
      "Arcana",
      "Deception",
      "History",
      "Intimidation",
      "Investigation",
      "Nature",
      "Religion",
    ],
  },
  Wizard: {
    count: 2,
    skills: [
      "Arcana",
      "History",
      "Insight",
      "Investigation",
      "Medicine",
      "Religion",
    ],
  },
};

// ── Origin Feats (Human Versatile + chooseable) ───────────────────────────────

export const ORIGIN_FEATS = [
  "Alert",
  "Crafter",
  "Healer",
  "Lucky",
  "Magic Initiate (Cleric)",
  "Magic Initiate (Druid)",
  "Magic Initiate (Wizard)",
  "Musician",
  "Savage Attacker",
  "Skilled",
  "Tavern Brawler",
  "Tough",
];

export const ORIGIN_FEAT_DETAILS: Record<string, BackgroundFeat> = {
  Alert: {
    name: "Alert",
    description:
      "You can add your Proficiency Bonus to Initiative rolls. Immediately after you roll Initiative, you can swap it with a willing ally's in the same combat (neither of you can be Incapacitated).",
  },
  Crafter: {
    name: "Crafter",
    description:
      "You gain proficiency with three Artisan's Tools of your choice, receive a 20% discount when purchasing nonmagical items, and can craft one item from the Fast Crafting table when you finish a Long Rest (if you're proficient with the tool it requires). The item lasts until you finish another Long Rest, then falls apart.",
  },
  Healer: {
    name: "Healer",
    description:
      "As a Utilize action, expend a use of a Healer's Kit to tend a creature within 5 feet. That creature spends one of its Hit Point Dice, which you roll — it regains HP equal to the roll plus your Proficiency Bonus. Any die rolled to restore HP this way or with a spell can be rerolled once if it comes up 1.",
  },
  Lucky: {
    name: "Lucky",
    description:
      "You have a number of Luck Points equal to your Proficiency Bonus. Spend one when you roll a d20 for a D20 Test to give yourself Advantage on it, or when a creature makes an attack roll against you to impose Disadvantage on it. Luck Points refresh on a Long Rest.",
  },
  "Magic Initiate (Cleric)": {
    name: "Magic Initiate (Cleric)",
    description:
      "You learn two Cleric cantrips and one 1st-level Cleric spell, castable once per Long Rest without a spell slot. Wisdom is your spellcasting ability.",
  },
  "Magic Initiate (Druid)": {
    name: "Magic Initiate (Druid)",
    description:
      "You learn two Druid cantrips and one 1st-level Druid spell, castable once per Long Rest without a spell slot. Wisdom is your spellcasting ability.",
  },
  "Magic Initiate (Wizard)": {
    name: "Magic Initiate (Wizard)",
    description:
      "You learn two Wizard cantrips and one 1st-level Wizard spell, castable once per Long Rest without a spell slot. Intelligence is your spellcasting ability.",
  },
  Musician: {
    name: "Musician",
    description:
      "You gain proficiency with three Musical Instruments. As you finish a Short or Long Rest, you can play one and give Heroic Inspiration to a number of allies who hear it equal to your Proficiency Bonus.",
  },
  "Savage Attacker": {
    name: "Savage Attacker",
    description:
      "Once per turn when you hit with a weapon, roll the damage dice twice and use either total.",
  },
  Skilled: {
    name: "Skilled",
    description:
      "You gain proficiency in any combination of three skills or tools of your choice.",
  },
  "Tavern Brawler": {
    name: "Tavern Brawler",
    description:
      "Your unarmed strikes deal 1d4 + STR bludgeoning damage instead of the normal amount, and the damage die can be rerolled once if it comes up 1. You're proficient with improvised weapons. Once per turn, when you hit with an unarmed strike as part of the Attack action, you can also push the target 5 feet away.",
  },
  Tough: {
    name: "Tough",
    description:
      "Your hit point maximum increases by 2 for every character level you have, and increases by 2 again each time you gain a level.",
  },
};

export { BACKGROUND_FEAT } from "shared";

// ── Spell allowances at level 1 ───────────────────────────────────────────────
// cantrips: max cantrips learnable; spells: max 1st-level spells learnable.
// Classes not listed (Barbarian, Fighter, Monk, Rogue) have no spellcasting at level 1.
export interface SpellAllowance {
  cantrips: number;
  spells: number;
  spellLevels: number[];
}

export const CLASS_SPELL_ALLOWANCE: Record<string, SpellAllowance> = {
  Artificer: { cantrips: 2, spells: 2, spellLevels: [1] },
  Bard: { cantrips: 2, spells: 4, spellLevels: [1] },
  Cleric: { cantrips: 3, spells: 2, spellLevels: [1] },
  Druid: { cantrips: 2, spells: 2, spellLevels: [1] },
  Paladin: { cantrips: 0, spells: 2, spellLevels: [1] },
  Ranger: { cantrips: 0, spells: 2, spellLevels: [1] },
  Sorcerer: { cantrips: 4, spells: 2, spellLevels: [1] },
  Warlock: { cantrips: 2, spells: 2, spellLevels: [1] },
  Wizard: { cantrips: 3, spells: 6, spellLevels: [1] },
};

export { FEAT_SPELL_GRANTS } from "shared";
