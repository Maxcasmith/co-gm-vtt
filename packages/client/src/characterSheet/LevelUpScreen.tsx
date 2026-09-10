import { useState } from "react";
import type { Character, CharacterClassLevel, HouseRules } from "shared";
import { hasOriginFeat, hpBonusPerLevel, spellSlotsForCharacter } from "shared";
import { CLASSES, CLASS_FEATURES, HIT_DICE, meetsMulticlassPrereq } from "../character-creation/srd.ts";
import { Button } from "../components/Button/Button.tsx";

interface Props {
  character: Character;
  classes: CharacterClassLevel[];
  fromLevel: number;
  toLevel: number;
  currentMaxHp: number;
  currentMaxSlots1: number;
  conMod: number;
  levelUpHpMode: HouseRules["levelUpHp"];
  onConfirm: (chosenClass: string, hpGain: number) => void;
  onClose: () => void;
}

// ponytail: HP roll happens client-side, so a player could in principle edit local state to
// reroll before hitting Confirm — server-side authoritative roll if that's ever abused.
function rollHitDie(hitDie: number): number {
  return Math.floor(Math.random() * hitDie) + 1;
}

function hpDieResult(mode: HouseRules["levelUpHp"], hitDie: number): number {
  switch (mode) {
    case "average": return Math.floor(hitDie / 2) + 1;
    case "max": return hitDie;
    case "min": return 1;
    default: return rollHitDie(hitDie);
  }
}

const HP_MODE_LABEL: Record<HouseRules["levelUpHp"], string> = {
  roll: "Roll",
  average: "Take Average",
  max: "Take Maximum",
  min: "Take Minimum",
};

/** Bumps the chosen class's level by 1, or appends it at level 1 if this is a new class for the character. */
export function bumpClass(classes: CharacterClassLevel[], chosenClass: string): CharacterClassLevel[] {
  const existing = classes.find(c => c.class === chosenClass);
  if (!existing) return [...classes, { class: chosenClass, level: 1 }];
  return classes.map(c => (c.class === chosenClass ? { ...c, level: c.level + 1 } : c));
}

// Base level-up screen: swapped in over the sheet the same way CharacterSheetOverlay swaps in
// StoryboardOverlay for playingBackstory. Rolled/computed once per class choice so the preview
// shown here is exactly what Confirm applies — Ability Score Improvement lands here later.
export function LevelUpScreen({
  character,
  classes,
  fromLevel,
  toLevel,
  currentMaxHp,
  currentMaxSlots1,
  conMod,
  levelUpHpMode,
  onConfirm,
  onClose,
}: Props) {
  const [selectedClass, setSelectedClass] = useState(classes[0]?.class ?? character.class);
  const [dieResult, setDieResult] = useState(() =>
    hpDieResult(levelUpHpMode, HIT_DICE[selectedClass] ?? 8),
  );

  function handleClassChange(cls: string) {
    setSelectedClass(cls);
    setDieResult(hpDieResult(levelUpHpMode, HIT_DICE[cls] ?? 8));
  }

  const hitDie = HIT_DICE[selectedClass] ?? 8;
  const levelHpBonus = hpBonusPerLevel(character);
  const hpGain = Math.max(1, dieResult + conMod + levelHpBonus);
  const minHpGain = Math.max(1, 1 + conMod + levelHpBonus);
  const maxHpGain = Math.max(1, hitDie + conMod + levelHpBonus);
  const isHidden = levelUpHpMode === "roll";
  const hasTough = hasOriginFeat(character, "Tough");
  const isDwarf = character.species === "Dwarf";
  const nextClasses = bumpClass(classes, selectedClass);
  const nextMaxSlots1 = spellSlotsForCharacter({ ...character, classes: nextClasses });
  const isNewClass = !classes.some(c => c.class === selectedClass);

  return (
    <div className="sheet-scrim">
      <div className="sheet-panel level-up-panel">
        <div className="sheet-topbar">
          <div className="sheet-identity">
            <p className="sheet-name">Level Up</p>
            <p className="sheet-subtitle">
              {character.name} · {classes.map(c => `${c.class} ${c.level}`).join(" / ")} · Level {fromLevel} → {toLevel}
            </p>
          </div>
          <Button variant="outline" color="secondary" className="sheet-close" onClick={onClose} aria-label="Close">
            ×
          </Button>
        </div>

        <div className="sheet-content level-up-content">
          <div className="level-up-section">
            <p className="level-up-section-title">Class</p>
            <select
              className="settings-select"
              value={selectedClass}
              onChange={e => handleClassChange(e.target.value)}
            >
              {CLASSES.map(cls => {
                const already = classes.some(c => c.class === cls);
                const eligible = already || meetsMulticlassPrereq(cls, character.stats);
                return (
                  <option key={cls} value={cls} disabled={!eligible}>
                    {cls}
                    {!already && !eligible && " (prereq not met)"}
                  </option>
                );
              })}
            </select>
            <p className="level-up-hp-total">
              {nextClasses.map(c => `${c.class} ${c.level}`).join(" / ")}
              {isNewClass && " (multiclassing)"}
            </p>
          </div>

          <div className="level-up-section">
            <p className="level-up-section-title">Hit Points</p>
            {isHidden ? (
              <>
                <p className="level-up-hp-gain">
                  +{minHpGain}–{maxHpGain} HP <span className="level-up-hp-detail">
                    (Roll: d{hitDie}
                    {conMod >= 0 ? ` +${conMod}` : ` ${conMod}`} CON
                    {hasTough && " +2 Tough"}
                    {isDwarf && " +1 Dwarven Toughness"})
                  </span>
                </p>
                <p className="level-up-hp-total">
                  {currentMaxHp} → {currentMaxHp + minHpGain}–{currentMaxHp + maxHpGain} max HP
                </p>
              </>
            ) : (
              <>
                <p className="level-up-hp-gain">
                  +{hpGain} HP <span className="level-up-hp-detail">
                    ({HP_MODE_LABEL[levelUpHpMode]}: d{hitDie} → {dieResult}
                    {conMod >= 0 ? ` +${conMod}` : ` ${conMod}`} CON
                    {hasTough && " +2 Tough"}
                    {isDwarf && " +1 Dwarven Toughness"})
                  </span>
                </p>
                <p className="level-up-hp-total">
                  {currentMaxHp} → {currentMaxHp + hpGain} max HP
                </p>
              </>
            )}
          </div>

          {nextMaxSlots1 !== currentMaxSlots1 && (
            <div className="level-up-section">
              <p className="level-up-section-title">Spell Slots</p>
              <p className="level-up-hp-total">
                {currentMaxSlots1} → {nextMaxSlots1} level-1 slots
              </p>
            </div>
          )}

          <div className="level-up-section">
            <p className="level-up-section-title">{selectedClass} Features</p>
            {(CLASS_FEATURES[selectedClass] ?? []).map(f => (
              <p key={f.name} className="level-up-hp-total">
                <strong>{f.name}.</strong> {f.description}
              </p>
            ))}
          </div>

          <div className="level-up-section">
            <p className="level-up-section-title">Ability Score Improvement</p>
            <p className="level-up-placeholder">Coming soon</p>
          </div>
        </div>

        <div className="level-up-actions">
          <Button variant="ghost" className="sheet-rest-btn" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            className="sheet-levelup-btn sheet-levelup-btn--ready"
            onClick={() => onConfirm(selectedClass, hpGain)}
          >
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
