import { useEffect, useState } from "react";
import type { Character } from "shared";
import { calcACBreakdown, spellSlotsForClass } from "shared";
import { on, dispatch } from "./events.ts";
import { HIT_DICE } from "./character-creation/srd.ts";
import { API, modNum, profBonusForLevel } from "./characterSheet/helpers.tsx";
import { AbilitiesTab } from "./characterSheet/AbilitiesTab.tsx";
import { FeaturesTab } from "./characterSheet/FeaturesTab.tsx";
import { InventoryTab } from "./characterSheet/InventoryTab.tsx";
import { SpellsTab } from "./characterSheet/SpellsTab.tsx";

type SheetTab = "abilities" | "features" | "inventory" | "spells";

interface Props {
  character: Character;
  currentHp?: number;
  maxHp?: number;
  currentSpellSlots1?: number;
  maxSpellSlots1?: number;
  sessionActive: boolean;
}

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
  currentSpellSlots1,
  maxSpellSlots1,
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

  const derivedMaxSlots1 = spellSlotsForClass(character.class);
  const displayMaxSlots1 = maxSpellSlots1 ?? character.maxSpellSlots1 ?? derivedMaxSlots1;
  const displayCurrentSlots1 = currentSpellSlots1 ?? character.currentSpellSlots1 ?? displayMaxSlots1;

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
                  dispatch("vtt:rest:request", {});
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
              maxSpellSlots1={displayMaxSlots1}
              currentSpellSlots1={displayCurrentSlots1}
            />
          )}
        </div>
      </div>
    </div>
  );
}
