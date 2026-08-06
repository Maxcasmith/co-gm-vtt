import { useEffect, useMemo, useState } from "react";
import type {
  Character,
  Item,
  Weapon,
  Armor,
  Consumable,
  Spell,
} from "shared";
import {
  isWeapon,
  isArmor,
  isConsumable,
  isAmmunition,
  CLASS_WEAPON_PROFS,
  CLASS_ARMOR_TRAINING,
  calcACBreakdown,
  actionCostFromCastingTime,
  parseRangeFeet,
} from "shared";
import { on, dispatch } from "./events.ts";
import emptyFrameIcon from "./assets/Icon-Frame-Blue.jpg";
import {
  STAT_NAMES,
  CLASS_SAVING_THROWS,
  CLASS_FEATURES,
  SPECIES_FEATURES,
  BACKGROUND_FEAT,
  BACKGROUND_SKILLS,
  HIT_DICE,
  SKILLS,
} from "./character-creation/srd.ts";

const API = `http://${window.location.hostname}:3001`;

function profBonusForLevel(level: number): number {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

function mod(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}
function modNum(score: number) {
  return Math.floor((score - 10) / 2);
}

const STAT_KEYS: Array<keyof Character["stats"]> = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
];

type SheetTab = "abilities" | "features" | "inventory" | "spells";

interface Props {
  character: Character;
  currentHp?: number;
  maxHp?: number;
  sessionActive: boolean;
}

// ── Abilities ─────────────────────────────────────────────────────────────────

