import { useMemo, useState } from "react";
import type { Character, Item, Weapon, Armor, Consumable } from "shared";
import { isWeapon, isArmor, isConsumable, isAmmunition } from "shared";
import { dispatch } from "../events.ts";
import emptyFrameIcon from "../assets/icons/Icon-Frame-Blue.jpg";
import { ActionCostDot } from "./helpers.tsx";

const WEAPON_NAMES =
  /sword|dagger|axe|mace|staff|bow|spear|lance|rapier|club|flail|hammer|trident|whip|blade/i;
const ARMOUR_NAMES = /armou?r|shield|helmet|gauntlet|boot|plate|chain|mail/i;
const CONSUMABLE_NAMES = /potion|scroll|ration|herb|tincture|elixir/i;
const POTION_OF_HEALING_NAME = /potion of healing/i;

const SECTIONS = [
  {
    label: "Weapons",
    test: (i: Item | Weapon | Armor | Consumable) =>
      isWeapon(i) || WEAPON_NAMES.test(i.name),
  },
  {
    label: "Armour",
    test: (i: Item | Weapon | Armor | Consumable) => ARMOUR_NAMES.test(i.name),
  },
  {
    label: "Consumables",
    test: (i: Item | Weapon | Armor | Consumable) =>
      isConsumable(i) || CONSUMABLE_NAMES.test(i.name),
  },
  {
    label: "Ammunition",
    test: (i: Item | Weapon | Armor | Consumable) => isAmmunition(i),
  },
  { label: "Other", test: () => true },
] as const;

type EquipSlotName =
  | "head"
  | "body"
  | "gloves"
  | "boots"
  | "mainHand"
  | "offHand";
type DragItem = {
  id: string;
  kind: "weapon" | "armor";
  slot?: "head" | "body" | "gloves" | "boots";
  isShield?: boolean;
};

function slotAccepts(slotName: EquipSlotName, drag: DragItem | null): boolean {
  if (!drag) return false;
  if (slotName === "mainHand") return drag.kind === "weapon";
  if (slotName === "offHand")
    return drag.kind === "weapon" || (drag.kind === "armor" && !!drag.isShield);
  return drag.kind === "armor" && drag.slot === slotName;
}

function EquipSlot({
  name,
  title,
  label,
  className,
  iconPath,
  dragItem,
  onDrop,
}: {
  name: EquipSlotName;
  title?: string;
  label?: string;
  className?: string;
  iconPath?: string;
  dragItem: DragItem | null;
  onDrop: (name: EquipSlotName) => void;
}) {
  const compatible = slotAccepts(name, dragItem);
  const slot = (
    <div
      className={`sheet-equip-slot${className ? ` ${className}` : ""}${iconPath ? " sheet-equip-slot--filled" : ""}${compatible ? " sheet-equip-slot--target" : ""}`}
      title={title}
      onDragOver={(e) => {
        if (compatible) e.preventDefault();
      }}
      onDrop={() => {
        if (compatible) onDrop(name);
      }}
    >
      {iconPath && (
        <img className="sheet-equip-slot-icon" src={iconPath} alt="" />
      )}
    </div>
  );
  if (!label) return slot;
  return (
    <div className="sheet-equip-slot-row">
      {slot}
      <span className="sheet-equip-slot-label">{label}</span>
    </div>
  );
}

function asWeapon(item: Item | Weapon | Armor | Consumable): Weapon {
  if (isWeapon(item)) return item;
  return {
    ...item,
    type: "weapon" as const,
    damage: "1d8",
    damageType: "slashing",
    attackBonus: 0,
    range: 5,
    properties: [],
    isFinesse: false,
  };
}

function asConsumable(item: Item | Weapon | Armor | Consumable): Consumable {
  if (isConsumable(item)) return item;
  return {
    ...item,
    type: "consumable" as const,
    effect: "",
    actionCost: "bonusAction",
  };
}

function targetSlotFor(item: Weapon | Armor): EquipSlotName {
  if (isArmor(item)) return item.isShield ? "offHand" : (item.slot ?? "body");
  return "mainHand";
}

