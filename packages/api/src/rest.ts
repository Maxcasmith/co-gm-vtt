import type { Character, InventoryItem } from 'shared';
import { spellSlotsForCharacter, hasClassLevel, statMod, applyResourceRestRegain, resourceCurrent, trySpendResource } from 'shared';
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
  resourceUses: Record<string, number>;
  /** Present only when a Long Rest removed expired items (Tinker's Magic) — omitted otherwise so a Short Rest's spread never touches inventory. */
  inventory?: InventoryItem[];
}

export function applyLongRest(char: Character): RestOutcome {
  const maxHp = calcMaxHp(char);
  const maxSpellSlots1 = spellSlotsForCharacter(char);
  // RAW: HP fully restored, but Hit Dice only regain half your total (min 1), not all of them.
  const totalHitDice = char.level ?? 1;
  const restored = Math.max(1, Math.floor(totalHitDice / 2));
  const hitDiceUsed = Math.max(0, (char.hitDiceUsed ?? 0) - restored);
  const resourceUses = applyResourceRestRegain(char, 'long');
  // Tinker's Magic items vanish the moment their owner finishes a Long Rest.
  const inventory = (char.inventory ?? []).filter(i => !i.expiresOnLongRest);
  return { currentHp: maxHp, maxHp, currentSpellSlots1: maxSpellSlots1, maxSpellSlots1, hitDiceUsed, resourceUses, inventory };
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
  const maxSpellSlots1 = spellSlotsForCharacter(char);
  let currentSpellSlots1 = hasClassLevel(char, 'Warlock') ? maxSpellSlots1 : (char.currentSpellSlots1 ?? maxSpellSlots1);
  let resourceUses = applyResourceRestRegain(char, 'short');

  // Arcane Recovery: once per Long Rest, finishing a Short Rest recovers spell slots totaling
  // up to half the Wizard's level (rounded up) — this app tracks only level-1 slots, so that
  // slot-level cap and "slot count" are the same number for a level-1 Wizard.
  if (hasClassLevel(char, 'Wizard') && resourceCurrent(char, 'arcaneRecovery') > 0 && currentSpellSlots1 < maxSpellSlots1) {
    const recoverable = Math.ceil((char.level ?? 1) / 2);
    currentSpellSlots1 = Math.min(maxSpellSlots1, currentSpellSlots1 + recoverable);
    resourceUses = trySpendResource({ ...char, resourceUses }, 'arcaneRecovery') ?? resourceUses;
  }

  return { hpGained, currentHp, maxHp, currentSpellSlots1, maxSpellSlots1, hitDiceUsed: (char.hitDiceUsed ?? 0) + spend, resourceUses };
}
