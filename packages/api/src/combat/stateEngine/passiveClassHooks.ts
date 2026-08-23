import { Hook } from './Hook.ts';
import type { StateEngine } from './StateEngine.ts';
import { OnHitBonusDamageHook } from './hooks/OnHitBonusDamageHook.ts';

/**
 * A class feature that's always "on" rather than player-triggered (Sneak Attack, Fighting
 * Style, ...) — the counterpart to AbilityDef (abilities.ts) for features with no explicit
 * activation. Registered every time the owner's turn starts (see registerPassiveClassHooks,
 * called from runTurnStart) using a deterministic id, so StateEngine.register's existing
 * dedup-by-id no-ops the call when the hook is still active and re-adds it when the hook
 * unregistered itself (consumeOnUse) — that's what gives an on-hit passive its "once per turn"
 * limit for free, no new engine code needed. A hook with no consumeOnUse just stays registered
 * turn over turn, which is exactly what a permanent passive (Fighting Style) wants too.
 */
export interface PassiveHookDef {
  class: string;
  source: string;
  build: (ownerId: string, casterLevel: number) => Hook;
}

/** Populated per-feature as each is wired up (see build audit) — empty is a valid, fully-functional state. */
export const PASSIVE_HOOK_DEFS: PassiveHookDef[] = [
  {
    class: 'Rogue',
    source: 'Sneak Attack',
    // 2024 PHB: 1d6 at level 1, +1d6 every odd level.
    // ponytail: OnHitBonusDamageHook fires on ANY hit by the owner — real Sneak Attack also
    // requires the hit to have had Advantage (or an ally adjacent to the target) and use a
    // Finesse/Ranged weapon. Neither is available on DamageContext today (no roll-mode or
    // weapon-property field reaches beforeDamage), so this pilot grants the bonus damage
    // unconditionally once per turn rather than gating it — upgrade when DamageContext carries
    // enough attack-roll context to check it.
    build: (ownerId, casterLevel) => new OnHitBonusDamageHook({
      id: `passive:${ownerId}:sneakAttack`,
      ownerId,
      source: 'Sneak Attack',
      kind: 'onHitBonusDamage',
      casterLevel,
      slotLevel: 0,
      consumeOnUse: true,
      scaling: {
        mode: 'cantrip',
        base: '1d6',
        tiers: [
          { atLevel: 3, value: '2d6' }, { atLevel: 5, value: '3d6' }, { atLevel: 7, value: '4d6' },
          { atLevel: 9, value: '5d6' }, { atLevel: 11, value: '6d6' }, { atLevel: 13, value: '7d6' },
          { atLevel: 15, value: '8d6' }, { atLevel: 17, value: '9d6' }, { atLevel: 19, value: '10d6' },
        ],
      },
    }),
  },
];

export function registerPassiveClassHooks(engine: StateEngine, ownerId: string, className: string, casterLevel: number): void {
  for (const def of PASSIVE_HOOK_DEFS) {
    if (def.class !== className) continue;
    engine.register(def.build(ownerId, casterLevel));
  }
}
