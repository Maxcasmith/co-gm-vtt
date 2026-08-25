import { useCharacter } from './CharacterContext.tsx';
import { DIVINE_ORDERS, PRIMAL_ORDERS } from './srd.ts';
import ChoicePicker from './ChoicePicker.tsx';
import CharacterSheet from './CharacterSheet.tsx';

export default function OrderTab() {
  const c = useCharacter();
  const options = c.characterClass === 'Cleric' ? DIVINE_ORDERS : PRIMAL_ORDERS;
  const title = c.characterClass === 'Cleric' ? 'Divine Order' : 'Primal Order';

  return (
    <div className="player-info-layout">
      <div className="tab-content">
        <ChoicePicker
          title={title}
          options={options}
          selected={c.classOrder ? [c.classOrder] : []}
          onToggle={name => c.set('classOrder', name)}
        />
      </div>
      <CharacterSheet />
    </div>
  );
}
