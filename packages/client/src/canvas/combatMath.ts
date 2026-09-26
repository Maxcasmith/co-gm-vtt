import type { Character } from 'shared';
import { statMod, effectiveWeaponProfs, CLASS_SPELLCASTING_ABILITY, isPactWeapon } from 'shared';
import type { TargetingStartPayload } from '../events.ts';

// Mirrors the server's attack-roll math (packages/api/src/index.ts combat:attack / combat:spell:attack)
// so the hover readout matches the actual roll odds, including extended-range disadvantage.
export function attackBonusFor(character: Character, targeting: TargetingStartPayload): number | null {
  const charProf = character.proficiencyBonus ?? 2;
  if (targeting.kind === 'weapon' && targeting.viaFamiliar) return null; // the familiar's own bonus, not known client-side
  if (targeting.kind === 'weapon') {
    const weapon = targeting.weapon;
    const strMod = statMod(character.stats.str);
    const dexMod = statMod(character.stats.dex);
    const isMelee = weapon.range <= 10; // covers reach weapons (e.g. Whip, range 10) — next tier up is bows at 80+
    const useDex = !isMelee || (weapon.isFinesse && dexMod > strMod);
    // Pact of the Blade: proficient, and Charisma if it beats Str/Dex.
    const pact = isPactWeapon(character, weapon);
    const statBonus = Math.max(useDex ? dexMod : strMod, pact ? statMod(character.stats.cha) : -Infinity);
    const classWeaponProfs = effectiveWeaponProfs(character);
    const isProficient = pact || weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
    const weaponBonus = (weapon.attackBonus ?? 0) + (isProficient ? charProf : 0);
    return statBonus + weaponBonus;
  }
  if (targeting.kind === 'ability') return null;
  if (targeting.spell.combat?.resolution !== 'attack') return null;
  const spellAbility = CLASS_SPELLCASTING_ABILITY[character.class] ?? 'int';
  return statMod(character.stats[spellAbility]) + charProf;
}

// Mirrors resolveHit (packages/api/src/combat/dice.ts): a natural 1 always misses, a natural 20
// always hits, so the odds are never 0% or 100% — 19 of 20 faces hit at best, 1 of 20 at worst.
export function hitChancePercent(attackBonus: number, ac: number, withDisadvantage: boolean): number {
  const needed = ac - attackBonus; // roll required on the d20 (before the nat1/nat20 floor/ceiling)
  const single = Math.max(1, Math.min(19, 21 - needed)) / 20; // faces 2-19 that hit on a flat roll, plus the guaranteed nat20
  return Math.round((withDisadvantage ? single * single : single) * 100);
}
