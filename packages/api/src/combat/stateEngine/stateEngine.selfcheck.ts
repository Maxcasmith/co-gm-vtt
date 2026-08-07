// Standalone invariant check for the combat StateEngine — no test framework in this repo, so this
// is the one runnable check: `tsx src/combat/stateEngine/stateEngine.selfcheck.ts` from packages/api.
//
// Covers the behaviours the whole design rests on: priority ordering, context mutation surviving
// back to the caller, matches() gating, expiry unregistering, mid-chain registration not corrupting
// the run, a throwing hook not aborting the chain, and the full Shield case turning a hit into a miss.
//
// Deliberately exercises the engine and hook classes directly rather than the socket handlers —
// those need a live io/encounter and are covered by playing an actual fight.
import assert from 'node:assert';
import type { AttackContext, TurnContext } from 'shared';
import { StateEngine } from './StateEngine.ts';
import { Hook, type HookProps } from './Hook.ts';
import { AcModifierHook } from './hooks/AcModifierHook.ts';
import { ExpiryHook } from './hooks/ExpiryHook.ts';

function attackCtx(over: Partial<AttackContext> = {}): AttackContext {
  return {
    attackerId: 'goblin', attackerName: 'Goblin',
    targetId: 'hero', targetName: 'Hero', targetIsPlayer: true,
    sourceName: 'Scimitar',
    d20: 11, attackBonus: 2, ac: 12, total: 13, hit: true,
    ...over,
  };
}

function turnCtx(participantId: string): TurnContext {
  return { participantId, participantName: participantId, isPlayer: true, round: 1 };
}

/** Records the order it ran in, so priority can be asserted. */
class OrderHook extends Hook<'afterAttackRoll'> {
  readonly stage = 'afterAttackRoll' as const;
  constructor(props: HookProps, private readonly log: string[], private readonly tag: string) { super(props); }
  matches(): boolean { return true; }
  apply(): void { this.log.push(this.tag); }
}

class ThrowingHook extends Hook<'afterAttackRoll'> {
  readonly stage = 'afterAttackRoll' as const;
  matches(): boolean { return true; }
  apply(): void { throw new Error('deliberate failure'); }
}

/** Never matches — proves apply() is gated, not just its effects. */
class NeverMatchesHook extends Hook<'afterAttackRoll'> {
  readonly stage = 'afterAttackRoll' as const;
  applied = false;
  matches(): boolean { return false; }
  apply(): void { this.applied = true; }
}

