import type { Character, SenseKind } from "shared";
import { effectiveWeaponProfs, effectiveArmorTraining, getSenses } from "shared";
import { dispatch } from "../events.ts";
import { PipCounter } from "../components/PipCounter/PipCounter.tsx";
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
  const deathSuccesses = character.deathSaves?.successes ?? 0;
  const deathFailures = character.deathSaves?.failures ?? 0;

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

          <p className="sheet-section-title sheet-section-title--spaced">
            Death Saves
          </p>
          <div className="sheet-death-saves">
            <PipCounter
              color="deathSaveSuccess"
              shape="circle"
              max={3}
              current={deathSuccesses}
              title={`${deathSuccesses}/3 death save successes`}
            />
            <PipCounter
              color="deathSaveFailure"
              shape="circle"
              max={3}
              current={deathFailures}
              title={`${deathFailures}/3 death save failures`}
            />
          </div>

          <p className="sheet-section-title sheet-section-title--spaced">
            Proficiencies &amp; Training
          </p>
          <div className="sheet-proficiency-block">
            <div className="sheet-proficiency-row">
              <span className="sheet-proficiency-label">Weapons</span>
              <span className="sheet-proficiency-value">
                {effectiveWeaponProfs(character).length > 0
                  ? effectiveWeaponProfs(character)
                    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
                    .join(" & ") + " weapons"
                  : "None"}
              </span>
            </div>
            <div className="sheet-proficiency-row">
              <span className="sheet-proficiency-label">Armor</span>
              <span className="sheet-proficiency-value">
                {effectiveArmorTraining(character).length > 0
                  ? effectiveArmorTraining(character)
                    .map((a) => a.charAt(0).toUpperCase() + a.slice(1))
                    .join(", ")
                  : "None"}
              </span>
            </div>
            <div className="sheet-proficiency-row">
              <span className="sheet-proficiency-label">Senses</span>
              <span className="sheet-proficiency-value sheet-proficiency-value--list">
                {[
                  ...getSenses(character.species).map(
                    (s) => `${SENSE_LABEL[s.kind]} ${s.rangeFt}ft`,
                  ),
                  `Passive Perception ${8 + PROF + modNum(character.stats.wis)}`,
                  `Passive Insight ${8 + PROF + modNum(character.stats.wis)}`,
                ].map((line) => (
                  <span key={line}>{line}</span>
                ))}
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
