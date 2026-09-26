// Standalone check for rollD20 + the breakdown helpers — no test framework in this repo, so this
// is the one runnable check: `tsx src/combat/dice.rollD20.selfcheck.ts` from packages/api.
// Asserts: advantage keeps the higher die, disadvantage the lower, both cancel to one die (2024
// PHB), and every breakdown's rows sum to its total — including after a hook reroll/bonus change.
import assert from 'node:assert';
import { rollD20, adv, dis, withModifiers, reconcile, keptDie, sumModifiers } from './dice.ts';

for (let i = 0; i < 200; i++) {
  const flat = rollD20([false, undefined]);
  assert.strictEqual(flat.mode, 'normal');
  assert.strictEqual(flat.dice.length, 1);

  const a = rollD20([adv('Luck Point')]);
  assert.strictEqual(a.mode, 'advantage');
  assert.strictEqual(keptDie(a), Math.max(...a.dice));

  const d = rollD20([dis('Poisoned'), dis('Long range')]);
  assert.strictEqual(d.mode, 'disadvantage');
  assert.strictEqual(keptDie(d), Math.min(...d.dice));

  // Two disadvantages still cancel against one advantage — RAW, not a sum.
  const c = rollD20([dis('Poisoned'), dis('Long range'), adv('Faerie Fire')]);
  assert.strictEqual(c.mode, 'normal');
  assert.strictEqual(c.dice.length, 1);
  assert.strictEqual(c.modeSources.length, 3);

  const b = withModifiers(a, [{ label: 'Strength', value: 3 }, { label: 'Proficiency', value: 2 }, { label: 'Bane (d4)', value: -2 }]);
  assert.strictEqual(b.total, keptDie(b) + 3);

  // Hook handed back a different d20 and a bigger bonus — reroll recorded, "Other effects" makes up the gap.
  const r = reconcile(b, keptDie(b) === 20 ? 1 : 20, 5);
  assert.strictEqual(r.rerolledFrom, keptDie(b));
  assert.strictEqual(r.modifiers.at(-1)?.label, 'Other effects');
  assert.strictEqual(r.total, keptDie(r) + sumModifiers(r.modifiers));

  // Unchanged context — reconcile is a no-op on the rows.
  assert.deepStrictEqual(reconcile(b, keptDie(b), 3).modifiers, b.modifiers);
}

// Halfling Luck: a kept natural 1 is rerolled once (Math.random stubbed: 0 → 1, 0.5 → 11).
{
  const real = Math.random;
  const seq = (...vals: number[]) => { Math.random = () => vals.shift() ?? 0.5; };
  seq(0, 0.5);
  const lucky = rollD20([], { species: 'Halfling' });
  assert.deepStrictEqual([keptDie(lucky), lucky.rerolledFrom, lucky.rerolledBy], [11, 1, 'Luck']);
  seq(0, 0.5);
  assert.strictEqual(keptDie(rollD20([], { species: 'Human' })), 1);
  // Advantage [1, 1]: only the kept die rerolls, then the higher wins.
  seq(0, 0, 0.5);
  assert.strictEqual(keptDie(rollD20([adv('x')], { species: 'Halfling' })), 11);
  // Disadvantage [1, 15]: the kept 1 rerolls to 11, lower still wins → 11.
  seq(0, 0.7, 0.5);
  assert.strictEqual(keptDie(rollD20([dis('x')], { species: 'Halfling' })), 11);
  // A later hook reroll isn't mislabelled as Luck.
  seq(0, 0.5);
  assert.strictEqual(reconcile(withModifiers(rollD20([], { species: 'Halfling' }), []), 20, 0).rerolledBy, undefined);
  Math.random = real;
}

console.log('dice.rollD20.selfcheck: all assertions passed');
