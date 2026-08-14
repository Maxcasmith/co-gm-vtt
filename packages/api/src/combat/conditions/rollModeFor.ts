import type { AbilityKey, Condition as ConditionName, ActiveCondition } from 'shared';
import { Condition, type RollType } from './Condition.ts';
import { Poisoned } from './Poisoned.ts';
import { Concentrating } from './Concentrating.ts';
import { Restrained } from './Restrained.ts';

// New Condition subclass → register it here. Conditions with no entry are tracked (can be
// applied/persisted) but have no mechanical effect yet — that's the "structure first" point.
const CONDITION_CLASSES: Partial<Record<ConditionName, Condition>> = {
  Poisoned: new Poisoned(),
  Concentrating: new Concentrating(),
  Restrained: new Restrained(),
};

/** Anything conditions can attach to — Character (persisted) or EnemyStatBlock (combat-scoped). */
interface HasConditions {
  conditions?: ActiveCondition[] | undefined;
}

function clampMode(sum: number): -1 | 0 | 1 {
  return sum > 0 ? 1 : sum < 0 ? -1 : 0;
}

/** Net roll mode across every active condition: -1 disadvantage, 0 normal, 1 advantage. */
export function rollModeFor(actor: HasConditions, rollType: RollType, ability?: AbilityKey): -1 | 0 | 1 {
  const sum = (actor.conditions ?? [])
    .map(c => CONDITION_CLASSES[c.name]?.effect(rollType, ability) ?? 0)
    .reduce<number>((a, b) => a + b, 0);
  return clampMode(sum);
}

/**
 * Conditions that grant the ATTACKER advantage, checked against the TARGET rather than the
 * roller — a second axis rollModeFor doesn't cover (it only ever looks at the actor making the
 * roll). Restrained today ("Attack rolls against you have Advantage" — 2024 PHB unifies this
 * across melee/ranged, no more melee-only split). Combine with the attacker's own
 * rollModeFor(attacker, 'attack') via combineModes before rolling.
 */
export function attackModeAgainstTarget(target: HasConditions): -1 | 0 | 1 {
  return (target.conditions ?? []).some(c => c.name === 'Restrained') ? 1 : 0;
}

/** Folds multiple independent roll-mode sources into one — opposing sources cancel to normal, same as rollModeFor's own reduction. */
export function combineModes(...modes: (-1 | 0 | 1)[]): -1 | 0 | 1 {
  return clampMode(modes.reduce<number>((a, b) => a + b, 0));
}

/** Adds a condition if not already present — a character can't have the same condition twice. */
export function addCondition(conditions: ActiveCondition[] | undefined, name: ConditionName): ActiveCondition[] {
  const list = conditions ?? [];
  if (list.some(c => c.name === name)) return list;
  return [...list, { name }];
}

/** Removes a condition if present — a no-op (same reference back) if it isn't. */
export function removeCondition(conditions: ActiveCondition[] | undefined, name: ConditionName): ActiveCondition[] {
  const list = conditions ?? [];
  if (!list.some(c => c.name === name)) return list;
  return list.filter(c => c.name !== name);
}
