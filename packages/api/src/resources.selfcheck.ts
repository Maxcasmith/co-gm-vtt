// Standalone invariant check for the generic resource-pool system (shared/types/character.ts) —
// no test framework in this repo, so this is the one runnable check:
// `tsx src/resources.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import type { Character, CharacterStats, ResourceDef } from 'shared';
import { RESOURCE_DEFS, resourceMax, resourceCurrent, trySpendResource, applyResourceRestRegain, breathWeaponSpell, resolveSpellDamageDice, ABILITY_DEFS, ownsAbility, characterDamageResistances, invocationSpell, isPactWeapon, weaponDamageType, PACT_FAMILIAR_FORMS } from 'shared';

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

// Species-gated pool (Dragonborn Breath Weapon): only with a resolved ancestry; PB uses.
const redDragon = { ...char(), species: 'Dragonborn', subspecies: 'Chromatic', draconicAncestry: 'Red', proficiencyBonus: 3 };
assert.strictEqual(resourceMax(redDragon, 'breathWeapon'), 3);
assert.strictEqual(resourceMax({ ...redDragon, draconicAncestry: '' }, 'breathWeapon'), 0);
assert.strictEqual(resourceMax({ ...redDragon, subspecies: 'Gem' }, 'breathWeapon'), 0); // Red isn't a Gem dragon
const breath = breathWeaponSpell(redDragon, 'cone')!;
assert.strictEqual(breath.combat?.onHit?.[0]?.damageType, 'Fire');
assert.deepStrictEqual(breath.combat?.area, { shape: 'cone', size: 15, origin: 'self' });
assert.strictEqual(breathWeaponSpell(redDragon, 'line')!.combat?.area?.size, 30);
assert.strictEqual(resolveSpellDamageDice(breath.combat!.onHit![0]!.scaling, 1, 0), '1d10');
assert.strictEqual(resolveSpellDamageDice(breath.combat!.onHit![0]!.scaling, 5, 0), '2d10');

// Species-owned abilities: Orc gets Adrenaline Rush + Relentless Endurance regardless of class.
const orc = { ...char(), species: 'Orc', class: 'Wizard', proficiencyBonus: 2 };
assert.ok(ownsAbility(orc, ABILITY_DEFS['adrenalineRush']!));
assert.ok(!ownsAbility(orc, ABILITY_DEFS['rage']!)); // Wizard, not Barbarian
assert.strictEqual(resourceMax(orc, 'adrenalineRush'), 2);
assert.strictEqual(resourceMax(orc, 'relentlessEndurance'), 1);
assert.deepStrictEqual(applyResourceRestRegain({ ...orc, resourceUses: { adrenalineRush: 0, relentlessEndurance: 0 } }, 'short'), { adrenalineRush: 2, relentlessEndurance: 0 });
assert.strictEqual(resolveSpellDamageDice(ABILITY_DEFS['healingHands']!.onUse[0]!.scaling, 1, 0), '2d4');
assert.strictEqual(resolveSpellDamageDice(ABILITY_DEFS['adrenalineRush']!.onUse[0]!.scaling, 5, 0), '0d4+3');

// Species resistances: derived from species + lineage + ancestry, merged with persisted ones, deduped.
assert.deepStrictEqual(characterDamageResistances({ species: 'Aasimar' }), ['Necrotic', 'Radiant']);
assert.deepStrictEqual(characterDamageResistances({ species: 'Tiefling', subspecies: 'Infernal' }), ['Fire']);
assert.deepStrictEqual(characterDamageResistances({ ...redDragon, damageResistances: ['Fire'] }), ['Fire']);
assert.deepStrictEqual(characterDamageResistances({ species: 'Human' }), []);

// Eldritch Invocations: at-will spells only with the invocation; pact weapon only on its bonded item.
assert.deepStrictEqual(invocationSpell({ invocations: ['Armor of Shadows'] }, 'Mage Armor'), { spell: 'Mage Armor', selfOnly: true });
assert.strictEqual(invocationSpell({ invocations: ['Armor of Shadows'] }, 'Find Familiar'), undefined);
assert.strictEqual(invocationSpell({}, 'Mage Armor'), undefined);
const bladelock = { invocations: ['Pact of the Blade'], pactWeapon: { itemId: 'w1', conjured: true, damageType: 'radiant' } };
assert.ok(isPactWeapon(bladelock, { id: 'w1' }));
assert.ok(!isPactWeapon(bladelock, { id: 'w2' }));
assert.ok(!isPactWeapon({ pactWeapon: bladelock.pactWeapon }, { id: 'w1' })); // invocation gone, bond ignored
assert.strictEqual(weaponDamageType(bladelock, { id: 'w1', damageType: 'slashing' }), 'radiant');
assert.strictEqual(weaponDamageType(bladelock, { id: 'w2', damageType: 'slashing' }), 'slashing');
assert.strictEqual(weaponDamageType({ ...bladelock, pactWeapon: { itemId: 'w1', conjured: true } }, { id: 'w1', damageType: 'slashing' }), 'slashing');
// Pact of the Chain forms never attack on their own turn — only via reactionAttack.
for (const form of Object.values(PACT_FAMILIAR_FORMS)) assert.ok(form.attacks.length === 0 && form.reactionAttack);

console.log('resources.selfcheck: all assertions passed');
