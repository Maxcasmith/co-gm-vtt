import { useEffect, useState } from "react";
import type { Character, CharacterClassLevel, CharacterStoryboard, HouseRules, StoryboardQueuePayload, WorldMeta } from "shared";
import { calcACBreakdown, characterClasses, DEFAULT_HOUSE_RULES, spellSlotsForCharacter } from "shared";
import { on, dispatch } from "./events.ts";
import { Button } from "./components/Button/Button.tsx";
import { HIT_DICE } from "./character-creation/srd.ts";
import { API, modNum, profBonusForLevel } from "./characterSheet/helpers.tsx";
import { AbilitiesTab } from "./characterSheet/AbilitiesTab.tsx";
import { FeaturesTab } from "./characterSheet/FeaturesTab.tsx";
import { InventoryTab } from "./characterSheet/InventoryTab.tsx";
import { SpellsTab } from "./characterSheet/SpellsTab.tsx";
import { ScoresTab } from "./characterSheet/ScoresTab.tsx";
import { AITab } from "./characterSheet/AITab.tsx";
import { InfoTab } from "./characterSheet/InfoTab.tsx";
import StoryboardOverlay from "./StoryboardOverlay.tsx";
import { LevelUpScreen, bumpClass } from "./characterSheet/LevelUpScreen.tsx";

type SheetTab = "abilities" | "features" | "inventory" | "spells" | "ai" | "scores" | "info";

interface Props {
  character: Character;
  currentHp?: number;
  maxHp?: number;
  tempHp?: number;
  currentSpellSlots1?: number;
  maxSpellSlots1?: number;
  sessionActive: boolean;
}

