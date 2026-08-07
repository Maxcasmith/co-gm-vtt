import type { Character } from 'shared';
import { spellSlotsForClass, statMod } from 'shared';
import { HIT_DICE } from './state.ts';
import { calcMaxHp } from './combat/dice.ts';

// Elves have Trance — a 4-hour long rest instead of the usual 8. Short rest is always 1 hour.
export function restDurationHours(char: Character, restType: 'short' | 'long'): number {
  if (restType === 'short') return 1;
  return char.species === 'Elf' ? 4 : 8;
}

export interface RestOutcome {
  hpGained?: number;
  currentHp: number;
  maxHp: number;
  currentSpellSlots1: number;
  maxSpellSlots1: number;
  hitDiceUsed: number;
}

export function applyLongRest(char: Character): RestOutcome {
  const maxHp = calcMaxHp(char);
  const maxSpellSlots1 = spellSlotsForClass(char.class);
  return { currentHp: maxHp, maxHp, currentSpellSlots1: maxSpellSlots1, maxSpellSlots1, hitDiceUsed: 0 };
}

export function applyShortRest(char: Character, hitDiceSpent: number): RestOutcome {
  const dieSize = HIT_DICE[char.class] ?? 8;
  const conMod = statMod(char.stats.con);
  const maxHp = calcMaxHp(char);
  const current = char.currentHp ?? maxHp;
  const level = char.level ?? 1;
  const remaining = Math.max(0, level - (char.hitDiceUsed ?? 0));
  const spend = Math.max(0, Math.min(hitDiceSpent ?? 0, remaining));

  let hpGained = 0;
  for (let i = 0; i < spend; i++) hpGained += Math.floor(Math.random() * dieSize) + 1 + conMod;
  hpGained = Math.max(0, hpGained);
  const currentHp = Math.min(maxHp, current + hpGained);

  // Pact Magic uniquely recovers on a short rest; other casters' slots don't.
  const maxSpellSlots1 = spellSlotsForClass(char.class);
  const currentSpellSlots1 = char.class === 'Warlock' ? maxSpellSlots1 : (char.currentSpellSlots1 ?? maxSpellSlots1);

  return { hpGained, currentHp, maxHp, currentSpellSlots1, maxSpellSlots1, hitDiceUsed: (char.hitDiceUsed ?? 0) + spend };
}
