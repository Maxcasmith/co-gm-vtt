import type { Character, SenseKind } from "shared";
import { CLASS_WEAPON_PROFS, CLASS_ARMOR_TRAINING, getSenses } from "shared";
import { useState } from "react";
import { dispatch } from "../events.ts";
import { STAT_NAMES, CLASS_SAVING_THROWS, BACKGROUND_SKILLS, SKILLS } from "../character-creation/srd.ts";
import { mod, modNum, profBonusForLevel } from "./helpers.tsx";

const SENSE_LABEL: Record<SenseKind, string> = {
  darkvision: "Darkvision",
  blindsight: "Blindsight",
  truesight: "Truesight",
  devilsSight: "Devil's Sight",
  tremorsense: "Tremorsense",
};

const STAT_KEYS: Array<keyof Character["stats"]> = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
];

export function AbilitiesTab({ character }: { character: Character }) {
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
  const expertSkills = new Set<string>(character.expertiseSkills ?? []);

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
            <div className="sheet-proficiency-row">
              <span className="sheet-proficiency-label">Senses</span>
              <span className="sheet-proficiency-value">
                {getSenses(character.species).length > 0
                  ? getSenses(character.species)
                    .map((s) => `${SENSE_LABEL[s.kind]} ${s.rangeFt}ft`)
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
            const expert = proficient && expertSkills.has(skill.name);
            const bonus =
              modNum(character.stats[statKey]) +
              (expert ? PROF * 2 : proficient ? PROF : 0);
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
                title={`Roll ${skill.name} check${expert ? " (Expertise)" : ""}`}
              >
                <span
                  className={`sheet-save-dot${expert ? " sheet-save-dot--expert" : proficient ? " sheet-save-dot--filled" : ""}`}
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