export function InventoryTab({
  character,
  sessionActive,
}: {
  character: Character;
  sessionActive: boolean;
}) {
  const [search, setSearch] = useState("");
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [selected, setSelected] = useState<
    Item | Weapon | Armor | Consumable | null
  >(null);
  const items = useMemo(() => {
    const all = character.inventory ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((item) => item.name.toLowerCase().includes(q));
  }, [character.inventory, search]);

  function handleConsumableClick(item: Consumable) {
    if (!sessionActive) return;
    dispatch("vtt:sheet:closed", {});
    dispatch("vtt:consumable:used", { item, characterId: character.id });
    if (POTION_OF_HEALING_NAME.test(item.name)) {
      dispatch("vtt:consumable:heal", {
        characterId: character.id,
        characterName: character.name,
      });
    }
  }

  function handleEquipDrop(slot: EquipSlotName) {
    if (!dragItem) return;
    dispatch("vtt:equipment:update", {
      characterId: character.id,
      slot,
      itemId: dragItem.id,
    });
    setDragItem(null);
  }

  function handleToggleEquip(item: Weapon | Armor) {
    if (!sessionActive) return;
    const entries = Object.entries(character.equipment ?? {}) as [
      EquipSlotName,
      string | undefined,
    ][];
    const currentSlot = entries.find(([, id]) => id === item.id)?.[0];
    if (currentSlot) {
      dispatch("vtt:equipment:update", {
        characterId: character.id,
        slot: currentSlot,
        itemId: null,
      });
    } else {
      dispatch("vtt:equipment:update", {
        characterId: character.id,
        slot: targetSlotFor(item),
        itemId: item.id,
      });
    }
  }

  const equippedIds = new Set(
    Object.values(character.equipment ?? {}).filter((id): id is string => !!id),
  );
  function iconForSlot(slot: EquipSlotName): string | undefined {
    const itemId = character.equipment?.[slot];
    if (!itemId) return undefined;
    return (
      character.inventory?.find((i) => i.id === itemId)?.iconPath ||
      emptyFrameIcon
    );
  }

  // Assign each item to its first matching section
  const grouped = new Map<string, Array<Item | Weapon | Armor | Consumable>>();
  for (const item of items) {
    const section = SECTIONS.find((s) => s.test(item))!;
    const bucket = grouped.get(section.label) ?? [];
    bucket.push(item);
    grouped.set(section.label, bucket);
  }

  return (
    <>
      {character.gold != null && (
        <div className="sheet-inv-currency-block">
          <div className="sheet-inv-block sheet-inv-plat">
            <span className="sheet-inv-label">Platinum</span>
            <span className="sheet-inv-value">
              {character.platinum || 0} pp
            </span>
          </div>
          <div className="sheet-inv-block sheet-inv-gold">
            <span className="sheet-inv-label">Gold</span>
            <span className="sheet-inv-value">{character.gold || 0} gp</span>
          </div>
          <div className="sheet-inv-block sheet-inv-elec">
            <span className="sheet-inv-label">Electrum</span>
            <span className="sheet-inv-value">
              {character.electrum || 0} ep
            </span>
          </div>
          <div className="sheet-inv-block sheet-inv-silver">
            <span className="sheet-inv-label">Silver</span>
            <span className="sheet-inv-value">{character.silver || 0} sp</span>
          </div>
          <div className="sheet-inv-block sheet-inv-bronze">
            <span className="sheet-inv-label">Bronze</span>
            <span className="sheet-inv-value">{character.bronze || 0} bp</span>
          </div>
        </div>
      )}
      {(character.inventory ?? []).length > 0 && (
        <input
          className="sheet-spells-search"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <div className="sheet-equipment">
        <div className="sheet-equipment-col">
          <p className="sheet-inv-section-title">Equipment</p>
          <div className="sheet-equipment-body">
            <div className="sheet-equipment-list">
              <EquipSlot
                name="head"
                label="Head"
                iconPath={iconForSlot("head")}
                dragItem={dragItem}
                onDrop={handleEquipDrop}
              />
              <EquipSlot
                name="body"
                label="Body"
                iconPath={iconForSlot("body")}
                dragItem={dragItem}
                onDrop={handleEquipDrop}
              />
              <EquipSlot
                name="gloves"
                label="Gloves"
                iconPath={iconForSlot("gloves")}
                dragItem={dragItem}
                onDrop={handleEquipDrop}
              />
              <EquipSlot
                name="boots"
                label="Boots"
                iconPath={iconForSlot("boots")}
                dragItem={dragItem}
                onDrop={handleEquipDrop}
              />
            </div>
            <div className="sheet-equipment-figure-wrap">
              <div className="sheet-equipment-figure">
                <svg viewBox="0 0 200 400" className="sheet-equipment-svg">
                  <circle cx="100" cy="40" r="30" />
                  <line x1="100" y1="70" x2="100" y2="220" />
                  <line x1="100" y1="100" x2="40" y2="180" />
                  <line x1="100" y1="100" x2="160" y2="180" />
                  <line x1="100" y1="220" x2="55" y2="360" />
                  <line x1="100" y1="220" x2="145" y2="360" />
                </svg>
                <EquipSlot
                  name="offHand"
                  title="Off Hand"
                  className="sheet-equip-slot--hand-left"
                  iconPath={iconForSlot("offHand")}
                  dragItem={dragItem}
                  onDrop={handleEquipDrop}
                />
                <EquipSlot
                  name="mainHand"
                  title="Main Hand"
                  className="sheet-equip-slot--hand-right"
                  iconPath={iconForSlot("mainHand")}
                  dragItem={dragItem}
                  onDrop={handleEquipDrop}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="sheet-equipment-col">
          <p className="sheet-inv-section-title">Accessories</p>
          <div className="sheet-accessories-grid">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="sheet-accessory-slot" />
            ))}
          </div>
        </div>
      </div>
      {selected &&
        (() => {
          const section = SECTIONS.find((s) => s.test(selected))!;
          const weapon =
            section.label === "Weapons" ? asWeapon(selected) : null;
          const armor =
            section.label === "Armour" && isArmor(selected) ? selected : null;
          const consumable =
            section.label === "Consumables" ? asConsumable(selected) : null;
          const equipped = equippedIds.has(selected.id);
          return (
            <div className="sheet-spell-detail">
              <div className="sheet-spell-detail-header">
                <div className="sheet-spell-detail-heading">
                  <img
                    className="sheet-inv-icon sheet-spell-detail-icon"
                    src={selected.iconPath || emptyFrameIcon}
                    alt=""
                  />
                  <div>
                    <span className="sheet-spell-detail-name">
                      {selected.name}
                    </span>
                    {weapon && (
                      <span className="sheet-spell-detail-sub">
                        {weapon.damage} {weapon.damageType}
                        {weapon.properties.length
                          ? ` · ${weapon.properties.join(", ")}`
                          : ""}
                      </span>
                    )}
                    {armor && (
                      <span className="sheet-spell-detail-sub">
                        {armor.isShield ? "Shield" : `${armor.armorType} armor`}{" "}
                        · AC +{armor.acBonus}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="sheet-spell-detail-close"
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
              </div>
              {selected.description && (
                <p className="sheet-spell-detail-text">
                  {selected.description}
                </p>
              )}
              {(weapon || armor) && (
                <button
                  className={`sheet-spell-cast-btn${!sessionActive ? " sheet-spell-cast-btn--disabled" : ""}`}
                  disabled={!sessionActive}
                  onClick={() =>
                    handleToggleEquip((weapon ?? armor) as Weapon | Armor)
                  }
                >
                  {equipped ? "Unequip" : "Equip"}
                </button>
              )}
              {consumable && (
                <button
                  className={`sheet-spell-cast-btn${!sessionActive ? " sheet-spell-cast-btn--disabled" : ""}`}
                  disabled={!sessionActive}
                  onClick={() => handleConsumableClick(consumable)}
                >
                  Use
                </button>
              )}
            </div>
          );
        })()}

      {items.length === 0 ? (
        <div className="sheet-empty">
          {(character.inventory ?? []).length === 0 ? (
            <>
              <p className="sheet-empty-title">No items yet</p>
              <p className="sheet-empty-hint">
                Items will appear here as you acquire them
              </p>
            </>
          ) : (
            <p className="sheet-empty-hint">No items match "{search}"</p>
          )}
        </div>
      ) : (
        SECTIONS.map((section) => {
          const bucket = grouped.get(section.label);
          if (!bucket?.length) return null;
          return (
            <div key={section.label} className="sheet-inv-section">
              <p className="sheet-inv-section-title">{section.label}</p>
              <div className="sheet-inventory">
                {bucket.map((item) => {
                  const isWeaponCard = section.label === "Weapons";
                  const isConsumableCard = section.label === "Consumables";
                  const itemKind: DragItem["kind"] | null = isWeapon(item)
                    ? "weapon"
                    : isArmor(item)
                      ? "armor"
                      : null;
                  const equippable = sessionActive ? itemKind : null;
                  const equipped = itemKind && equippedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`sheet-inv-card${isWeaponCard ? " sheet-inv-card--weapon" : ""}${isConsumableCard ? " sheet-inv-card--consumable" : ""}${selected?.id === item.id ? " sheet-inv-card--spell-active" : ""}`}
                      onClick={() =>
                        setSelected((s) => (s?.id === item.id ? null : item))
                      }
                      draggable={!!equippable}
                      onDragStart={
                        equippable
                          ? () =>
                            setDragItem(
                              isArmor(item)
                                ? {
                                  id: item.id,
                                  kind: "armor",
                                  slot: item.slot,
                                  isShield: item.isShield,
                                }
                                : { id: item.id, kind: "weapon" },
                            )
                          : undefined
                      }
                      onDragEnd={
                        equippable ? () => setDragItem(null) : undefined
                      }
                    >
                      {equipped && (
                        <span className="sheet-inv-badge" title="Equipped">
                          <svg viewBox="0 0 16 16">
                            <path d="M8 1 L14 3 V8 C14 12 11 14.5 8 15 C5 14.5 2 12 2 8 V3 Z" />
                          </svg>
                        </span>
                      )}
                      <div className="sheet-inv-card-header">
                        <img
                          className="sheet-inv-icon"
                          src={item.iconPath || emptyFrameIcon}
                          alt=""
                        />
                        <span className="sheet-inv-name">{item.name}</span>
                        <div className="sheet-inv-card-header-right">
                          {isWeaponCard && <ActionCostDot cost="action" />}
                          {item.quantity > 1 && (
                            <span className="sheet-inv-qty">
                              ×{item.quantity}
                            </span>
                          )}
                        </div>
                      </div>
                      {item.description && (
                        <p className="sheet-inv-desc">{item.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
