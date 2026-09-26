// ── SRD starting-equipment catalog ────────────────────────────────────────────
// One concrete class per shop-purchasable item, extending the Weapon/Armor/
// Consumable/Ammunition base classes in items.ts. Each constructor takes a
// partial override merged over static DEFAULTS, so callers can mint variants
// later (e.g. an AI-generated `new Longsword({ name: "Deathstrike", attackBonus: 2 })`)
// without redeclaring every field.

import { Weapon, Armor, Consumable, Ammunition } from "./items.ts";

type WeaponProps = ConstructorParameters<typeof Weapon>[0];
type ArmorProps = ConstructorParameters<typeof Armor>[0];
type ConsumableProps = ConstructorParameters<typeof Consumable>[0];
type AmmunitionProps = ConstructorParameters<typeof Ammunition>[0];

export class Longsword extends Weapon {
  static readonly DEFAULTS: WeaponProps = {
    id: "longsword", name: "Longsword", description: "1d8 slashing. Versatile (1d10).",
    quantity: 1, cost: 15, damage: "1d8", damageType: "slashing", attackBonus: 0, range: 5,
    properties: ["versatile", "martial"],
  };
  constructor(overrides: Partial<WeaponProps> = {}) { super({ ...Longsword.DEFAULTS, ...overrides }); }
}

export class Shield extends Armor {
  static readonly DEFAULTS: ArmorProps = {
    id: "shield", name: "Shield", description: "+2 AC bonus.",
    quantity: 1, cost: 10, armorType: "none", acBonus: 2, isShield: true,
  };
  constructor(overrides: Partial<ArmorProps> = {}) { super({ ...Shield.DEFAULTS, ...overrides }); }
}

export class Handaxe extends Weapon {
  static readonly DEFAULTS: WeaponProps = {
    id: "handaxe", name: "Handaxe", description: "1d6 slashing. Light, thrown (20/60 ft).",
    quantity: 1, cost: 5, damage: "1d6", damageType: "slashing", attackBonus: 0, range: 5,
    properties: ["light", "thrown", "simple"],
  };
  constructor(overrides: Partial<WeaponProps> = {}) { super({ ...Handaxe.DEFAULTS, ...overrides }); }
}

export class LeatherArmour extends Armor {
  static readonly DEFAULTS: ArmorProps = {
    id: "leather-armour", name: "Leather Armour", description: "AC 11 + DEX modifier. Light armor.",
    quantity: 1, cost: 10, armorType: "light", acBonus: 11, isShield: false, slot: "body",
  };
  constructor(overrides: Partial<ArmorProps> = {}) { super({ ...LeatherArmour.DEFAULTS, ...overrides }); }
}

export class PotionOfHealing extends Consumable {
  static readonly DEFAULTS: ConsumableProps = {
    id: "potion-of-healing", name: "Potion of Healing", description: "Restores 2d4+4 HP.",
    quantity: 1, cost: 50, effect: "Restores 2d4+4 HP.", actionCost: "action",
  };
  constructor(overrides: Partial<ConsumableProps> = {}) { super({ ...PotionOfHealing.DEFAULTS, ...overrides }); }
}

export class Shortbow extends Weapon {
  static readonly DEFAULTS: WeaponProps = {
    id: "shortbow", name: "Shortbow", description: "1d6 piercing. Ammunition (arrow), two-handed. Range 80/320 ft.",
    quantity: 1, cost: 25, damage: "1d6", damageType: "piercing", attackBonus: 0, range: 80, extendedRange: 320,
    properties: ["ammunition", "two-handed", "simple"], mastery: "Vex", twoHanded: true, ammoSlug: "arrow",
  };
  constructor(overrides: Partial<WeaponProps> = {}) { super({ ...Shortbow.DEFAULTS, ...overrides }); }
}

export class Arrow extends Ammunition {
  static readonly DEFAULTS: AmmunitionProps = {
    id: "arrows", name: "Arrow", description: "Ammunition for shortbows and longbows (batch of 20).",
    quantity: 20, cost: 1, usableBySlug: "arrow",
  };
  constructor(overrides: Partial<AmmunitionProps> = {}) { super({ ...Arrow.DEFAULTS, ...overrides }); }
}

export class Whip extends Weapon {
  static readonly DEFAULTS: WeaponProps = {
    id: "whip", name: "Whip", description: "1d4 slashing. Finesse, Reach (10 ft).",
    quantity: 1, cost: 2, damage: "1d4", damageType: "slashing", attackBonus: 0, range: 10,
    properties: ["finesse", "reach", "martial"], isFinesse: true, mastery: "Slow",
  };
  constructor(overrides: Partial<WeaponProps> = {}) { super({ ...Whip.DEFAULTS, ...overrides }); }
}