function AbilitiesTab({ character }: { character: Character }) {
  const PROF =
    character.proficiencyBonus ?? profBonusForLevel(character.level ?? 1);
  const [deathSuccesses, setDeathSuccesses] = useState(0);
  const [deathFailures, setDeathFailures] = useState(0);

  function rollDeathSave() {
    const roll = Math.floor(Math.random() * 20) + 1;
    let msg: string;
    if (roll === 20) {
      setDeathSuccesses(3);
      msg = `(Death Save) ${character.name} rolls a 20 — miraculous recovery!`;
    } else if (roll === 1) {
      setDeathFailures((f) => Math.min(3, f + 2));
      msg = `(Death Save) ${character.name} rolls a 1 — two failures!`;
    } else if (roll >= 10) {
      setDeathSuccesses((s) => Math.min(3, s + 1));
      msg = `(Death Save) ${character.name} rolls ${roll} — success.`;
    } else {
      setDeathFailures((f) => Math.min(3, f + 1));
      msg = `(Death Save) ${character.name} rolls ${roll} — failure.`;
    }
    dispatch("vtt:chat:message-sent", {
      text: msg,
      senderName: character.name,
      timestamp: Date.now(),
    });
  }

  const cls = character.class;
  const proficientSaves = new Set<string>(CLASS_SAVING_THROWS[cls] ?? []);
  const proficientSkills = new Set<string>([
    ...(BACKGROUND_SKILLS[character.background] ?? []),
    ...(character.skillProficiencies ?? []),
  ]);

  return (
    <>
      <div className="sheet-stats">
        {STAT_KEYS.map((key, i) => (
          <div
            key={key}
            className="stat-card stat-card--clickable"
            onClick={() =>
              dispatch("vtt:roll:check", {
                characterId: character.id,
                campaignId: character.campaignId,
                stat: key,
              })
            }
            title={`Roll ${STAT_NAMES[i]} check`}
          >
            <div className="stat-card-name">{STAT_NAMES[i]}</div>
            <div className="stat-card-score">{character.stats[key]}</div>
            <div className="stat-card-mod">{mod(character.stats[key])}</div>
          </div>
        ))}
      </div>

      <div className="sheet-body">
        <div>
          <p className="sheet-section-title">Saving Throws</p>
          {STAT_KEYS.map((key, i) => {
            const statName = STAT_NAMES[i]!;
            const proficient = proficientSaves.has(statName);
            const bonus =
              modNum(character.stats[key]) + (proficient ? PROF : 0);
            return (
              <div
                key={key}
                className="sheet-save-row sheet-save-row--clickable"
                onClick={() =>
                  dispatch("vtt:roll:save", {
                    characterId: character.id,
                    campaignId: character.campaignId,
                    stat: key,
                  })
                }
                title={`Roll ${statName} saving throw`}
              >
                <span
                  className={`sheet-save-dot${proficient ? " sheet-save-dot--filled" : ""}`}
                />
                <span className="sheet-save-label">{statName}</span>
                <span className="sheet-save-val">
                  {bonus >= 0 ? `+${bonus}` : bonus}
                </span>
              </div>
            );
          })}

          <button
            className="sheet-save-row sheet-save-row--clickable"
            onClick={rollDeathSave}
            title="Roll death saving throw"
          >
            <span className="sheet-save-dot" />
            <span className="sheet-save-label">DEATH</span>
            <span className="sheet-save-val">d20</span>
          </button>

          <div className="sheet-death-saves">
            <progress
              className="sheet-death-bar sheet-death-bar--life"
              max={3}
              value={deathSuccesses}
            />
            <progress
              className="sheet-death-bar sheet-death-bar--death"
              max={3}
              value={deathFailures}
            />
          </div>

          <p className="sheet-section-title sheet-section-title--spaced">
            Proficiencies &amp; Training
          </p>
          <div className="sheet-proficiency-block">
            <div className="sheet-proficiency-row">
              <span className="sheet-proficiency-label">Weapons</span>
              <span className="sheet-proficiency-value">
                {(CLASS_WEAPON_PROFS[character.class] ?? []).length > 0
                  ? (CLASS_WEAPON_PROFS[character.class] ?? [])
                    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                    .join(" & ") + " weapons"
                  : "None"}
              </span>
            </div>
            <div className="sheet-proficiency-row">
              <span className="sheet-proficiency-label">Armor</span>
              <span className="sheet-proficiency-value">
                {(CLASS_ARMOR_TRAINING[character.class] ?? []).length > 0
                  ? (CLASS_ARMOR_TRAINING[character.class] ?? [])
                    .map((a) => a.charAt(0).toUpperCase() + a.slice(1))
                    .join(", ")
                  : "None"}
              </span>
            </div>
          </div>
        </div>

        <div>
          <p className="sheet-section-title">Ability Checks</p>
          {SKILLS.map((skill) => {
            const statKey =
              skill.stat.toLowerCase() as keyof Character["stats"];
            const proficient = proficientSkills.has(skill.name);
            const bonus =
              modNum(character.stats[statKey]) + (proficient ? PROF : 0);
            return (
              <div
                key={skill.name}
                className="sheet-save-row sheet-save-row--clickable"
                onClick={() =>
                  dispatch("vtt:roll:check", {
                    characterId: character.id,
                    campaignId: character.campaignId,
                    stat: statKey,
                    skill: skill.name,
                  })
                }
                title={`Roll ${skill.name} check`}
              >
                <span
                  className={`sheet-save-dot${proficient ? " sheet-save-dot--filled" : ""}`}
                />
                <span className="sheet-save-label">{skill.name}</span>
                <span className="sheet-save-val sheet-save-stat">
                  {skill.stat}
                </span>
                <span className="sheet-save-val">
                  {bonus >= 0 ? `+${bonus}` : bonus}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────

function FeaturesTab({ character }: { character: Character }) {
  const cls = character.class;
  return (
    <>
      {(CLASS_FEATURES[cls] ?? []).length > 0 && (
        <div className="sheet-feature-group">
          <p className="sheet-feature-group-title">{cls} Features</p>
          {CLASS_FEATURES[cls]!.map((f) => (
            <div key={f.name} className="sheet-feature">
              <div className="sheet-feature-name">{f.name}</div>
              <div className="sheet-feature-desc">{f.description}</div>
            </div>
          ))}
        </div>
      )}

      {(SPECIES_FEATURES[character.species] ?? []).length > 0 && (
        <div className="sheet-feature-group">
          <p className="sheet-feature-group-title">
            {character.species} Traits
          </p>
          {SPECIES_FEATURES[character.species]!.map((f) => (
            <div key={f.name} className="sheet-feature">
              <div className="sheet-feature-name">{f.name}</div>
              <div className="sheet-feature-desc">{f.description}</div>
            </div>
          ))}
        </div>
      )}

      {(BACKGROUND_FEAT[character.background] ||
        (BACKGROUND_SKILLS[character.background] ?? []).length > 0) && (
          <div className="sheet-feature-group">
            <p className="sheet-feature-group-title">
              {character.background} Background
            </p>
            {BACKGROUND_FEAT[character.background] && (
              <div className="sheet-feature">
                <div className="sheet-feature-name">
                  {BACKGROUND_FEAT[character.background]!.name}
                </div>
                <div className="sheet-feature-desc">
                  {BACKGROUND_FEAT[character.background]!.description}
                </div>
              </div>
            )}
            {(BACKGROUND_SKILLS[character.background] ?? []).length > 0 && (
              <div className="sheet-feature">
                <div className="sheet-feature-name">Skill Proficiencies</div>
                <div className="sheet-feature-desc">
                  {BACKGROUND_SKILLS[character.background]!.join(", ")}
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}

// ── Inventory ─────────────────────────────────────────────────────────────────

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

function ActionCostDot({
  cost,
}: {
  cost: "action" | "bonusAction" | "reaction" | null;
}) {
  if (!cost) return null;
  const label =
    cost === "action"
      ? "Action"
      : cost === "bonusAction"
        ? "Bonus Action"
        : "Reaction";
  return (
    <span className={`sheet-cost-dot sheet-cost-dot--${cost}`} title={label} />
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

function InventoryTab({
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

// ── Spells ────────────────────────────────────────────────────────────────────

const LEVEL_HEADINGS: Record<number, string> = {
  0: "Cantrips",
  1: "First Level",
  2: "Second Level",
  3: "Third Level",
  4: "Fourth Level",
  5: "Fifth Level",
  6: "Sixth Level",
  7: "Seventh Level",
  8: "Eighth Level",
  9: "Ninth Level",
};

function SpellsTab({
  character,
  combatActive,
  isMyTurn,
  actionAvailable,
  bonusActionAvailable,
  reactionAvailable,
}: {
  character: Character;
  combatActive: boolean;
  isMyTurn: boolean;
  actionAvailable: boolean;
  bonusActionAvailable: boolean;
  reactionAvailable: boolean;
}) {
  const learnedNames = character.spells ?? [];
  const [spells, setSpells] = useState<Spell[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Spell | null>(null);

  const resourceAvailable: Record<
    "action" | "bonusAction" | "reaction",
    boolean
  > = {
    action: actionAvailable,
    bonusAction: bonusActionAvailable,
    reaction: reactionAvailable,
  };

  const mainHandItem = character.inventory?.find(
    (i) => i.id === character.equipment?.mainHand,
  );
  const mainHandWeapon =
    mainHandItem && isWeapon(mainHandItem) ? mainHandItem : undefined;

  // One-shot self-buffs that only matter on the weapon hit they're cast for (Divine Smite, ...) —
  // bundle cast + attack into one interaction rather than a separate "next hit" queue. Duration
  // buffs like Divine Favor/Zephyr Strike stay on the old immediate-self-cast path below.
  function isBundledSmite(spell: Spell): boolean {
    return (
      spell.combat?.resolution === "none" &&
      !spell.combat?.save &&
      parseRangeFeet(spell.range) === 0 &&
      spell.duration === "Instantaneous" &&
      !!spell.combat?.onHit?.some((e) => e.type === "damage")
    );
  }

  function handleCast(spell: Spell) {
    const cost = actionCostFromCastingTime(spell.castingTime);
    if (!combatActive || !isMyTurn || !cost || !resourceAvailable[cost]) return;

    if (isBundledSmite(spell)) {
      if (!mainHandWeapon || !actionAvailable) return;
      dispatch("vtt:sheet:closed", {});
      dispatch("vtt:targeting:start", {
        kind: "weapon",
        weapon: mainHandWeapon,
        actionType: "action",
        bonusSpell: spell,
      });
      return;
    }

    dispatch("vtt:sheet:closed", {});

    // Self-range, no area (pure buff/utility) — nothing to place, just resolve immediately.
    if (parseRangeFeet(spell.range) === 0 && !spell.combat?.area) {
      dispatch("vtt:combat:spell:cast", {
        casterName: character.name,
        casterId: character.id,
        spell,
        slotLevel: spell.level,
        targetIds: [character.id],
      });
      return;
    }
    dispatch("vtt:targeting:start", {
      kind: "spell",
      spell,
      casterId: character.id,
      actionType: cost,
    });
  }

  useEffect(() => {
    if (!learnedNames.length) return;
    fetch(`${API}/api/spells?class=${encodeURIComponent(character.class)}`)
      .then((r) => r.json())
      .then((all: Spell[]) =>
        setSpells(all.filter((s) => learnedNames.includes(s.name))),
      )
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.class, learnedNames.join(",")]);

  const filtered = useMemo(() => {
    if (!search.trim()) return spells;
    const q = search.toLowerCase();
    return spells.filter((s) => s.name.toLowerCase().includes(q));
  }, [spells, search]);

  const byLevel = useMemo(() => {
    const map = new Map<number, Spell[]>();
    for (const s of filtered) {
      const bucket = map.get(s.level) ?? [];
      bucket.push(s);
      map.set(s.level, bucket);
    }
    return map;
  }, [filtered]);

  return (
    <>
      <input
        className="sheet-spells-search"
        placeholder="Search spells…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {selected && (
        <div className="sheet-spell-detail">
          <div className="sheet-spell-detail-header">
            <div>
              <span className="sheet-spell-detail-name">{selected.name}</span>
              <span className="sheet-spell-detail-sub">
                {selected.levelLabel} · {selected.school}
                {selected.isRitual ? " · Ritual" : ""}
              </span>
            </div>
            <button
              className="sheet-spell-detail-close"
              onClick={() => setSelected(null)}
            >
              ×
            </button>
          </div>
          <dl className="sheet-spell-detail-stats">
            <dt>Casting Time</dt>
            <dd>{selected.castingTime}</dd>
            <dt>Range</dt>
            <dd>{selected.range}</dd>
            <dt>Components</dt>
            <dd>{selected.components}</dd>
            <dt>Duration</dt>
            <dd>{selected.duration}</dd>
          </dl>
          <p className="sheet-spell-detail-text">{selected.text}</p>
          {selected.atHigherLevels && (
            <p className="sheet-spell-detail-higher">
              <em>At Higher Levels.</em> {selected.atHigherLevels}
            </p>
          )}
          {(() => {
            const cost = actionCostFromCastingTime(selected.castingTime);
            const disabled =
              !combatActive || !isMyTurn || !cost || !resourceAvailable[cost] ||
              (isBundledSmite(selected) && (!mainHandWeapon || !actionAvailable));
            return (
              <button
                className={`sheet-spell-cast-btn${disabled ? " sheet-spell-cast-btn--disabled" : ""}`}
                disabled={disabled}
                onClick={() => handleCast(selected)}
              >
                {isBundledSmite(selected) ? (
                  <>
                    <ActionCostDot cost="action" />
                    <ActionCostDot cost="bonusAction" />
                  </>
                ) : (
                  <ActionCostDot cost={cost} />
                )}
                Cast
              </button>
            );
          })()}
        </div>
      )}

      {byLevel.size === 0 && (
        <div className="sheet-empty">
          <p className="sheet-empty-title">No results</p>
          <p className="sheet-empty-hint">No spells match "{search}"</p>
        </div>
      )}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => {
        const group = byLevel.get(level);
        if (!group?.length) return null;
        return (
          <div key={level} className="sheet-inv-section">
            <p className="sheet-inv-section-title">{LEVEL_HEADINGS[level]}</p>
            <div className="sheet-inventory">
              {group.map((spell) => (
                <div
                  key={spell.name}
                  className={`sheet-inv-card sheet-inv-card--spell${selected?.name === spell.name ? " sheet-inv-card--spell-active" : ""}`}
                  onClick={() =>
                    setSelected((s) => (s?.name === spell.name ? null : spell))
                  }
                >
                  <div className="sheet-inv-card-header">
                    <span className="sheet-inv-name">{spell.name}</span>
                    <div className="sheet-inv-card-header-right">
                      <ActionCostDot
                        cost={actionCostFromCastingTime(spell.castingTime)}
                      />
                      {spell.isRitual && (
                        <span className="sheet-spell-ritual">R</span>
                      )}
                    </div>
                  </div>
                  <p className="sheet-inv-desc">
                    {spell.school} · {spell.castingTime}
                  </p>
                  <p className="sheet-inv-desc">
                    {spell.range} · {spell.duration}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

const BASE_TABS: { id: SheetTab; label: string }[] = [
  { id: "abilities", label: "Abilities" },
  { id: "features", label: "Features" },
  { id: "inventory", label: "Inventory" },
];

// XP required to reach each level (index = level, so index 1 = 300 XP to reach level 2)
const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000,
  120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

export default function CharacterSheetOverlay({
  character,
  currentHp,
  maxHp,
  sessionActive,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<SheetTab>("abilities");
  const hasSpells = (character.spells?.length ?? 0) > 0;
  const TABS = hasSpells
    ? [...BASE_TABS, { id: "spells" as SheetTab, label: "Spells" }]
    : BASE_TABS;
  const [combatActive, setCombatActive] = useState(false);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [actionAvailable, setActionAvailable] = useState(true);
  const [bonusActionAvailable, setBonusActionAvailable] = useState(true);
  const [reactionAvailable, setReactionAvailable] = useState(true);
  useEffect(
    () =>
      on("vtt:combat:state", ({ active }) => {
        setCombatActive(active);
        if (!active) {
          setIsMyTurn(false);
          setActionAvailable(true);
          setBonusActionAvailable(true);
          setReactionAvailable(true);
        }
      }),
    [],
  );
  useEffect(
    () =>
      on("vtt:combat:turn", ({ actorName }) => {
        const mine = actorName === character.name;
        setIsMyTurn(mine);
        if (mine) {
          setActionAvailable(true);
          setBonusActionAvailable(true);
          setReactionAvailable(true);
        }
      }),
    [character.name],
  );
  useEffect(
    () => on("vtt:combat:action:spent", () => setActionAvailable(false)),
    [],
  );
  useEffect(
    () =>
      on("vtt:combat:bonusAction:spent", () => setBonusActionAvailable(false)),
    [],
  );
  useEffect(
    () => on("vtt:combat:reaction:spent", () => setReactionAvailable(false)),
    [],
  );
  const [currentXp, setCurrentXp] = useState(character.xp ?? 0);
  const [currentLevel, setCurrentLevel] = useState(character.level ?? 1);
  const [profBonus, setProfBonus] = useState(
    character.proficiencyBonus ?? profBonusForLevel(character.level ?? 1),
  );
  useEffect(() => {
    setCurrentXp(character.xp ?? 0);
  }, [character.xp]);
  useEffect(() => {
    setCurrentLevel(character.level ?? 1);
    setProfBonus(
      character.proficiencyBonus ?? profBonusForLevel(character.level ?? 1),
    );
  }, [character.level, character.proficiencyBonus]);

  async function handleLevelUp() {
    const newLevel = currentLevel + 1;
    const newProf = profBonusForLevel(newLevel);
    setCurrentLevel(newLevel);
    setProfBonus(newProf);
    await fetch(
      `${API}/api/campaigns/${character.campaignId}/party/${character.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: newLevel, proficiencyBonus: newProf }),
      },
    );
  }

  useEffect(() => {
    const unsubOpen = on("vtt:sheet:opened", () => setVisible(true));
    const unsubClose = on("vtt:sheet:closed", () => setVisible(false));
    return () => {
      unsubOpen();
      unsubClose();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dispatch("vtt:sheet:closed", {});
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  if (!visible) return null;

  const hitDie = HIT_DICE[character.class] ?? 8;
  const derivedMaxHp = hitDie + modNum(character.stats.con);
  const displayMax = maxHp ?? character.maxHp ?? derivedMaxHp;
  const displayCurrent = currentHp ?? character.currentHp ?? displayMax;

  const acBreakdown = calcACBreakdown(character);
  const ac = acBreakdown.total;
  const acTooltip =
    acBreakdown.parts
      .map((p) => `${p.label}: ${p.value >= 0 ? "+" : ""}${p.value}`)
      .join("\n") + `\nTotal: ${ac}`;

  const portraitCharId = character.portraitPath
    ? (character.portraitPath.split("/")[1] ?? character.id)
    : character.id;
  const portraitUrl = character.portraitPath
    ? `${API}/api/campaigns/${character.campaignId}/party/${portraitCharId}/portrait`
    : null;

  return (
    <div className="sheet-scrim">
      <div className="sheet-panel">
        <div className="sheet-topbar">
          {portraitUrl ? (
            <img
              className="sheet-portrait"
              src={portraitUrl}
              alt={character.name}
            />
          ) : (
            <div className="sheet-portrait-placeholder" />
          )}
          <div className="sheet-identity">
            <p className="sheet-name">{character.name}</p>
            <p className="sheet-subtitle">
              {character.class} · {character.species} · {character.background}
            </p>
          </div>
          <button
            className={`sheet-rest-btn${combatActive ? " sheet-rest-btn--disabled" : ""}`}
            disabled={combatActive}
            onClick={
              combatActive
                ? undefined
                : () => {
                  dispatch("vtt:sheet:closed", {});
                  dispatch("vtt:rest:open", {});
                }
            }
          >
            Rest
          </button>
          <button
            className="sheet-close"
            onClick={() => dispatch("vtt:sheet:closed", {})}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="sheet-hp-strip">
          <span className="sheet-hp-strip-label">HP</span>
          <span
            className={`sheet-hp-strip-value${displayCurrent < displayMax ? " sheet-hp-strip-value--damaged" : ""}`}
          >
            {displayCurrent} / {displayMax}
          </span>
          <span className="sheet-hp-strip-sep" />
          <span
            className="sheet-hp-strip-label sheet-ac-tooltip"
            data-tooltip={acTooltip}
          >
            AC
          </span>
          <span
            className="sheet-hp-strip-value sheet-ac-tooltip"
            data-tooltip={acTooltip}
          >
            {ac}
          </span>
          <span className="sheet-hp-strip-sep" />
          <span className="sheet-hp-strip-label">INIT</span>
          <span className="sheet-hp-strip-value">
            {(() => {
              const n =
                modNum(character.stats.dex) + (character.initiativeBonus ?? 0);
              return n >= 0 ? `+${n}` : `${n}`;
            })()}
          </span>
          <span className="sheet-hp-strip-sep" />
          <span className="sheet-hp-strip-label">PROF</span>
          <span className="sheet-hp-strip-value">+{profBonus}</span>
          {(() => {
            const nextThreshold = XP_THRESHOLDS[currentLevel] ?? null;
            const canLevel =
              nextThreshold !== null &&
              currentXp >= nextThreshold &&
              currentLevel < 20;
            const levelFloor = XP_THRESHOLDS[currentLevel - 1] ?? 0;
            const barMax =
              nextThreshold !== null ? nextThreshold - levelFloor : 1;
            const barVal =
              nextThreshold !== null
                ? Math.min(currentXp - levelFloor, barMax)
                : barMax;
            return (
              <div className="sheet-xp">
                <progress
                  className="sheet-xp-bar"
                  max={barMax}
                  value={barVal}
                />
                <span className="sheet-xp-label">
                  {currentXp.toLocaleString()} /{" "}
                  {nextThreshold !== null
                    ? nextThreshold.toLocaleString()
                    : "—"}{" "}
                  XP
                </span>
                {currentLevel < 20 && (
                  <button
                    className={`sheet-levelup-btn${canLevel ? " sheet-levelup-btn--ready" : ""}`}
                    disabled={!canLevel}
                    onClick={() => void handleLevelUp()}
                  >
                    LEVEL UP
                  </button>
                )}
              </div>
            );
          })()}
        </div>

        <div className="sheet-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`sheet-tab${tab === t.id ? " sheet-tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="sheet-content">
          {tab === "abilities" && <AbilitiesTab character={character} />}
          {tab === "features" && <FeaturesTab character={character} />}
          {tab === "inventory" && (
            <InventoryTab character={character} sessionActive={sessionActive} />
          )}
          {tab === "spells" && (
            <SpellsTab
              character={character}
              combatActive={combatActive}
              isMyTurn={isMyTurn}
              actionAvailable={actionAvailable}
              bonusActionAvailable={bonusActionAvailable}
              reactionAvailable={reactionAvailable}
            />
          )}
        </div>
      </div>
    </div>
  );
}
