import type { EffectSpec, CreatureType, Character } from 'shared';
import { resolveSpellDamageDice, effectApplies, statMod } from 'shared';
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
): { total: number; formula: string; damageType: string | undefined } | undefined {
  const applicable = (effects ?? []).filter(e => e.type === 'damage' && effectApplies(e, targetType));
  if (!applicable.length) return undefined;
  let total = 0;
  const formulas: string[] = [];
  let damageType: string | undefined;
  for (const e of applicable) {
    const dice = resolveSpellDamageDice(e.scaling, casterLevel, slotLevel) ?? e.scaling?.base;
    if (!dice) continue;
    total += rollDice(dice);
    formulas.push(dice);
    damageType ??= e.damageType;
  }
  return formulas.length ? { total, formula: formulas.join(' + '), damageType } : undefined;
}

export function calcMaxHp(char: Character): number {
  return (char.maxHp ?? ((HIT_DICE[char.class] ?? 8) + statMod(char.stats.con)));
}

export function crToXp(cr: number): number { return CR_XP.find(([c]) => c === cr)?.[1] ?? Math.round(cr * 200); }

export function escalateCr(cr: number): number {
  const next = CR_STEPS.find(c => c > cr);
  return next ?? cr + 1;
}

export function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