export class ScaleMail extends Armor {
  static readonly DEFAULTS: ArmorProps = {
    id: "scale-mail", name: "Scale Mail", description: "AC 14 + DEX modifier (max 2). Medium armor.",
    quantity: 1, cost: 50, armorType: "medium", acBonus: 14, isShield: false, slot: "body",
  };
  constructor(overrides: Partial<ArmorProps> = {}) { super({ ...ScaleMail.DEFAULTS, ...overrides }); }
}

export class ChainMail extends Armor {
  static readonly DEFAULTS: ArmorProps = {
    id: "chain-mail", name: "Chain Mail", description: "AC 16. Heavy armor.",
    quantity: 1, cost: 75, armorType: "heavy", acBonus: 16, isShield: false, slot: "body",
  };
  constructor(overrides: Partial<ArmorProps> = {}) { super({ ...ChainMail.DEFAULTS, ...overrides }); }
}

export class Dagger extends Weapon {
  static readonly DEFAULTS: WeaponProps = {
    id: "dagger", name: "Dagger", description: "1d4 piercing. Finesse, light, thrown (20/60 ft).",
    quantity: 1, cost: 2, damage: "1d4", damageType: "piercing", attackBonus: 0, range: 5, extendedRange: 60,
    properties: ["finesse", "light", "thrown", "simple"], isFinesse: true,
  };
  constructor(overrides: Partial<WeaponProps> = {}) { super({ ...Dagger.DEFAULTS, ...overrides }); }
}

export class Warhammer extends Weapon {
  static readonly DEFAULTS: WeaponProps = {
    id: "warhammer", name: "Warhammer", description: "1d8 bludgeoning. Versatile (1d10).",
    quantity: 1, cost: 15, damage: "1d8", damageType: "bludgeoning", attackBonus: 0, range: 5,
    properties: ["versatile", "martial"],
  };
  constructor(overrides: Partial<WeaponProps> = {}) { super({ ...Warhammer.DEFAULTS, ...overrides }); }
}

export class Torch extends Weapon {
  static readonly DEFAULTS: WeaponProps = {
    id: "torch", name: "Torch", description: "1d4 bludgeoning. Light, simple. Sheds light in a 20-foot radius while held.",
    quantity: 1, cost: 1, damage: "1d4", damageType: "bludgeoning", attackBonus: 0, range: 5,
    properties: ["light", "simple"], lightEmissionRangeFt: 20,
  };
  constructor(overrides: Partial<WeaponProps> = {}) { super({ ...Torch.DEFAULTS, ...overrides }); }
}

export class HealersKit extends Consumable {
  static readonly DEFAULTS: ConsumableProps = {
    id: "healers-kit", name: "Healer's Kit", description: "Origin feat Healer: tend a creature within 5ft for HP (batch of 10 uses).",
    quantity: 10, cost: 5, effect: "Tend a creature within 5ft for HP (Origin feat Healer).", actionCost: "action",
  };
  constructor(overrides: Partial<ConsumableProps> = {}) { super({ ...HealersKit.DEFAULTS, ...overrides }); }
}

export class Lockpick extends Consumable {
  static readonly DEFAULTS: ConsumableProps = {
    id: "lockpick", name: "Lockpick",
    description: "Consumed on use. Rolls a DEX (Thieves' Tools) check against a locked door within 5ft — success unlocks it (batch of 5).",
    quantity: 5, cost: 5, effect: "DEX (Thieves' Tools) check to unlock a door within 5ft.", actionCost: "action",
  };
  constructor(overrides: Partial<ConsumableProps> = {}) { super({ ...Lockpick.DEFAULTS, ...overrides }); }
}

export class TrapDisarmKit extends Consumable {
  static readonly DEFAULTS: ConsumableProps = {
    id: "trap-disarm-kit", name: "Trap Disarm Kit",
    description: "Consumed on use. Rolls a DEX (Thieves' Tools) check against a discovered trap within 5ft — success removes it safely (batch of 3).",
    quantity: 3, cost: 10, effect: "DEX (Thieves' Tools) check to safely remove a discovered trap within 5ft.", actionCost: "action",
  };
  constructor(overrides: Partial<ConsumableProps> = {}) { super({ ...TrapDisarmKit.DEFAULTS, ...overrides }); }
}

export class Greataxe extends Weapon {
  static readonly DEFAULTS: WeaponProps = {
    id: "greataxe", name: "Greataxe", description: "1d12 slashing. Heavy, two-handed.",
    quantity: 1, cost: 30, damage: "1d12", damageType: "slashing", attackBonus: 0, range: 5,
    properties: ["heavy", "two-handed", "martial"], twoHanded: true,
  };
  constructor(overrides: Partial<WeaponProps> = {}) { super({ ...Greataxe.DEFAULTS, ...overrides }); }
}

/** Pact of the Blade's conjurable Simple/Martial Melee weapons — every melee weapon this catalog has (the Torch is a light source first). */
export const PACT_WEAPON_CHOICES: WeaponProps[] = [Dagger, Handaxe, Whip, Longsword, Warhammer, Greataxe].map(w => w.DEFAULTS);
