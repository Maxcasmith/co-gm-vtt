import { useCharacter } from './CharacterContext.tsx';
import { FIGHTING_STYLES, DIVINE_ORDERS, PRIMAL_ORDERS, ELDRITCH_INVOCATIONS, CLASS_FEATURES } from './srd.ts';
import ChoicePicker from './ChoicePicker.tsx';

const INVOCATION_COUNT = 2;

export function hasClassFeaturesStep(characterClass: string): boolean {
  const features = CLASS_FEATURES[characterClass] ?? [];
  return features.some(f => f.name === 'Fighting Style' || f.name === 'Divine Order' || f.name === 'Primal Order' || f.name === 'Eldritch Invocations');
}

export default function ClassFeaturesTab() {
  const c = useCharacter();
  const features = CLASS_FEATURES[c.characterClass] ?? [];
  const hasFightingStyle = features.some(f => f.name === 'Fighting Style');
  const hasClassOrder = features.some(f => f.name === 'Divine Order' || f.name === 'Primal Order');
  const hasInvocations = features.some(f => f.name === 'Eldritch Invocations');

  function toggleInvocation(name: string) {
    const idx = c.invocations.indexOf(name);
    if (idx >= 0) {
      c.set('invocations', c.invocations.filter(n => n !== name));
    } else {
      if (c.invocations.length >= INVOCATION_COUNT) return;
      c.set('invocations', [...c.invocations, name]);
    }
  }

  return (
    <>
      {hasFightingStyle && (
        <ChoicePicker
          title="Fighting Style"
          options={FIGHTING_STYLES}
          selected={c.fightingStyle ? [c.fightingStyle] : []}
          onToggle={name => c.set('fightingStyle', name)}
        />
      )}
      {hasClassOrder && (
        <ChoicePicker
          title={c.characterClass === 'Cleric' ? 'Divine Order' : 'Primal Order'}
          options={c.characterClass === 'Cleric' ? DIVINE_ORDERS : PRIMAL_ORDERS}
          selected={c.classOrder ? [c.classOrder] : []}
          onToggle={name => c.set('classOrder', name)}
        />
      )}
      {hasInvocations && (
        <ChoicePicker
          title="Eldritch Invocations"
          options={ELDRITCH_INVOCATIONS}
          selected={c.invocations}
          max={INVOCATION_COUNT}
          onToggle={toggleInvocation}
        />
      )}
    </>
  );
}
