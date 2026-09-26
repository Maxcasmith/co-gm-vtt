// Standalone check for checkModifiers/saveModifiers — no test framework in this repo, so this is
// the one runnable check: `tsx src/combat/runtime/rolls.modifiers.selfcheck.ts` from packages/api.
// Asserts: real Proficiency Bonus (not a flat +2), Expertise as its own line, Guidance only on its
// chosen skill, Bardic Inspiration (one-shot) on checks but Bless/Bane (persistent) only on saves.
import assert from 'node:assert';
import type { Character, CharacterStats } from 'shared';
import { StateEngine } from '../stateEngine/StateEngine.ts';
import { RollModifierHook } from '../stateEngine/hooks/RollModifierHook.ts';
import { checkModifiers, saveModifiers, rollSave, effectConditions } from './rolls.ts';

const stats: CharacterStats = { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const char: Character = {
  id: 'hero', campaignId: 'cid', name: 'Hero', species: 'Human', background: 'Sage', class: 'Fighter',
  stats, skillProficiencies: ['Athletics'], expertiseSkills: ['Athletics'], proficiencyBonus: 4,
  password: '', portraitPath: '', tokenPath: '', createdAt: '',
};
const labels = (mods: { label: string }[]) => mods.map(m => m.label);

// Level-9 PB, Expertise doubling as a second line.
assert.deepStrictEqual(checkModifiers(new StateEngine('t'), 'hero', stats, char, 'str', 'Athletics'), [
  { label: 'Strength', value: 3 }, { label: 'Proficiency', value: 4 }, { label: 'Expertise', value: 4 },
]);
// Not proficient — ability only.
assert.deepStrictEqual(labels(checkModifiers(new StateEngine('t'), 'hero', stats, char, 'str', 'Stealth')), ['Strength']);
// Fighter saves: STR proficient.
assert.deepStrictEqual(saveModifiers(new StateEngine('t'), 'hero', stats, char, 'str'), [{ label: 'Strength', value: 3 }, { label: 'Proficiency', value: 4 }]);

{
  const engine = new StateEngine('t');
  engine.register(new RollModifierHook({ ownerId: 'hero', source: 'Bless', kind: 'rollModifier', dieSize: 4, sign: 1 }));
  engine.register(new RollModifierHook({ ownerId: 'hero', source: 'Guidance', kind: 'rollModifierCheck', dieSize: 4, sign: 1, skill: 'Athletics' }));
  engine.register(new RollModifierHook({ ownerId: 'hero', source: 'Bardic Inspiration', kind: 'rollModifier', dieSize: 6, sign: 1, consumeOnUse: true }));

  // Guidance only on its own skill; Bless never on a check.
  assert.deepStrictEqual(labels(checkModifiers(engine, 'hero', stats, char, 'str', 'Stealth')), ['Strength', 'Bardic Inspiration (d6)']);
  // Bardic was spent on that check — the next one gets Guidance only.
  assert.deepStrictEqual(labels(checkModifiers(engine, 'hero', stats, char, 'str', 'Athletics')), ['Strength', 'Proficiency', 'Expertise', 'Guidance (d4)']);
  // Bless applies to saves.
  assert.deepStrictEqual(labels(saveModifiers(engine, 'hero', stats, char, 'str')), ['Strength', 'Proficiency', 'Bless (d4)']);
}

// Species save Advantage: Brave only when the save is against Frightened; Gnomish Cunning on any mental save.
{
  const engine = new StateEngine('t');
  const halfling = { ...char, species: 'Halfling' };
  const sources = (c: Character, ability: 'wis' | 'dex', against: string[]) => rollSave(engine, 'hero', stats, {}, c, ability, [], against).modeSources.map(s => s.label);
  assert.deepStrictEqual(sources(halfling, 'wis', ['Frightened']), ['Brave']);
  assert.deepStrictEqual(sources(halfling, 'wis', []), []);
  assert.deepStrictEqual(sources({ ...char, species: 'Gnome' }, 'wis', []), ['Gnomish Cunning']);
  assert.deepStrictEqual(sources({ ...char, species: 'Gnome' }, 'dex', []), []);
  const warlock = { ...char, invocations: ['Eldritch Mind'] };
  assert.deepStrictEqual(rollSave(engine, 'hero', stats, {}, warlock, 'con', [], ['Concentrating']).modeSources.map(s => s.label), ['Eldritch Mind']);
  assert.deepStrictEqual(rollSave(engine, 'hero', stats, {}, warlock, 'con', [], []).modeSources.map(s => s.label), []);
  assert.deepStrictEqual(effectConditions([{ type: 'condition', condition: 'Charmed' }], [{ type: 'recurringDamage', duration: { until: 'endOfCombat' }, conditionNames: ['Prone', 'Incapacitated'] }]), ['Charmed', 'Prone', 'Incapacitated']);
}

console.log('rolls.modifiers.selfcheck: all assertions passed');
