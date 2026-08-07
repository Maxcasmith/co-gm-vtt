import type { Character } from 'shared';
import { statMod, CLASS_WEAPON_PROFS, CLASS_SPELLCASTING_ABILITY } from 'shared';
import type { TargetingStartPayload } from '../events.ts';

// Mirrors the server's attack-roll math (packages/api/src/index.ts combat:attack / combat:spell:attack)
// so the hover readout matches the actual roll odds, including extended-range disadvantage.
export function attackBonusFor(character: Character, targeting: TargetingStartPayload): number | null {
  const charProf = character.proficiencyBonus ?? 2;
  if (targeting.kind === 'weapon') {
    const weapon = targeting.weapon;
    const strMod = statMod(character.stats.str);
    const dexMod = statMod(character.stats.dex);
    const isMelee = weapon.range <= 10; // covers reach weapons (e.g. Whip, range 10) — next tier up is bows at 80+
    const useDex = !isMelee || (weapon.isFinesse && dexMod > strMod);
    const statBonus = useDex ? dexMod : strMod;
    const classWeaponProfs = CLASS_WEAPON_PROFS[character.class] ?? [];
    const isProficient = weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
    const weaponBonus = (weapon.attackBonus ?? 0) + (isProficient ? charProf : 0);
    return statBonus + weaponBonus;
  }
  if (targeting.spell.combat?.resolution !== 'attack') return null;
  const spellAbility = CLASS_SPELLCASTING_ABILITY[character.class] ?? 'int';
  return statMod(character.stats[spellAbility]) + charProf;
}

export function hitChancePercent(attackBonus: number, ac: number, withDisadvantage: boolean): number {
  const single = Math.max(0, Math.min(1, (21 - (ac - attackBonus)) / 20));
  return Math.round((withDisadvantage ? single * single : single) * 100);
}
