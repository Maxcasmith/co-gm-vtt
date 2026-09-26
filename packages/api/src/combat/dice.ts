import type { EffectSpec, CreatureType, Character, CharacterStats, ActiveCondition, RollBreakdown, RollModeSource, RollModifier } from 'shared';
import { resolveSpellDamageDice, effectApplies, statMod, hpBonusPerLevel } from 'shared';
import { HIT_DICE, CR_XP, CR_STEPS } from '../state.ts';
import { conditionModeSources } from './conditions/rollModeFor.ts';

export const adv = (label: string): RollModeSource => ({ label, sign: 1 });
export const dis = (label: string): RollModeSource => ({ label, sign: -1 });

/**
 * Rolls a d20 under every advantage/disadvantage source that applies — pass `cond && adv('X')`
 * inline, falsy entries are skipped. 2024 PHB: any Advantage plus any Disadvantage cancels to a
 * flat roll, no matter how many of each; both sides stay listed so the log can show why.
 */
export function rollD20(sources: (RollModeSource | false | '' | null | undefined)[] = [], roller?: { species?: string | undefined }): RollBreakdown {
  const modeSources = sources.filter((s): s is RollModeSource => !!s);
  const hasAdv = modeSources.some(s => s.sign > 0);
  const hasDis = modeSources.some(s => s.sign < 0);
  const mode = hasAdv === hasDis ? 'normal' : hasAdv ? 'advantage' : 'disadvantage';
  const raw = () => Math.floor(Math.random() * 20) + 1;
  const dice = mode === 'normal' ? [raw()] : [raw(), raw()];
  const pick = () => {
    const [a, b = a] = dice as [number, number?];
    return mode === 'advantage' ? (b > a ? 1 : 0) : mode === 'disadvantage' ? (b < a ? 1 : 0) : 0;
  };
  let keptIndex = pick();
  // 2024 PHB Halfling Luck: a 1 on the d20 of a D20 Test is rerolled, and the new roll must be
  // used. Only the die that would count is rerolled — then Advantage/Disadvantage picks again.
  // `roller` is only passed at player D20 Test sites (attacks, checks, saves, initiative).
  if (roller?.species === 'Halfling' && dice[keptIndex] === 1) {
    dice[keptIndex] = raw();
    keptIndex = pick();
    return { mode, modeSources, dice, keptIndex, rerolledFrom: 1, rerolledBy: 'Luck', modifiers: [], total: dice[keptIndex]! };
  }
  return { mode, modeSources, dice, keptIndex, modifiers: [], total: dice[keptIndex]! };
}

// keptIndex always points into dice — rollD20 and reconcile are the only writers and set both together.
export function keptDie(b: RollBreakdown): number { return b.dice[b.keptIndex]!; }

export function sumModifiers(mods: RollModifier[]): number { return mods.reduce((sum, m) => sum + m.value, 0); }

/** Attaches the itemised modifiers to a rolled d20 and totals them. */
export function withModifiers(b: RollBreakdown, modifiers: RollModifier[]): RollBreakdown {
  return { ...b, modifiers, total: keptDie(b) + sumModifiers(modifiers) };
}

/**
 * Re-syncs a breakdown with the d20/bonus a hook chain (beforeAttackRoll/afterAttackRoll,
 * beforeSave) handed back. A changed d20 is a reroll (the old die shows faded); a changed bonus
 * the modifiers can't account for lands as "Other effects", so the rows always sum to the total.
 */
export function reconcile(b: RollBreakdown, d20: number, bonus: number): RollBreakdown {
  const rerolled = d20 === keptDie(b) ? b : { ...b, dice: [d20], keptIndex: 0, rerolledFrom: keptDie(b), rerolledBy: undefined };
  const delta = bonus - sumModifiers(b.modifiers);
  const modifiers = delta ? [...b.modifiers, { label: 'Other effects', value: delta }] : b.modifiers;
  return { ...rerolled, modifiers, total: d20 + bonus };
}

export function dexLine(stats: CharacterStats): RollModifier { return { label: 'Dexterity', value: statMod(stats.dex) }; }

/** Initiative is a Dexterity check (2024 PHB), so anything affecting checks (Poisoned) applies to it too. */
export function rollInitiative(holder: { conditions?: ActiveCondition[] | undefined; species?: string | undefined }, modifiers: RollModifier[]): RollBreakdown {
  return withModifiers(rollD20(conditionModeSources(holder, 'check', 'dex'), holder), modifiers);
}

export function fmtMod(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

/** 5e attack resolution: a natural 1 always misses, a natural 20 always hits (and crits), otherwise total vs AC. */
export function resolveHit(d20: number, attackBonus: number, ac: number): boolean {
  if (d20 === 1) return false;
  if (d20 === 20) return true;
  return d20 + attackBonus >= ac;
}

export function rollDice(formula: string): number {
  const m = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return 1;
  let total = parseInt(m[3] ?? '0');
  for (let i = 0; i < parseInt(m[1]!); i++) total += Math.floor(Math.random() * parseInt(m[2]!)) + 1;
  return Math.max(1, total);
}

/** Perkins Crit house rule: sum of every die's max face value in a formula (e.g. "2d8+3" → 16), ignoring flat modifiers. */
export function maxDiceValue(formula: string): number {
  let total = 0;
  for (const m of formula.matchAll(/(\d+)d(\d+)/gi)) total += parseInt(m[1]!) * parseInt(m[2]!);
  return total;
}

/** Great Weapon Fighting: reroll each damage die that comes up at or below `threshold` once, keeping the reroll. */
export function rollDiceRerollLow(formula: string, threshold = 2): number {
  const m = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return 1;
  const faces = parseInt(m[2]!);
  let total = parseInt(m[3] ?? '0');
  for (let i = 0; i < parseInt(m[1]!); i++) {
    let die = Math.floor(Math.random() * faces) + 1;
    if (die <= threshold) die = Math.floor(Math.random() * faces) + 1;
    total += die;
  }
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
  const levelBonus = hpBonusPerLevel(char) * (char.level ?? 1);
  return (char.maxHp ?? ((HIT_DICE[char.class] ?? 8) + statMod(char.stats.con) + levelBonus));
}

export function crToXp(cr: number): number { return CR_XP.find(([c]) => c === cr)?.[1] ?? Math.round(cr * 200); }

export function escalateCr(cr: number): number {
  const next = CR_STEPS.find(c => c > cr);
  return next ?? cr + 1;
}

export function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
