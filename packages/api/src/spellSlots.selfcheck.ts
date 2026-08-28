// Standalone invariant check for multiclass spell slot accumulation (shared/types/character.ts) —
// no test framework in this repo, so this is the one runnable check:
// `tsx src/spellSlots.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import type { Character, CharacterStats } from 'shared';
import { spellSlotsForCharacter } from 'shared';

const stats: CharacterStats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
function char(className: string, level: number, classes?: { class: string; level: number }[]): Character {
  return {
    id: 'c1', campaignId: 'cid', name: 'Hero', species: 'Human', background: 'Sage', class: className,
    level, ...(classes ? { classes } : {}),
    stats, skillProficiencies: [], password: '', portraitPath: '', tokenPath: '', createdAt: '',
  };
}

// Single full caster: 2 / 3 / 4, capped at 4 forever after.
assert.strictEqual(spellSlotsForCharacter(char('Wizard', 1)), 2);
assert.strictEqual(spellSlotsForCharacter(char('Wizard', 2)), 3);
assert.strictEqual(spellSlotsForCharacter(char('Wizard', 3)), 4);
assert.strictEqual(spellSlotsForCharacter(char('Wizard', 20)), 4);

// Non-caster: no pool at all.
assert.strictEqual(spellSlotsForCharacter(char('Fighter', 5)), 0);

// Single Warlock: separate Pact Magic progression (1 at level 1, 2 from level 2-10).
assert.strictEqual(spellSlotsForCharacter(char('Warlock', 1)), 1);
assert.strictEqual(spellSlotsForCharacter(char('Warlock', 2)), 2);
assert.strictEqual(spellSlotsForCharacter(char('Warlock', 10)), 2);
assert.strictEqual(spellSlotsForCharacter(char('Warlock', 11)), 3);
assert.strictEqual(spellSlotsForCharacter(char('Warlock', 17)), 4);

// Half caster (Paladin/Ranger) contributes floor(level/2) to combined caster level.
// Paladin 1 -> caster level 0 -> 0 slots. Paladin 2 -> caster level 1 -> 2 slots.
assert.strictEqual(spellSlotsForCharacter(char('Paladin', 1)), 0);
assert.strictEqual(spellSlotsForCharacter(char('Paladin', 2)), 2);
assert.strictEqual(spellSlotsForCharacter(char('Ranger', 4)), 3);

// Artificer is the official rounded-UP exception: level 1 alone already reaches caster level 1.
assert.strictEqual(spellSlotsForCharacter(char('Artificer', 1)), 2);

// Multiclass full + half: Wizard 1 (contributes 1) + Paladin 2 (contributes 1) = caster level 2 -> 3 slots.
assert.strictEqual(
  spellSlotsForCharacter(char('Wizard', 1, [{ class: 'Wizard', level: 1 }, { class: 'Paladin', level: 2 }])),
  3,
);

// Multiclass full + Warlock: the two pools add on top of each other (this app's one-field
// simplification) rather than one overriding the other. Wizard 3 (caster level 3 -> 4 slots) +
// Warlock 1 (1 Pact slot) = 5.
assert.strictEqual(
  spellSlotsForCharacter(char('Wizard', 3, [{ class: 'Wizard', level: 3 }, { class: 'Warlock', level: 1 }])),
  5,
);

// A non-caster class in the mix contributes nothing to the combined caster level.
assert.strictEqual(
  spellSlotsForCharacter(char('Fighter', 1, [{ class: 'Fighter', level: 5 }, { class: 'Wizard', level: 1 }])),
  2,
);

// Falls back to `class`/`level` when `classes` is absent — every pre-multiclass character.
assert.strictEqual(
  spellSlotsForCharacter(char('Sorcerer', 2)),
  spellSlotsForCharacter(char('Sorcerer', 2, [{ class: 'Sorcerer', level: 2 }])),
);

console.log('spellSlots.selfcheck: all assertions passed');
