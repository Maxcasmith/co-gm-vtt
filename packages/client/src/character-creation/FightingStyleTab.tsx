import { useCharacter } from './CharacterContext.tsx';
import { FIGHTING_STYLES } from './srd.ts';
import ChoicePicker from './ChoicePicker.tsx';
import CharacterSheet from './CharacterSheet.tsx';

export default function FightingStyleTab() {
  const c = useCharacter();

  return (
    <div className="player-info-layout">
      <div className="tab-content">
        <ChoicePicker
          title="Fighting Style"
          options={FIGHTING_STYLES}
          selected={c.fightingStyle ? [c.fightingStyle] : []}
          onToggle={name => c.set('fightingStyle', name)}
        />
      </div>
      <CharacterSheet />
    </div>
  );
}
