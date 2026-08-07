import type { HookSpec, Spell } from 'shared';
import type { Hook } from './Hook.ts';
import type { StateEngine } from './StateEngine.ts';
import { AcModifierHook } from './hooks/AcModifierHook.ts';
import { RecurringDamageHook } from './hooks/RecurringDamageHook.ts';
import { OnHitBonusDamageHook } from './hooks/OnHitBonusDamageHook.ts';
import { ExpiryHook, RoundExpiryHook } from './hooks/ExpiryHook.ts';

export interface SpellHookContext {
  /** Who the hook attaches to — the caster for 'self' specs, an affected target otherwise. */
  ownerId: string;
  casterId: string;
  casterLevel: number;
  slotLevel: number;
  currentRound: number;
  /** onHitBonusDamage only — the specific target the owner's hits are checked against. */
  markedTargetId?: string;
}

/** Instantiates the class a HookSpec names. Returns null for specs missing the data their type needs. */
function hookFromSpec(spec: HookSpec, source: string, ctx: SpellHookContext): Hook | null {
  const base = { ownerId: ctx.ownerId, source, ...(spec.priority !== undefined ? { priority: spec.priority } : {}) };

  switch (spec.type) {
    case 'acModifier':
      if (spec.value === undefined) return null;
      return new AcModifierHook({ ...base, value: spec.value });
    case 'recurringDamage':
      if (!spec.scaling) return null;
      return new RecurringDamageHook({
        ...base,
        casterId: ctx.casterId,
        casterLevel: ctx.casterLevel,
        slotLevel: ctx.slotLevel,
        scaling: spec.scaling,
        damageType: spec.damageType,
      });
    case 'onHitBonusDamage':
      if (!ctx.markedTargetId) return null;
      return new OnHitBonusDamageHook({
        ...base,
        markedTargetId: ctx.markedTargetId,
        scaling: spec.scaling,
        damageType: spec.damageType,
        casterLevel: ctx.casterLevel,
        slotLevel: ctx.slotLevel,
      });
  }
}

/** Builds the cleanup hook a spec's duration implies. 'endOfCombat' needs none — the engine dies with the fight. */
function expiryFor(spec: HookSpec, hookId: string, source: string, ctx: SpellHookContext): Hook | null {
  if (spec.duration.until === 'endOfCombat') return null;
  if (spec.duration.until === 'startOfOwnerTurn') {
    return new ExpiryHook({ ownerId: ctx.ownerId, source, targetHookIds: [hookId] });
  }
  return new RoundExpiryHook({
    ownerId: ctx.ownerId,
    source,
    targetHookIds: [hookId],
    expiresOnRound: ctx.currentRound + (spec.duration.rounds ?? 1),
  });
}

/**
 * Registers everything a spell's `combat.hooks` declares onto one participant, plus the expiry
 * jobs their durations imply. Recasting replaces rather than stacks — a second Shield should
 * refresh the +5, not make it +10.
 */
export function registerSpellHooks(engine: StateEngine, spell: Spell, ctx: SpellHookContext): void {
  const specs = spell.combat?.hooks ?? [];
  if (!specs.length) return;

  engine.unregisterBySource(ctx.ownerId, spell.name);

  for (const spec of specs) {
    const hook = hookFromSpec(spec, spell.name, ctx);
    if (!hook) continue;
    engine.register(hook);
    const expiry = expiryFor(spec, hook.id, spell.name, ctx);
    if (expiry) engine.register(expiry);
  }
}
