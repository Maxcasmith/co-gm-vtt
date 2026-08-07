import type { Character } from "shared";
import { CLASS_FEATURES, SPECIES_FEATURES, BACKGROUND_FEAT, BACKGROUND_SKILLS } from "../character-creation/srd.ts";

export function FeaturesTab({ character }: { character: Character }) {
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
