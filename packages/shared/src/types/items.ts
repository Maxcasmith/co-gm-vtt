// ── Item class hierarchy ──────────────────────────────────────────────────────
// All item subtypes extend Item. Plain-object constructors (single props arg)
// so instances serialize cleanly to/from JSON without custom toJSON logic.

export class Item {
  id: string;
  name: string;
  description: string;
  quantity: number;
  type?: string;
  iconPath?: string;
  /** Radius (ft) this item lights up while equipped — a torch. Hard cutoff, no falloff; see Dungeon.lightSources. */
  lightEmissionRangeFt?: number;

  constructor(props: {
    id: string;
    name: string;
    description: string;
    quantity: number;
    type?: string;
    iconPath?: string;
    lightEmissionRangeFt?: number;
  }) {
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.quantity = props.quantity;
    this.type = props.type;
    this.iconPath = props.iconPath;
    this.lightEmissionRangeFt = props.lightEmissionRangeFt;
  }
}

export class Weapon extends Item {
  declare type: "weapon";
  damage: string;
  damageType: string;
  attackBonus: number;
  range: number;
  extendedRange?: number;
  properties: string[];
  isFinesse: boolean;
  mastery?: string;
  twoHanded?: boolean;
  ammoSlug?: string;

  constructor(props: {
    id: string;
    name: string;
    description: string;
    quantity: number;
    damage: string;
    damageType: string;
    attackBonus: number;
    range: number;
    extendedRange?: number;
    properties: string[];
    isFinesse?: boolean;
    mastery?: string;
    twoHanded?: boolean;
    ammoSlug?: string;
  }) {
    super({ ...props, type: "weapon" as const });
    this.damage = props.damage;
    this.damageType = props.damageType;
    this.attackBonus = props.attackBonus;
    this.range = props.range;
    this.extendedRange = props.extendedRange;
    this.properties = props.properties;
    this.isFinesse = props.isFinesse ?? false;
    this.mastery = props.mastery;
    this.twoHanded = props.twoHanded;
    this.ammoSlug = props.ammoSlug;
  }
}

export class Armor extends Item {
  declare type: "armor";
  armorType: "light" | "medium" | "heavy" | "none";
  acBonus: number;
  isShield: boolean;
  slot?: "head" | "body" | "gloves" | "boots";

  constructor(props: {
    id: string;
    name: string;
    description: string;
    quantity: number;
    armorType: "light" | "medium" | "heavy" | "none";
    acBonus: number;
    isShield: boolean;
    slot?: "head" | "body" | "gloves" | "boots";
  }) {
    super({ ...props, type: "armor" as const });
    this.armorType = props.armorType;
    this.acBonus = props.acBonus;
    this.isShield = props.isShield;
    this.slot = props.slot;
  }
}

export class Consumable extends Item {
  declare type: "consumable";
  effect: string;
  actionCost: "action" | "bonusAction";

  constructor(props: {
    id: string;
    name: string;
    description: string;
    quantity: number;
    effect: string;
    actionCost: "action" | "bonusAction";
  }) {
    super({ ...props, type: "consumable" as const });
    this.effect = props.effect;
    this.actionCost = props.actionCost;
  }
}

export class Ammunition extends Item {
  declare type: "ammunition";
  usableBySlug: string;

  constructor(props: {
    id: string;
    name: string;
    description: string;
    quantity: number;
    usableBySlug: string;
  }) {
    super({ ...props, type: "ammunition" as const });
    this.usableBySlug = props.usableBySlug;
  }
}

// Discriminant-based guards — not instanceof, since items cross the socket/JSON
// boundary as plain objects and won't satisfy instanceof on the receiving side.
export function isWeapon(item: Item): item is Weapon {
  return item.type === "weapon";
}
export function isArmor(item: Item): item is Armor {
  return item.type === "armor";
}
export function isConsumable(item: Item): item is Consumable {
  return item.type === "consumable";
}
export function isAmmunition(item: Item): item is Ammunition {
  return item.type === "ammunition";
}

export type InventoryItem = Item;