const TAB_ORDER: { id: SheetTab; label: string }[] = [
  { id: "abilities", label: "Abilities" },
  { id: "inventory", label: "Inventory" },
  { id: "spells", label: "Spells" },
  { id: "features", label: "Features" },
  { id: "ai", label: "Combat AI" },
  { id: "scores", label: "Scores" },
  { id: "info", label: "Info" },
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
  tempHp,
  currentSpellSlots1,
  maxSpellSlots1,
  sessionActive,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<SheetTab>("abilities");
  const [playingBackstory, setPlayingBackstory] = useState<CharacterStoryboard | null>(null);
  const [levelingUp, setLevelingUp] = useState(false);
  const hasSpells = (character.spells?.length ?? 0) > 0;
  // The Info tab is the backstory/storyboard tab — meaningless outside a real campaign (one-shots
  // and dungeon-crawls don't carry a character arc the same way) and pointless with no backstory
  // to show, so it doesn't exist at all rather than existing empty.
  const [worldType, setWorldType] = useState<WorldMeta["type"] | null>(null);
  const [houseRules, setHouseRules] = useState<HouseRules>(DEFAULT_HOUSE_RULES);
  useEffect(() => {
    fetch(`${API}/api/campaigns/${character.campaignId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: WorldMeta | null) => {
        setWorldType(m?.type ?? null);
        setHouseRules({ ...DEFAULT_HOUSE_RULES, ...m?.houseRules });
      })
      .catch(() => setWorldType(null));
  }, [character.campaignId]);
  const hasBackstory = !!character.backstory?.trim();
  const showInfoTab = worldType === "campaign" && hasBackstory;
  const TABS = TAB_ORDER.filter((t) => (t.id !== "spells" || hasSpells) && (t.id !== "info" || showInfoTab));
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
  const hitDie = HIT_DICE[character.class] ?? 8;
  const conMod = modNum(character.stats.con);
  const [currentMaxHp, setCurrentMaxHp] = useState(
    character.maxHp ?? hitDie + conMod,
  );
  const [currentClasses, setCurrentClasses] = useState<CharacterClassLevel[]>(() =>
    characterClasses(character),
  );
  const [currentMaxSlots1, setCurrentMaxSlots1] = useState(
    character.maxSpellSlots1 ?? spellSlotsForCharacter(character),
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
  useEffect(() => {
    setCurrentMaxHp(character.maxHp ?? hitDie + conMod);
  }, [character.maxHp, hitDie, conMod]);
  useEffect(() => {
    setCurrentClasses(characterClasses(character));
  }, [character.classes, character.class, character.level]);
  useEffect(() => {
    setCurrentMaxSlots1(character.maxSpellSlots1 ?? spellSlotsForCharacter(character));
  }, [character.maxSpellSlots1, character.classes, character.class, character.level]);

  async function handleLevelUp(chosenClass: string, hpGain: number) {
    const newClasses = bumpClass(currentClasses, chosenClass);
    const newLevel = newClasses.reduce((sum, c) => sum + c.level, 0);
    const newProf = profBonusForLevel(newLevel);
    const newMaxHp = currentMaxHp + hpGain;
    const newMaxSlots1 = spellSlotsForCharacter({ ...character, classes: newClasses });
    const newCurrentSlots1 = Math.max(
      0,
      (character.currentSpellSlots1 ?? currentMaxSlots1) + (newMaxSlots1 - currentMaxSlots1),
    );
    setCurrentClasses(newClasses);
    setCurrentLevel(newLevel);
    setProfBonus(newProf);
    setCurrentMaxHp(newMaxHp);
    setCurrentMaxSlots1(newMaxSlots1);
    await fetch(
      `${API}/api/campaigns/${character.campaignId}/party/${character.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classes: newClasses,
          level: newLevel,
          proficiencyBonus: newProf,
          maxHp: newMaxHp,
          currentHp: (character.currentHp ?? newMaxHp - hpGain) + hpGain,
          maxSpellSlots1: newMaxSlots1,
          currentSpellSlots1: newCurrentSlots1,
        }),
      },
    );
  }

  useEffect(() => {
    const unsubOpen = on("vtt:sheet:opened", () => setVisible(true));
    const unsubClose = on("vtt:sheet:closed", () => {
      setVisible(false);
      setPlayingBackstory(null);
      setLevelingUp(false);
    });
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

  if (playingBackstory) {
    const queue: StoryboardQueuePayload = {
      entries: [{ characterId: character.id, characterName: character.name, slides: playingBackstory.slides }],
    };
    return <StoryboardOverlay queue={queue} onDone={() => setPlayingBackstory(null)} />;
  }

  if (levelingUp) {
    return (
      <LevelUpScreen
        character={character}
        classes={currentClasses}
        fromLevel={currentLevel}
        toLevel={currentLevel + 1}
        currentMaxHp={currentMaxHp}
        currentMaxSlots1={currentMaxSlots1}
        conMod={conMod}
        levelUpHpMode={houseRules.levelUpHp}
        onConfirm={(chosenClass, hpGain) => {
          void handleLevelUp(chosenClass, hpGain);
          setLevelingUp(false);
        }}
        onClose={() => setLevelingUp(false)}
      />
    );
  }

  const displayMax = maxHp ?? currentMaxHp;
  const displayCurrent = currentHp ?? character.currentHp ?? displayMax;
  const displayTempHp = tempHp ?? character.tempHp ?? 0;

  const displayMaxSlots1 = maxSpellSlots1 ?? currentMaxSlots1;
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
              {currentClasses.length > 1
                ? currentClasses.map((c) => `${c.class} ${c.level}`).join(" / ")
                : character.class}{" "}
              · {character.species} · {character.background}
            </p>
          </div>
          <Button
            variant="ghost"
            className={`sheet-rest-btn${combatActive || !sessionActive ? " sheet-rest-btn--disabled" : ""}`}
            disabled={combatActive || !sessionActive}
            onClick={
              combatActive || !sessionActive
                ? undefined
                : () => {
                  dispatch("vtt:sheet:closed", {});
                  dispatch("vtt:rest:request", {});
                }
            }
          >
            Rest
          </Button>
          <Button
            variant="outline"
            color="secondary"
            className="sheet-close"
            onClick={() => dispatch("vtt:sheet:closed", {})}
            aria-label="Close"
          >
            ×
          </Button>
        </div>

        <div className="sheet-hp-strip">
          <span className="sheet-hp-strip-label">HP</span>
          <span
            className={`sheet-hp-strip-value${displayCurrent < displayMax ? " sheet-hp-strip-value--damaged" : ""}`}
          >
            {displayCurrent} / {displayMax}
          </span>
          {displayTempHp > 0 && (
            <span className="sheet-hp-strip-temp">+{displayTempHp} temp</span>
          )}
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
                  <Button
                    variant="ghost"
                    className={`sheet-levelup-btn${canLevel ? " sheet-levelup-btn--ready" : ""}`}
                    disabled={!canLevel}
                    onClick={() => setLevelingUp(true)}
                  >
                    LEVEL UP
                  </Button>
                )}
              </div>
            );
          })()}
        </div>

        <div className="sheet-tabs">
          {TABS.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              className={`sheet-tab${tab === t.id ? " sheet-tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        <div className="sheet-content">
          {tab === "abilities" && <AbilitiesTab character={character} />}
          {tab === "features" && <FeaturesTab character={character} />}
          {tab === "inventory" && (
            <InventoryTab character={character} sessionActive={sessionActive} />
          )}
          {tab === "ai" && <AITab character={character} />}
          {tab === "scores" && <ScoresTab character={character} />}
          {tab === "info" && (
            <InfoTab character={character} onPlay={setPlayingBackstory} />
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
