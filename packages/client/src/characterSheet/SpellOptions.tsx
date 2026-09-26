import type { Spell } from "shared";
import { Button } from "../components/Button/Button.tsx";
import { damageTypeOptionsFor, commandOptionsFor, skillOptionsFor } from "./spellCasting.ts";
import type { SpellChoices } from "./spellCasting.ts";

// Per-cast pickers (damage type, Command's word, skill) — shared by the sheet's spell detail
// and the combat hotbar's pre-cast modal. `customCommand` overrides the picked word when set.
export function SpellOptions({
  spell,
  choices,
  customCommand,
  onChange,
  onCustomCommandChange,
}: {
  spell: Spell;
  choices: SpellChoices;
  customCommand: string;
  onChange: (next: SpellChoices) => void;
  onCustomCommandChange: (value: string) => void;
}) {
  const damageTypes = damageTypeOptionsFor(spell);
  const commands = commandOptionsFor(spell);
  const skills = skillOptionsFor(spell);
  return (
    <>
      {damageTypes && (
        <div className="sheet-spell-damage-types">
          {damageTypes.map((type) => (
            <Button
              key={type}
              variant="ghost"
              className={`sheet-damage-type-btn sheet-damage-type-btn--${type.toLowerCase()}${choices.damageType === type ? " sheet-damage-type-btn--active" : ""}`}
              onClick={() => onChange({ ...choices, damageType: type })}
            >
              {type}
            </Button>
          ))}
        </div>
      )}
      {commands && (
        <div className="sheet-spell-damage-types">
          {commands.map((word) => (
            <Button
              key={word}
              variant="ghost"
              className={`sheet-damage-type-btn${!customCommand && choices.command === word ? " sheet-damage-type-btn--active" : ""}`}
              onClick={() => { onChange({ ...choices, command: word }); onCustomCommandChange(""); }}
            >
              {word}
            </Button>
          ))}
          <input
            className="sheet-command-custom-input"
            placeholder="Or your own word…"
            value={customCommand}
            maxLength={20}
            onChange={(e) => onCustomCommandChange(e.target.value.replace(/\s+/g, ""))}
          />
        </div>
      )}
      {skills && (
        <div className="sheet-spell-damage-types">
          {skills.map((s) => (
            <Button
              key={s}
              variant="ghost"
              className={`sheet-damage-type-btn${choices.skill === s ? " sheet-damage-type-btn--active" : ""}`}
              onClick={() => onChange({ ...choices, skill: s })}
            >
              {s}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
