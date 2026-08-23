// Standalone invariant check for passive class-feature hooks — no test framework in this repo,
// so this is the one runnable check:
// `tsx src/combat/stateEngine/passiveClassHooks.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import type { DamageContext } from 'shared';
import { StateEngine } from './StateEngine.ts';
import { registerPassiveClassHooks } from './passiveClassHooks.ts';

async function run(): Promise<void> {
  // A non-Rogue gets nothing registered.
  {
    const engine = new StateEngine('t');
    registerPassiveClassHooks(engine, 'hero', 'Wizard', 1);
    assert.strictEqual(engine.getHooksByKind('onHitBonusDamage').length, 0);
    assert.strictEqual(engine.hasHookOwnedBy('hero', 'onHitBonusDamage'), false);
  }

  // A Rogue gets exactly one Sneak Attack hook registered.
  {
    const engine = new StateEngine('t');
    registerPassiveClassHooks(engine, 'hero', 'Rogue', 1);
    assert.strictEqual(engine.getHooksByKind('onHitBonusDamage').length, 1);
  }

  // Calling it again before the hook has fired (simulating turn 2 with nothing having
  // triggered turn 1) is a no-op — same deterministic id, StateEngine.register dedupes — not a
  // second stacked copy.
  {
    const engine = new StateEngine('t');
    registerPassiveClassHooks(engine, 'hero', 'Rogue', 1);
    registerPassiveClassHooks(engine, 'hero', 'Rogue', 1);
    assert.strictEqual(engine.getHooksByKind('onHitBonusDamage').length, 1);
  }

  // The "once per turn" gate: firing beforeDamage unregisters the consumeOnUse hook, then the
  // next call (simulating the owner's next turn start) re-arms a fresh one.
  {
    const engine = new StateEngine('t');
    registerPassiveClassHooks(engine, 'hero', 'Rogue', 1);
    assert.strictEqual(engine.hasHookOwnedBy('hero', 'onHitBonusDamage'), true);

    const dmgCtx: DamageContext = { sourceId: 'hero', targetId: 'goblin', targetName: 'Goblin', amount: 5, sourceName: 'Dagger' };
    await engine.trigger('beforeDamage', dmgCtx);
    assert.ok(dmgCtx.amount > 5, 'Sneak Attack should have added bonus damage');
    assert.strictEqual(engine.hasHookOwnedBy('hero', 'onHitBonusDamage'), false, 'consumeOnUse should have unregistered it');

    // A second hit later in the SAME turn, before the next turn re-arms it, gets nothing extra.
    const secondHit: DamageContext = { sourceId: 'hero', targetId: 'goblin', targetName: 'Goblin', amount: 5, sourceName: 'Dagger' };
    await engine.trigger('beforeDamage', secondHit);
    assert.strictEqual(secondHit.amount, 5, 'no bonus once already spent this turn');

    // Next turn start re-arms it.
    registerPassiveClassHooks(engine, 'hero', 'Rogue', 1);
    assert.strictEqual(engine.hasHookOwnedBy('hero', 'onHitBonusDamage'), true);
  }

  console.log('passiveClassHooks.selfcheck: all assertions passed');
}

void run();
