import { useCharacter } from './CharacterContext.tsx';
import { ELDRITCH_INVOCATIONS } from './srd.ts';
import ChoicePicker from './ChoicePicker.tsx';
import CharacterSheet from './CharacterSheet.tsx';

const INVOCATION_COUNT = 2;

export default function InvocationsTab() {
  const c = useCharacter();

  function toggle(name: string) {
    const idx = c.invocations.indexOf(name);
    if (idx >= 0) {
      c.set('invocations', c.invocations.filter(n => n !== name));
    } else {
      if (c.invocations.length >= INVOCATION_COUNT) return;
      c.set('invocations', [...c.invocations, name]);
    }
  }

  return (
    <div className="player-info-layout">
      <div className="tab-content">
        <ChoicePicker
          title="Eldritch Invocations"
          options={ELDRITCH_INVOCATIONS}
          selected={c.invocations}
          max={INVOCATION_COUNT}
          onToggle={toggle}
        />
      </div>
      <CharacterSheet />
    </div>
  );
}
