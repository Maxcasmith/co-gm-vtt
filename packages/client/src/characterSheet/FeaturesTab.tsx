import type { Character } from "shared";
import { CLASS_FEATURES, SPECIES_FEATURES, BACKGROUND_FEAT, BACKGROUND_SKILLS, ORIGIN_FEAT_DETAILS } from "../character-creation/srd.ts";

export function FeaturesTab({ character }: { character: Character }) {
  const cls = character.class;
  const bgFeatName = BACKGROUND_FEAT[character.background];
  const bgFeat = bgFeatName ? ORIGIN_FEAT_DETAILS[bgFeatName] : undefined;
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

      {(bgFeat ||
        (BACKGROUND_SKILLS[character.background] ?? []).length > 0) && (
          <div className="sheet-feature-group">
            <p className="sheet-feature-group-title">
              {character.background} Background
            </p>
            {bgFeat && (
              <div className="sheet-feature">
                <div className="sheet-feature-name">
                  {bgFeat.name}
                </div>
                <div className="sheet-feature-desc">
                  {bgFeat.description}
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
