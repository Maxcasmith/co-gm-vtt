// Standalone invariant check for the conditions system — no test framework in this repo, so this
// is the one runnable check: `tsx src/combat/conditions/conditions.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import type { Character, CharacterStats, Spell } from 'shared';
import { requiresConcentration } from 'shared';
import { Poisoned } from './Poisoned.ts';
import { Concentrating } from './Concentrating.ts';
import { rollModeFor, addCondition, removeCondition } from './rollModeFor.ts';

const stats: CharacterStats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
function char(conditions: Character['conditions']): Character {
  return {
    id: 'c1', campaignId: 'cid', name: 'Hero', species: 'Human', background: 'Sage', class: 'Fighter',
    stats, skillProficiencies: [], password: '', portraitPath: '', tokenPath: '', createdAt: '',
    conditions,
  };
}

// Poisoned: disadvantage on attack/check, no effect on save.
assert.strictEqual(new Poisoned().effect('attack'), -1);
assert.strictEqual(new Poisoned().effect('check'), -1);
assert.strictEqual(new Poisoned().effect('save'), 0);

// rollModeFor reads it off the character.
assert.strictEqual(rollModeFor(char([{ name: 'Poisoned' }]), 'attack'), -1);
assert.strictEqual(rollModeFor(char([{ name: 'Poisoned' }]), 'save'), 0);
assert.strictEqual(rollModeFor(char(undefined), 'attack'), 0);

// addCondition dedupes — a character can't have the same condition twice.
const once = addCondition(undefined, 'Poisoned');
const twice = addCondition(once, 'Poisoned');
assert.strictEqual(once.length, 1);
assert.strictEqual(twice, once); // same reference back — no-op, not a new array

// removeCondition clears it, and no-ops (same reference back) if it's already gone.
const cleared = removeCondition(once, 'Poisoned');
assert.strictEqual(cleared.length, 0);
assert.strictEqual(removeCondition(cleared, 'Poisoned'), cleared);

// Concentrating: pure bookkeeping, no roll effect of its own.
assert.strictEqual(new Concentrating().effect('attack'), 0);
assert.strictEqual(rollModeFor(char([{ name: 'Concentrating', concentration: { spellName: 'Tasha\'s Caustic Brew', targetIds: ['t1'] } }]), 'attack'), 0);

// requiresConcentration parses the free-text `duration` field the CSV carries.
function spell(duration: string): Spell {
  return {
    name: 'Test Spell', source: '', level: 1, levelLabel: '1st', castingTime: 'Action', duration,
    school: '', range: 'Self', components: '', classes: [], text: '', atHigherLevels: '', isRitual: false,
  };
}
assert.strictEqual(requiresConcentration(spell('Concentration, up to 1 minute')), true);
assert.strictEqual(requiresConcentration(spell('1 round')), false);
assert.strictEqual(requiresConcentration(spell('Instantaneous')), false);

console.log('conditions.selfcheck: all assertions passed');
