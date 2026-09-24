// Standalone invariant check for multiclass spell slot accumulation (shared/types/character.ts) —
// no test framework in this repo, so this is the one runnable check:
// `tsx src/spellSlots.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import type { Character, CharacterStats } from 'shared';
import { spellSlotsForCharacter, magicInitiateKeyForSpell } from 'shared';

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

// Half casters (Paladin/Ranger/Artificer) contribute ceil(level/2) to combined caster level —
// 2024 PHB gives Paladin/Ranger Spellcasting at level 1, so they round up like Artificer.
// Paladin 1 -> caster level 1 -> 2 slots. Ranger 4 -> caster level 2 -> 3 slots.
assert.strictEqual(spellSlotsForCharacter(char('Paladin', 1)), 2);
assert.strictEqual(spellSlotsForCharacter(char('Paladin', 2)), 2);
assert.strictEqual(spellSlotsForCharacter(char('Ranger', 1)), 2);
assert.strictEqual(spellSlotsForCharacter(char('Ranger', 4)), 3);
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

// Magic Initiate: the spell's recorded source picks the charge, so a Human with two Magic Initiate
// feats (Sage background + Versatile Cleric) spends the right one, and a class spell spends none.
const human = { ...char('Wizard', 1), speciesOriginFeat: 'Magic Initiate (Cleric)', spellSources: { 'Sleep': 'Magic Initiate (Wizard)', 'Bless': 'Magic Initiate (Cleric)', 'Magic Missile': 'Wizard' } };
assert.strictEqual(magicInitiateKeyForSpell(human, 'Bless'), 'magicInitiateClericSpell');
assert.strictEqual(magicInitiateKeyForSpell(human, 'Sleep'), 'magicInitiateWizardSpell');
assert.strictEqual(magicInitiateKeyForSpell(human, 'Magic Missile'), undefined);

// Pre-spellSources save: a non-caster's 1st-level spell can only be its Magic Initiate one; a
// caster's can't be told apart, so it uses slots.
assert.strictEqual(magicInitiateKeyForSpell(char('Fighter', 1), 'Sleep'), 'magicInitiateWizardSpell');
assert.strictEqual(magicInitiateKeyForSpell(char('Wizard', 1), 'Sleep'), undefined);

console.log('spellSlots.selfcheck: all assertions passed');
