// Standalone check for trapEffectFor — no test framework in this repo, so this is the one runnable
// check: `tsx src/dungeon/placer.trapEffectFor.selfcheck.ts` from packages/api.
// Asserts: a 'seal' trap carries no save/damage at all (the freezer-door bug — a door slam should
// never roll damage), a 'damage' trap with full mechanics builds a real save+effect, and a
// 'damage' trap missing its mechanics builds an EMPTY effect (checkTrapAt's alert-only fallback),
// never a guessed formula.
import { trapEffectFor } from './placer.ts';
import type { ManifestTrap } from './manifest.ts';

// A door-slam trap — the actual freezer-door scenario this was built to fix.
const seal: ManifestTrap = { name: 'a swollen door with a rusted latch', hideDC: 14, kind: 'seal', escapeSkill: 'Athletics', escapeDC: 14 };
const sealEffect = trapEffectFor(seal);
if (sealEffect.kind !== 'seal') throw new Error(`expected kind 'seal', got ${sealEffect.kind}`);
if (sealEffect.save) throw new Error('a seal trap must never carry a save — it should never roll damage');
if (sealEffect.effects.length !== 0) throw new Error(`a seal trap must never carry damage effects, got ${JSON.stringify(sealEffect.effects)}`);
if (sealEffect.escapeDC !== 14 || sealEffect.escapeSkill !== 'Athletics') throw new Error('escape mechanics should carry through unchanged');

// A fully-specified damage trap — dart trap, real mechanics given.
const damage: ManifestTrap = { name: 'a pressure plate', hideDC: 12, kind: 'damage', saveAbility: 'dex', dc: 13, damageFormula: '1d4', damageType: 'Piercing' };
const damageEffect = trapEffectFor(damage);
if (damageEffect.kind !== 'damage') throw new Error(`expected kind 'damage', got ${damageEffect.kind}`);
if (damageEffect.save?.dc !== 13 || damageEffect.save?.ability !== 'dex') throw new Error(`save not built correctly: ${JSON.stringify(damageEffect.save)}`);
if (damageEffect.effects[0]?.scaling?.base !== '1d4') throw new Error(`damage formula not carried through: ${JSON.stringify(damageEffect.effects)}`);

// A 'damage'-kind trap the model under-specified (no formula/DC given) — must NOT guess a
// formula. Empty effects + no save routes into checkTrapAt's existing alert-only branch.
const underspecified: ManifestTrap = { name: 'something', hideDC: 10, kind: 'damage' };
const underspecifiedEffect = trapEffectFor(underspecified);
if (underspecifiedEffect.save) throw new Error('an under-specified damage trap must not invent a save DC');
if (underspecifiedEffect.effects.length !== 0) throw new Error('an under-specified damage trap must not invent a damage formula');

console.log('placer.trapEffectFor selfcheck: OK — seal traps never deal damage, full damage traps build correctly, under-specified traps never guess a formula.');
