// Standalone invariant check for the generic resource-pool system (shared/types/character.ts) —
// no test framework in this repo, so this is the one runnable check:
// `tsx src/resources.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import type { Character, CharacterStats, ResourceDef } from 'shared';
import { RESOURCE_DEFS, resourceMax, resourceCurrent, trySpendResource, applyResourceRestRegain } from 'shared';

const stats: CharacterStats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
function char(resourceUses?: Record<string, number>): Character {
  return {
    id: 'c1', campaignId: 'cid', name: 'Hero', species: 'Human', background: 'Sage', class: 'Barbarian',
    stats, skillProficiencies: [], password: '', portraitPath: '', tokenPath: '', createdAt: '',
    resourceUses,
  };
}

// Isolate from whatever real per-feature defs (secondWind, ...) have accumulated in RESOURCE_DEFS
// by other build steps — this test only cares about the mechanism, not any one feature's numbers.
const realDefs = { ...RESOURCE_DEFS };
for (const key of Object.keys(RESOURCE_DEFS)) delete RESOURCE_DEFS[key];

const testDef: ResourceDef = { key: 'testCharges', label: 'Test Charges', class: 'Barbarian', max: () => 2, regain: { short: 1, long: 'full' } };
RESOURCE_DEFS['testCharges'] = testDef;

// Untouched character reads as full.
assert.strictEqual(resourceMax(char(), 'testCharges'), 2);
assert.strictEqual(resourceCurrent(char(), 'testCharges'), 2);

// Unknown key is inert, not a crash.
assert.strictEqual(resourceMax(char(), 'nope'), 0);
assert.strictEqual(resourceCurrent(char(), 'nope'), 0);

// Wrong-class character gets nothing, even though the key exists.
const wizard = { ...char(), class: 'Wizard' };
assert.strictEqual(resourceMax(wizard, 'testCharges'), 0);
assert.deepStrictEqual(applyResourceRestRegain(wizard, 'long'), {});

// Spending decrements, and stops at zero.
const afterOne = trySpendResource(char(), 'testCharges');
assert.deepStrictEqual(afterOne, { testCharges: 1 });
const afterTwo = trySpendResource(char(afterOne), 'testCharges');
assert.deepStrictEqual(afterTwo, { testCharges: 0 });
assert.strictEqual(trySpendResource(char(afterTwo), 'testCharges'), undefined);

// Short rest regains the fixed amount, capped at max.
assert.deepStrictEqual(applyResourceRestRegain(char({ testCharges: 0 }), 'short'), { testCharges: 1 });
assert.deepStrictEqual(applyResourceRestRegain(char({ testCharges: 1 }), 'short'), { testCharges: 2 });
assert.deepStrictEqual(applyResourceRestRegain(char({ testCharges: 2 }), 'short'), { testCharges: 2 });

// Long rest always tops off to max regardless of current.
assert.deepStrictEqual(applyResourceRestRegain(char({ testCharges: 0 }), 'long'), { testCharges: 2 });

// A def with no rule for a rest type is left untouched by that rest.
delete RESOURCE_DEFS['testCharges'];
RESOURCE_DEFS['longOnly'] = { key: 'longOnly', label: 'Long Only', class: 'Barbarian', max: () => 3, regain: { long: 'full' } };
assert.deepStrictEqual(applyResourceRestRegain(char({ longOnly: 1 }), 'short'), { longOnly: 1 });
assert.deepStrictEqual(applyResourceRestRegain(char({ longOnly: 1 }), 'long'), { longOnly: 3 });

delete RESOURCE_DEFS['longOnly'];

// Feat-gated pool (no `class`): granted by hasOriginFeat, not character.class.
RESOURCE_DEFS['featPool'] = { key: 'featPool', label: 'Feat Pool', featGate: 'Lucky', max: () => 2, regain: { long: 'full' } };
const lucky = { ...char(), background: 'Merchant' }; // Merchant -> Lucky (BACKGROUND_FEAT)
assert.strictEqual(resourceMax(lucky, 'featPool'), 2);
assert.strictEqual(resourceMax(char(), 'featPool'), 0); // Sage background doesn't grant Lucky
delete RESOURCE_DEFS['featPool'];

// Restore the real defs so a script running after this one in the same process sees them.
Object.assign(RESOURCE_DEFS, realDefs);

console.log('resources.selfcheck: all assertions passed');
