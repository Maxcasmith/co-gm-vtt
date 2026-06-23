import { useCharacter } from './CharacterContext.tsx';
import { CLASS_FEATURES } from './srd.ts';
import CharacterSheet from './CharacterSheet.tsx';

export default function SpellsTab() {
  const c = useCharacter();

  const isSpellcaster = c.characterClass
    ? (CLASS_FEATURES[c.characterClass] ?? []).some(f => f.name === 'Spellcasting' || f.name === 'Pact Magic')
    : false;

  return (
    <div className="player-info-layout">
      <div className="tab-content">
        <div className="spells-placeholder">
          {isSpellcaster ? (
            <>
              <p className="spells-placeholder-title">Spell Selection</p>
              <p className="spells-placeholder-body">
                {c.characterClass} spell slots and prepared spells will be configured here.
              </p>
            </>
          ) : (
            <>
              <p className="spells-placeholder-title">No Spellcasting</p>
              <p className="spells-placeholder-body">
                {c.characterClass
                  ? `${c.characterClass}s do not have the ability to cast spells.`
                  : 'Select a class to see spellcasting information.'}
              </p>
            </>
          )}
        </div>
      </div>
      <CharacterSheet />
    </div>
  );
}
