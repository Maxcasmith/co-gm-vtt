import type { AbilityKey, Condition as ConditionName, ActiveCondition, RollModeSource } from 'shared';
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

/**
 * Every active condition that gives this roll Advantage or Disadvantage, named for the log —
 * feed straight into rollD20 alongside any situational sources (Luck Point, long range, ...).
 */
export function conditionModeSources(actor: HasConditions, rollType: RollType, ability?: AbilityKey): RollModeSource[] {
  return (actor.conditions ?? []).flatMap(c => {
    const effect = CONDITION_CLASSES[c.name]?.effect(rollType, ability) ?? 0;
    return effect ? [{ label: c.name, sign: effect }] : [];
  });
}

/**
 * Conditions that grant the ATTACKER advantage, checked against the TARGET rather than the
 * roller — a second axis conditionModeSources doesn't cover (it only ever looks at the actor
 * making the roll). Restrained today ("Attack rolls against you have Advantage" — 2024 PHB
 * unifies this across melee/ranged, no more melee-only split).
 */
export function targetModeSources(target: HasConditions): RollModeSource[] {
  return (target.conditions ?? []).some(c => c.name === 'Restrained') ? [{ label: 'Target Restrained', sign: 1 }] : [];
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
