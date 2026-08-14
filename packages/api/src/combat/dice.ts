import type { EffectSpec, CreatureType, Character } from 'shared';
import { resolveSpellDamageDice, effectApplies, statMod, hasOriginFeat } from 'shared';
import { HIT_DICE, CR_XP, CR_STEPS } from '../state.ts';

export class D20Roll {
  withAdvantage: boolean;
  withDisadvantage: boolean;

  constructor(opts?: { withAdvantage?: boolean; withDisadvantage?: boolean }) {
    this.withAdvantage = opts?.withAdvantage ?? false;
    this.withDisadvantage = opts?.withDisadvantage ?? false;
  }

  roll(): number {
    const raw = () => Math.floor(Math.random() * 20) + 1;
    const adv = this.withAdvantage && !this.withDisadvantage;
    const dis = this.withDisadvantage && !this.withAdvantage;
    const r1 = raw();
    if (!adv && !dis) return r1;
    const r2 = raw();
    return adv ? Math.max(r1, r2) : Math.min(r1, r2);
  }
}

export function fmtMod(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

export function rollDice(formula: string): number {
  const m = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return 1;
  let total = parseInt(m[3] ?? '0');
  for (let i = 0; i < parseInt(m[1]!); i++) total += Math.floor(Math.random() * parseInt(m[2]!)) + 1;
  return Math.max(1, total);
}

// Rolls every 'damage' onHit effect whose appliesIf (if any) matches the target's creature
// type, and sums them — e.g. Divine Smite's base 2d8 plus a conditional +1d8 vs Fiend/Undead
// are two separate EffectSpec entries that both land on the same hit.
export function rollApplicableDamage(
  effects: EffectSpec[] | undefined,
  targetType: CreatureType,
  casterLevel: number,
  slotLevel: number,
  chosenDamageType?: string,
  casterAbilityMod?: number,
): { total: number; formula: string; damageType: string | undefined } | undefined {
  const applicable = (effects ?? []).filter(e => e.type === 'damage' && effectApplies(e, targetType));
  if (!applicable.length) return undefined;
  let total = 0;
  const formulas: string[] = [];
  let damageType: string | undefined;
  for (const e of applicable) {
    const dice = resolveSpellDamageDice(e.scaling, casterLevel, slotLevel, casterAbilityMod) ?? e.scaling?.base;
    if (!dice) continue;
    total += rollDice(dice);
    formulas.push(dice);
    const type = chosenDamageType && e.damageTypeOptions?.includes(chosenDamageType) ? chosenDamageType : e.damageType;
    damageType ??= type;
  }
  return formulas.length ? { total, formula: formulas.join(' + '), damageType } : undefined;
}

// Rolls every 'heal' onHit effect and sums them, adding the caster's spellcasting ability
// modifier once at the end — Cure Wounds/Healing Word's "2d8 + spellcasting ability modifier"
// (the modifier isn't per-effect; there's only ever one heal effect per spell in practice).
export function rollApplicableHeal(
  effects: EffectSpec[] | undefined,
  casterLevel: number,
  slotLevel: number,
  abilityMod: number,
): { total: number; formula: string } | undefined {
  const applicable = (effects ?? []).filter(e => e.type === 'heal');
  if (!applicable.length) return undefined;
  let total = 0;
  const formulas: string[] = [];
  for (const e of applicable) {
    const dice = resolveSpellDamageDice(e.scaling, casterLevel, slotLevel) ?? e.scaling?.base;
    if (!dice) continue;
    total += rollDice(dice);
    formulas.push(dice);
  }
  if (!formulas.length) return undefined;
  return { total: Math.max(0, total + abilityMod), formula: `${formulas.join(' + ')}${fmtMod(abilityMod)}` };
}

function rollDiceFaces(count: number, faces: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => Math.floor(Math.random() * faces) + 1);
}

/** Chaos Bolt's chosen-d8 → damage type table. */
const CHAOS_BOLT_TYPES: Record<number, string> = {
  1: 'Acid', 2: 'Cold', 3: 'Fire', 4: 'Force',
  5: 'Lightning', 6: 'Poison', 7: 'Psychic', 8: 'Thunder',
};

/**
 * Chaos Bolt and Chromatic Orb both need their d8s rolled individually rather than as a flat
 * total — a matching pair on those d8s is what triggers the "leap to a new target" chain, and
 * Chaos Bolt additionally reads its damage type off the first d8 instead of letting the caster
 * pick one (Chromatic Orb's type is still a free pick, passed through via chosenDamageType).
 *
 * Only the leading NdM group in the formula (the d8s) is rolled individually; any trailing
 * kicker (Chaos Bolt's "+Nd6") just adds to the total through the ordinary rollDice path.
 *
 * Called out by spell name at the two call sites rather than a generic schema field — worth
 * generalizing the day a third chaining spell shows up.
 */
export function rollChainableDamage(
  effect: EffectSpec,
  casterLevel: number,
  slotLevel: number,
  opts: { deriveTypeFromRoll?: boolean; chosenDamageType?: string | undefined } = {},
): { total: number; formula: string; damageType: string | undefined; matchedDie: boolean } | undefined {
  const formula = resolveSpellDamageDice(effect.scaling, casterLevel, slotLevel) ?? effect.scaling?.base;
  if (!formula) return undefined;

  const leadMatch = formula.match(/^(\d+)d8\b/i);
  const d8Count = leadMatch ? parseInt(leadMatch[1]!) : 0;
  const d8Faces = rollDiceFaces(d8Count, 8);
  let total = d8Faces.reduce((a, b) => a + b, 0);

  const rest = formula.slice(leadMatch?.[0].length ?? 0).replace(/^\+/, '');
  const restMatch = rest.match(/^(\d+)d(\d+)([+-]\d+)?/i);
  if (restMatch) total += rollDice(`${restMatch[1]}d${restMatch[2]}${restMatch[3] ?? ''}`);

  const rolledType = d8Faces.length ? CHAOS_BOLT_TYPES[d8Faces[0]!] : undefined;
  const pickedType = opts.chosenDamageType && effect.damageTypeOptions?.includes(opts.chosenDamageType) ? opts.chosenDamageType : effect.damageType;

  return {
    total,
    formula: `${formula} (${d8Faces.join(',')})`,
    damageType: opts.deriveTypeFromRoll ? (rolledType ?? pickedType) : pickedType,
    matchedDie: d8Faces.length >= 2 && new Set(d8Faces).size !== d8Faces.length,
  };
}

export function calcMaxHp(char: Character): number {
  const toughBonus = hasOriginFeat(char, 'Tough') ? 2 * (char.level ?? 1) : 0;
  return (char.maxHp ?? ((HIT_DICE[char.class] ?? 8) + statMod(char.stats.con) + toughBonus));
}

export function crToXp(cr: number): number { return CR_XP.find(([c]) => c === cr)?.[1] ?? Math.round(cr * 200); }

export function escalateCr(cr: number): number {
  const next = CR_STEPS.find(c => c > cr);
  return next ?? cr + 1;
}

export function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
