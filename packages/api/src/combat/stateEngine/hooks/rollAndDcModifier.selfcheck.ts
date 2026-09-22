// Standalone invariant check for RollModifierHook's consumeOnUse (Bardic Inspiration's single
// die) and DcModifierHook (Innate Sorcery's +1 DC) — no test framework in this repo, so this is
// the one runnable check: `tsx src/combat/stateEngine/hooks/rollAndDcModifier.selfcheck.ts` from
// packages/api.
import assert from 'node:assert';
import { StateEngine } from '../StateEngine.ts';
import { RollModifierHook, rollAndConsumeRollMods } from './RollModifierHook.ts';
import { sumModifiers } from '../../dice.ts';
import { DcModifierHook, dcBonusFor } from './DcModifierHook.ts';

// A plain (non-consumeOnUse) hook, Bless/Bane-shaped, applies every time it's summed.
{
  const engine = new StateEngine('t');
  engine.register(new RollModifierHook({ ownerId: 'hero', source: 'Bless', kind: 'rollModifier', dieSize: 1, sign: 1 }));
  const mods = engine.getHooksOwnedBy('hero', 'rollModifier') as RollModifierHook[];
  assert.strictEqual(sumModifiers(rollAndConsumeRollMods(engine, mods)), 1);
  // Still registered — a second roll gets the bonus again.
  const modsAgain = engine.getHooksOwnedBy('hero', 'rollModifier') as RollModifierHook[];
  assert.strictEqual(sumModifiers(rollAndConsumeRollMods(engine, modsAgain)), 1);
}

// consumeOnUse (Bardic Inspiration) applies once, then is gone.
{
  const engine = new StateEngine('t');
  engine.register(new RollModifierHook({ ownerId: 'ally', source: 'Bardic Inspiration', kind: 'rollModifier', dieSize: 6, sign: 1, consumeOnUse: true }));
  const mods = engine.getHooksOwnedBy('ally', 'rollModifier') as RollModifierHook[];
  assert.ok(sumModifiers(rollAndConsumeRollMods(engine, mods)) >= 1, 'die should have contributed something');
  assert.strictEqual(engine.hasHookOwnedBy('ally', 'rollModifier'), false, 'consumeOnUse should have unregistered it');
  // Nothing left to sum on a later roll.
  const modsAfter = engine.getHooksOwnedBy('ally', 'rollModifier') as RollModifierHook[];
  assert.strictEqual(sumModifiers(rollAndConsumeRollMods(engine, modsAfter)), 0);
}

// DcModifierHook: flat, query-only, sums every hook the owner has registered.
{
  const engine = new StateEngine('t');
  assert.strictEqual(dcBonusFor(engine, 'hero'), 0);
  engine.register(new DcModifierHook({ ownerId: 'hero', source: 'Innate Sorcery', kind: 'dcModifier', value: 1 }));
  assert.strictEqual(dcBonusFor(engine, 'hero'), 1);
  // Someone else's DC is unaffected.
  assert.strictEqual(dcBonusFor(engine, 'goblin'), 0);
  // A second source stacks (nothing here dedupes distinct sources, same as AcModifierHook).
  engine.register(new DcModifierHook({ ownerId: 'hero', source: 'Other Source', kind: 'dcModifier', value: 2 }));
  assert.strictEqual(dcBonusFor(engine, 'hero'), 3);
}

console.log('rollAndDcModifier.selfcheck: all assertions passed');