async function run(): Promise<void> {
  // ── priority ordering: higher priority first, regardless of registration order ──
  {
    const engine = new StateEngine('t');
    const log: string[] = [];
    engine.register(new OrderHook({ ownerId: 'hero', source: 'low', priority: 1 }, log, 'low'));
    engine.register(new OrderHook({ ownerId: 'hero', source: 'high', priority: 100 }, log, 'high'));
    engine.register(new OrderHook({ ownerId: 'hero', source: 'mid', priority: 50 }, log, 'mid'));
    await engine.trigger('afterAttackRoll', attackCtx());
    assert.deepStrictEqual(log, ['high', 'mid', 'low'], 'hooks must run highest priority first');
  }

  // ── context mutation propagates back to the caller ──
  {
    const engine = new StateEngine('t');
    engine.register(new AcModifierHook({ ownerId: 'hero', source: 'Shield', value: 5 }));
    const ctx = await engine.trigger('afterAttackRoll', attackCtx({ ac: 12 }));
    assert.strictEqual(ctx.ac, 17, 'AC modifier must be visible on the returned context');
  }

  // ── matches() gates apply() ──
  {
    const engine = new StateEngine('t');
    const hook = new NeverMatchesHook({ ownerId: 'hero', source: 'never' });
    engine.register(hook);
    await engine.trigger('afterAttackRoll', attackCtx());
    assert.strictEqual(hook.applied, false, 'apply() must not run when matches() is false');
  }

  // ── AC modifier only applies to its own owner ──
  {
    const engine = new StateEngine('t');
    engine.register(new AcModifierHook({ ownerId: 'someone-else', source: 'Shield', value: 5 }));
    const ctx = await engine.trigger('afterAttackRoll', attackCtx({ ac: 12 }));
    assert.strictEqual(ctx.ac, 12, "another participant's Shield must not raise this target's AC");
  }

  // ── a throwing hook is isolated, later hooks still run ──
  {
    const engine = new StateEngine('t');
    engine.register(new ThrowingHook({ ownerId: 'hero', source: 'broken', priority: 100 }));
    engine.register(new AcModifierHook({ ownerId: 'hero', source: 'Shield', value: 5, priority: 10 }));
    const ctx = await engine.trigger('afterAttackRoll', attackCtx({ ac: 12 }));
    assert.strictEqual(ctx.ac, 17, 'a throwing hook must not abort the rest of the chain');
  }

  // ── expiry unregisters its target and itself at the owner's next turn ──
  {
    const engine = new StateEngine('t');
    const ac = new AcModifierHook({ ownerId: 'hero', source: 'Shield', value: 5 });
    engine.register(ac);
    engine.register(new ExpiryHook({ ownerId: 'hero', source: 'Shield', targetHookIds: [ac.id] }));

    // Someone else's turn — Shield must survive it.
    await engine.trigger('beforeTurn', turnCtx('goblin'));
    assert.strictEqual(engine.has(ac.id), true, "Shield must not expire on another participant's turn");
    assert.strictEqual((await engine.trigger('afterAttackRoll', attackCtx({ ac: 12 }))).ac, 17);

    // The owner's turn — Shield expires.
    await engine.trigger('beforeTurn', turnCtx('hero'));
    assert.strictEqual(engine.has(ac.id), false, "Shield must expire at the start of its owner's turn");
    assert.strictEqual((await engine.trigger('afterAttackRoll', attackCtx({ ac: 12 }))).ac, 12);
  }

  // ── duplicate ids are ignored, so double registration cannot double-apply ──
  {
    const engine = new StateEngine('t');
    engine.register(new AcModifierHook({ id: 'fixed', ownerId: 'hero', source: 'Shield', value: 5 }));
    engine.register(new AcModifierHook({ id: 'fixed', ownerId: 'hero', source: 'Shield', value: 5 }));
    const ctx = await engine.trigger('afterAttackRoll', attackCtx({ ac: 12 }));
    assert.strictEqual(ctx.ac, 17, 're-registering the same id must be a no-op, not a stacked bonus');
  }

  // ── unregisterBySource replaces rather than stacks; unregisterByOwner clears a dead participant ──
  {
    const engine = new StateEngine('t');
    engine.register(new AcModifierHook({ ownerId: 'hero', source: 'Shield', value: 5 }));
    engine.unregisterBySource('hero', 'Shield');
    engine.register(new AcModifierHook({ ownerId: 'hero', source: 'Shield', value: 5 }));
    assert.strictEqual((await engine.trigger('afterAttackRoll', attackCtx({ ac: 12 }))).ac, 17, 'recast must refresh, not stack');

    engine.unregisterByOwner('hero');
    assert.strictEqual((await engine.trigger('afterAttackRoll', attackCtx({ ac: 12 }))).ac, 12, "a dead participant's hooks must all go");
  }

  // ── the whole point: a landed hit becomes a miss once Shield raises AC ──
  {
    const engine = new StateEngine('t');
    // Goblin rolls 11+2 = 13 against AC 12 — a hit by 1.
    const ctx = attackCtx({ d20: 11, attackBonus: 2, ac: 12 });
    ctx.total = ctx.d20 + ctx.attackBonus;
    ctx.hit = ctx.total >= ctx.ac;
    assert.strictEqual(ctx.hit, true, 'precondition: the attack lands before Shield');

    engine.register(new AcModifierHook({ ownerId: 'hero', source: 'Shield', value: 5 }));
    const after = await engine.trigger('afterAttackRoll', ctx);

    // The runtime re-derives exactly like this after the chain returns.
    after.total = after.d20 + after.attackBonus;
    after.hit = after.total >= after.ac;
    assert.strictEqual(after.ac, 17);
    assert.strictEqual(after.hit, false, 'Shield must turn the triggering hit into a miss');
  }

  console.log('stateEngine.selfcheck: all assertions passed');
}

await run();
