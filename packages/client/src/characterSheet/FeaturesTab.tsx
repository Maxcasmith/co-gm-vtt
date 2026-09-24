import type { Character } from "shared";
import { characterClasses, RESOURCE_DEFS, resourceCurrent, resourceMax } from "shared";
import { CLASS_FEATURES, SPECIES_FEATURES, BACKGROUND_FEAT, BACKGROUND_SKILLS, ORIGIN_FEAT_DETAILS } from "../character-creation/srd.ts";

// Matches a feature's display name to its RESOURCE_DEFS pool (Second Wind, Rage, Lucky, ...) so
// the uses badge works for any owned resource without hardcoding per-feature.
function resourceKeyForFeature(name: string): string | undefined {
  return Object.values(RESOURCE_DEFS).find((def) => def.label === name)?.key;
}

function FeatureUses({ character, name }: { character: Character; name: string }) {
  const key = resourceKeyForFeature(name);
  const max = key ? resourceMax(character, key) : 0;
  if (!key || max <= 0) return null;
  return <span className="sheet-feature-uses">{resourceCurrent(character, key)}/{max}</span>;
}

export function FeaturesTab({ character }: { character: Character }) {
  const classes = characterClasses(character);
  const bgFeatName = BACKGROUND_FEAT[character.background];
  const bgFeat = bgFeatName ? ORIGIN_FEAT_DETAILS[bgFeatName] : undefined;
  // Human gets a bonus Origin feat on top of the one from their background — see AttributesTab.tsx.
  const originFeat = character.species === "Human" && character.speciesOriginFeat
    ? ORIGIN_FEAT_DETAILS[character.speciesOriginFeat]
    : undefined;
  return (
    <>
      {classes.map((c) => (CLASS_FEATURES[c.class] ?? []).length > 0 && (
        <div key={c.class} className="sheet-feature-group">
          <p className="sheet-feature-group-title">{c.class} Features</p>
          {CLASS_FEATURES[c.class]!.map((f) => (
            <div key={f.name} className="sheet-feature">
              <div className="sheet-feature-name">{f.name}<FeatureUses character={character} name={f.name} /></div>
              <div className="sheet-feature-desc">{f.description}</div>
            </div>
          ))}
        </div>
      ))}

      {((SPECIES_FEATURES[character.species] ?? []).length > 0 || originFeat) && (
        <div className="sheet-feature-group">
          <p className="sheet-feature-group-title">
            {character.species} Traits
          </p>
          {(SPECIES_FEATURES[character.species] ?? []).map((f) => (
            <div key={f.name} className="sheet-feature">
              <div className="sheet-feature-name">{f.name}<FeatureUses character={character} name={f.name} /></div>
              <div className="sheet-feature-desc">{f.description}</div>
            </div>
          ))}
          {originFeat && (
            <div className="sheet-feature">
              <div className="sheet-feature-name">
                {originFeat.name}<FeatureUses character={character} name={originFeat.name} />
              </div>
              <div className="sheet-feature-desc">{originFeat.description}</div>
            </div>
          )}
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
                  {bgFeat.name}<FeatureUses character={character} name={bgFeat.name} />
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
