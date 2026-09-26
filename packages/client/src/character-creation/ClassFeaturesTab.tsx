import { useCharacter } from './CharacterContext.tsx';
import { FIGHTING_STYLES, DIVINE_ORDERS, PRIMAL_ORDERS, ELDRITCH_INVOCATIONS, CLASS_FEATURES, invocationPrerequisiteMet, invocationPrerequisiteText } from './srd.ts';
import ChoicePicker from './ChoicePicker.tsx';
import { INVOCATION_SPELLS } from 'shared';

const CREATION_LEVEL = 1;
const INVOCATION_NAMES = new Set(ELDRITCH_INVOCATIONS.map(i => i.name));

/** learnedSpells with every invocation-sourced pick (Mage Armor, Find Familiar, Tome picks) swapped for `invocation`'s grant. */
export function withInvocationSpells(learned: Record<string, string>, invocation?: string): Record<string, string> {
  const next = Object.fromEntries(Object.entries(learned).filter(([, src]) => !INVOCATION_NAMES.has(src)));
  const grant = invocation ? INVOCATION_SPELLS[invocation] : undefined;
  if (invocation && grant) next[grant.spell] ??= invocation;
  return next;
}

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
          title="Eldritch Invocation"
          options={ELDRITCH_INVOCATIONS
            // Creation is always Warlock level 1: level-gated invocations are hidden outright; one
            // whose level is met but needs another invocation shows locked until that's picked.
            .filter(inv => (inv.prerequisite?.level ?? 0) <= CREATION_LEVEL)
            .map(inv => invocationPrerequisiteMet(inv, CREATION_LEVEL, c.invocations) ? inv : { ...inv, disabledReason: `Requires ${invocationPrerequisiteText(inv)}` })}
          selected={c.invocations}
          onToggle={name => {
            c.set('invocations', [name]);
            c.set('learnedSpells', withInvocationSpells(c.learnedSpells, name));
          }}
        />
      )}
    </>
  );
}
