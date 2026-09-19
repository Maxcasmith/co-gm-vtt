import type { AbilityKey } from 'shared';
import { statMod, CLASS_SAVING_THROWS, SKILL_ABILITY } from 'shared';
import { getCharacter } from '../../storage.ts';
import { encounters, getStateEngine } from '../../state.ts';
import { D20Roll } from '../dice.ts';
import { rollModeFor } from '../conditions/rollModeFor.ts';
import { sumAndConsumeRollMods, type RollModifierHook } from '../stateEngine/hooks/RollModifierHook.ts';
import type { IllusionTagHook } from '../stateEngine/hooks/IllusionTagHook.ts';

/**
 * Rolls a saving throw for targetId (player or creature) against a fixed DC — the piece shared
 * by concentration checks and any other "target rolls a save mid-combat" mechanic (Searing
 * Smite's Burning re-saving each turn to end early). No stats found (untracked participant)
 * auto-succeeds rather than crashing; that should not happen for anyone actually in the fight.
 */
export async function rollSavingThrow(
  cid: string, targetId: string, ability: AbilityKey, dc: number,
): Promise<{ saved: boolean; roll: number; bonus: number; total: number }> {
  const encounter = encounters.get(cid);
  const participant = encounter?.findParticipant(targetId);
  const creature = participant?.creature;
  const char = creature ? undefined : await getCharacter(cid, participant?.id ?? targetId);
  const stats = creature?.stats ?? char?.stats;
  if (!stats) return { saved: true, roll: 0, bonus: 0, total: 0 };

  const classSaves: readonly string[] = char ? (CLASS_SAVING_THROWS[char.class] ?? []) : [];
  const proficient = classSaves.includes(ability);
  // Bless/Bane apply to every save (kind 'rollModifier'); Mind Sliver's save-only penalty
  // registers separately (kind 'rollModifierSaveOnly', see registerSpellHooks) so it's never
  // also read at an attack roll. Both rerolled fresh here, not fixed at cast time.
  const engine = getStateEngine(cid);
  const rollMods = [
    ...engine.getHooksOwnedBy(targetId, 'rollModifier'),
    ...engine.getHooksOwnedBy(targetId, 'rollModifierSaveOnly'),
  ] as RollModifierHook[];
  const modBonus = sumAndConsumeRollMods(engine, rollMods);
  const bonus = statMod(stats[ability]) + (proficient ? (char?.proficiencyBonus ?? 2) : 0) + modBonus;

  const mode = rollModeFor(creature ?? char ?? {}, 'save', ability);
  const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
  const total = roll + bonus;
  return { saved: total >= dc, roll, bonus, total };
}

/**
 * Rolls a skill check (Athletics, Perception, ...) for targetId against a fixed DC — the ability
 * check counterpart to rollSavingThrow, for anything a player attempts on their own initiative
 * rather than something rolled in response to an effect (Ensnaring Strike/Entangle's "make a
 * Strength (Athletics) check to escape"). Proficiency doubles for expertiseSkills, same as any
 * 5e skill; a creature (no character sheet, no skillProficiencies) rolls flat ability mod, same
 * fallback rollSavingThrow uses for class-save proficiency.
 */
export async function rollSkillCheck(
  cid: string, targetId: string, skill: string, dc: number,
): Promise<{ succeeded: boolean; roll: number; bonus: number; total: number }> {
  const ability = SKILL_ABILITY[skill];
  if (!ability) return { succeeded: true, roll: 0, bonus: 0, total: 0 };

  const encounter = encounters.get(cid);
  const participant = encounter?.findParticipant(targetId);
  const creature = participant?.creature;
  const char = creature ? undefined : await getCharacter(cid, participant?.id ?? targetId);
  const stats = creature?.stats ?? char?.stats;
  if (!stats) return { succeeded: true, roll: 0, bonus: 0, total: 0 };

  const proficient = !!char?.skillProficiencies.includes(skill);
  const expertise = !!char?.expertiseSkills?.includes(skill);
  const profBonus = char?.proficiencyBonus ?? 2;
  const bonus = statMod(stats[ability]) + (proficient ? profBonus * (expertise ? 2 : 1) : 0);

  const mode = rollModeFor(creature ?? char ?? {}, 'check', ability);
  const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
  const total = roll + bonus;
  return { succeeded: total >= dc, roll, bonus, total };
}

/**
 * Rolls Investigation for investigatorId against every illusionTag hook targetId carries
 * (Disguise Self's "Disguised") — each tag's own DC is the caster's spell save DC, frozen at
 * cast time. Doesn't touch the tag either way: seeing through an illusion is knowledge specific
 * to the investigator, not something that ends the spell for anyone else (RAW), so the hook
 * stays registered and a second creature can still fail against the exact same disguise.
 */
export async function investigateIllusion(
  cid: string, targetId: string, investigatorId: string,
): Promise<{ tagName: string; succeeded: boolean; roll: number; bonus: number; total: number; dc: number }[]> {
  const tags = getStateEngine(cid).getHooksOwnedBy(targetId, 'illusionTag') as IllusionTagHook[];
  const results = [];
  for (const tag of tags) {
    const result = await rollSkillCheck(cid, investigatorId, 'Investigation', tag.dc);
    results.push({ tagName: tag.tagName, dc: tag.dc, ...result });
  }
  return results;
}

