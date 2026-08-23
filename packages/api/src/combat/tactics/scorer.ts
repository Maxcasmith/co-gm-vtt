import { CLASS_SPELLCASTING_ABILITY, resolveSpellDamageDice, statMod } from 'shared';
import type { Character, Directive } from 'shared';
import { weaponFor } from '../runtime.ts';
import { findSpell } from '../../routes/spells.ts';
import { averageDamage } from '../ai/planEvaluator.ts';
import { selfHpPct } from './conditionEvaluator.ts';

/** Same flat to-hit estimate combat/ai/planEvaluator uses — a ranking heuristic doesn't need a real d20-vs-AC resolution, just every candidate shifted by the same factor. */
const FLAT_HIT_CHANCE = 0.65;
/** Below this self-HP%, entering/staying in melee starts costing score; scales to its max at 0 HP. */
const RISK_THRESHOLD_PCT = 50;
const MELEE_RISK_WEIGHT = 8;
/** Flat baseline for actions with no direct damage number (Move, Dash, Disengage, Dodge) — enough to beat doing nothing when no attack is available yet, but loses to any real attack once one is. */
const UTILITY_BASELINE_SCORE = 1;
/** How much a Use Consumable directive's score rises as self-HP drops — same danger curve as selfRiskCost, mirrored into a bonus instead of a cost. */
const ITEM_URGENCY_WEIGHT = 10;

function expectedWeaponDamage(character: Character): number {
  const weapon = weaponFor(character);
  const isMelee = weapon.range <= 10;
  const strMod = statMod(character.stats.str);
  const dexMod = statMod(character.stats.dex);
  const useDex = !isMelee || (weapon.isFinesse && dexMod > strMod);
  return (averageDamage(weapon.damage) + (useDex ? dexMod : strMod)) * FLAT_HIT_CHANCE;
}

function expectedSpellDamage(character: Character, spellName: string): number {
  const spell = findSpell(spellName);
  const dmgEffect = spell?.combat?.onHit?.find(e => e.type === 'damage');
  if (!spell || !dmgEffect) return 0;
  const abilityKey = CLASS_SPELLCASTING_ABILITY[character.class] ?? 'int';
  const abilityMod = statMod(character.stats[abilityKey]);
  const dice = resolveSpellDamageDice(dmgEffect.scaling, character.level ?? 1, spell.level, abilityMod) ?? dmgEffect.scaling?.base;
  return dice ? averageDamage(dice) * FLAT_HIT_CHANCE : 0;
}

/**
 * Rises from 0 (at RISK_THRESHOLD_PCT self-HP and above) toward MELEE_RISK_WEIGHT (at 0 HP) — a
 * full-health fighter's sword edge stands, a dying one's doesn't, without either action's raw
 * damage number changing at all.
 * ponytail: flat constant, not weighed against actual incoming threat (how many enemies, their
 * own damage) — revisit if this over/under-reacts once played with real encounters.
 */
function selfRiskCost(character: Character, involvesMelee: boolean): number {
  if (!involvesMelee) return 0;
  const danger = Math.max(0, (RISK_THRESHOLD_PCT - selfHpPct(character)) / RISK_THRESHOLD_PCT);
  return danger * MELEE_RISK_WEIGHT;
}

/** One number per eligible directive — executionLoop.ts picks the highest each decision point. Not normalized against any pool: candidates are only ever compared against each other, for one actor, at one instant. */
export function scoreDirective(directive: Directive, character: Character): number {
  if (directive.kind === 'move' || directive.kind === 'dash' || directive.kind === 'disengage' || directive.kind === 'dodge') return UTILITY_BASELINE_SCORE;
  if (directive.kind === 'target') return 0; // unreachable — walkGroup never pushes a "target" directive as a candidate
  if (directive.kind === 'useConsumable') return UTILITY_BASELINE_SCORE + Math.max(0, (RISK_THRESHOLD_PCT - selfHpPct(character)) / RISK_THRESHOLD_PCT) * ITEM_URGENCY_WEIGHT;

  const isWeapon = directive.kind === 'attackWithWeapon';
  const damage = isWeapon ? expectedWeaponDamage(character) : expectedSpellDamage(character, directive.spellName ?? '');
  const involvesMelee = isWeapon && weaponFor(character).range <= 10;
  return damage - selfRiskCost(character, involvesMelee);
}
