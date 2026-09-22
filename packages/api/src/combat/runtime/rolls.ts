import type { AbilityKey, ActiveCondition, Character, CharacterStats, CombatRollEvent, RollBreakdown, RollModifier } from 'shared';
import { statMod, CLASS_SAVING_THROWS, SKILL_ABILITY } from 'shared';
import { getCharacter } from '../../storage.ts';
import { fightOf, toFight, getStateEngine, STAT_FULL, BG_SKILLS } from '../../state.ts';
import { rollD20, withModifiers, keptDie } from '../dice.ts';
import { conditionModeSources } from '../conditions/rollModeFor.ts';
import { rollAndConsumeRollMods, type RollModifierHook } from '../stateEngine/hooks/RollModifierHook.ts';
import type { StateEngine } from '../stateEngine/StateEngine.ts';
import type { IllusionTagHook } from '../stateEngine/hooks/IllusionTagHook.ts';

function abilityLine(stats: CharacterStats, ability: AbilityKey): RollModifier {
  return { label: STAT_FULL[ability.toUpperCase()] ?? ability.toUpperCase(), value: statMod(stats[ability]) };
}

/**
 * Every term summed into a saving throw, one labeled line each — the single source both the
 * exploration roll:save and every mid-combat save read from. Bless/Bane apply to every save
 * (kind 'rollModifier'); Mind Sliver's save-only penalty registers separately (kind
 * 'rollModifierSaveOnly', see registerSpellHooks) so it's never also read at an attack roll.
 * A creature (no character sheet) rolls its flat ability mod plus any dice.
 */
export function saveModifiers(engine: StateEngine, ownerId: string, stats: CharacterStats, char: Character | undefined, ability: AbilityKey): RollModifier[] {
  const lines = [abilityLine(stats, ability)];
  if (char && (CLASS_SAVING_THROWS[char.class] as readonly AbilityKey[] | undefined)?.includes(ability)) lines.push({ label: 'Proficiency', value: char.proficiencyBonus ?? 2 });
  const hooks = [...engine.getHooksOwnedBy(ownerId, 'rollModifier'), ...engine.getHooksOwnedBy(ownerId, 'rollModifierSaveOnly')] as RollModifierHook[];
  return [...lines, ...rollAndConsumeRollMods(engine, hooks)];
}

/**
 * Every term summed into an ability check, one labeled line each — shared by the exploration
 * roll:check and rollSkillCheck so they can't drift apart. Expertise is its own line (2024 PHB:
 * it doubles the Proficiency Bonus). Dice: Guidance ('rollModifierCheck') only for the one skill
 * it was cast on; of the unscoped 'rollModifier' dice only the one-shot ones (consumeOnUse —
 * Bardic Inspiration, "any d20 Test") — Bless/Bane and enemy buff dice cover attacks and saves only.
 */
export function checkModifiers(engine: StateEngine, ownerId: string, stats: CharacterStats, char: Character | undefined, ability: AbilityKey, skill?: string): RollModifier[] {
  const lines = [abilityLine(stats, ability)];
  const proficient = !!char && !!skill && (char.skillProficiencies.includes(skill) || (BG_SKILLS[char.background] ?? []).includes(skill));
  if (proficient) {
    const pb = char.proficiencyBonus ?? 2;
    lines.push({ label: 'Proficiency', value: pb });
    if (char.expertiseSkills?.includes(skill)) lines.push({ label: 'Expertise', value: pb });
  }
  const guidance = skill ? (engine.getHooksOwnedBy(ownerId, 'rollModifierCheck') as RollModifierHook[]).filter(h => h.skill === skill) : [];
  const anyD20Test = (engine.getHooksOwnedBy(ownerId, 'rollModifier') as RollModifierHook[]).filter(h => h.consumeOnUse);
  return [...lines, ...rollAndConsumeRollMods(engine, [...guidance, ...anyD20Test])];
}

/** Rolls a d20 save for a known roller — the exploration roll:save and rollSavingThrow share it. */
export function rollSave(engine: StateEngine, ownerId: string, stats: CharacterStats, holder: { conditions?: ActiveCondition[] | undefined }, char: Character | undefined, ability: AbilityKey, extraSources: Parameters<typeof rollD20>[0] = []): RollBreakdown {
  return withModifiers(rollD20([...conditionModeSources(holder, 'save', ability), ...extraSources]), saveModifiers(engine, ownerId, stats, char, ability));
}

/** Rolls a d20 ability/skill check for a known roller — the exploration roll:check and rollSkillCheck share it. */
export function rollCheck(engine: StateEngine, ownerId: string, stats: CharacterStats, holder: { conditions?: ActiveCondition[] | undefined }, char: Character | undefined, ability: AbilityKey, skill?: string, extraSources: Parameters<typeof rollD20>[0] = []): RollBreakdown {
  return withModifiers(rollD20([...conditionModeSources(holder, 'check', ability), ...extraSources]), checkModifiers(engine, ownerId, stats, char, ability, skill));
}

/**
 * Rolls a saving throw for targetId (player or creature) against a fixed DC — the piece shared
 * by concentration checks and any other "target rolls a save mid-combat" mechanic (Searing
 * Smite's Burning re-saving each turn to end early). No stats found (untracked participant)
 * auto-succeeds rather than crashing; that should not happen for anyone actually in the fight.
 */
export async function rollSavingThrow(
  cid: string, targetId: string, ability: AbilityKey, dc: number,
): Promise<{ saved: boolean; roll: number; bonus: number; total: number; breakdown: RollBreakdown | undefined }> {
  const participant = fightOf(cid, targetId)?.findParticipant(targetId);
  const creature = participant?.creature;
  const char = creature ? undefined : (await getCharacter(cid, participant?.id ?? targetId)) ?? undefined;
  const stats = creature?.stats ?? char?.stats;
  if (!stats) return { saved: true, roll: 0, bonus: 0, total: 0, breakdown: undefined };

  const breakdown = rollSave(getStateEngine(cid), targetId, stats, creature ?? char ?? {}, char, ability);
  const roll = keptDie(breakdown);
  return { saved: breakdown.total >= dc, roll, bonus: breakdown.total - roll, total: breakdown.total, breakdown };
}

/**
 * Rolls a skill check (Athletics, Perception, ...) for targetId against a fixed DC — the ability
 * check counterpart to rollSavingThrow, for anything a player attempts on their own initiative
 * rather than something rolled in response to an effect (Ensnaring Strike/Entangle's "make a
 * Strength (Athletics) check to escape"). A creature (no character sheet, no skillProficiencies)
 * rolls flat ability mod, same fallback rollSavingThrow uses for class-save proficiency.
 */
export async function rollSkillCheck(
  cid: string, targetId: string, skill: string, dc: number,
): Promise<{ succeeded: boolean; roll: number; bonus: number; total: number; breakdown: RollBreakdown | undefined }> {
  const ability = SKILL_ABILITY[skill];
  if (!ability) return { succeeded: true, roll: 0, bonus: 0, total: 0, breakdown: undefined };

  const participant = fightOf(cid, targetId)?.findParticipant(targetId);
  const creature = participant?.creature;
  const char = creature ? undefined : (await getCharacter(cid, participant?.id ?? targetId)) ?? undefined;
  const stats = creature?.stats ?? char?.stats;
  if (!stats) return { succeeded: true, roll: 0, bonus: 0, total: 0, breakdown: undefined };

  const breakdown = rollCheck(getStateEngine(cid), targetId, stats, creature ?? char ?? {}, char, ability, skill);
  const roll = keptDie(breakdown);
  return { succeeded: breakdown.total >= dc, roll, bonus: breakdown.total - roll, total: breakdown.total, breakdown };
}

/**
 * Puts a roll that has no card of its own (concentration, Sanctuary, trap and end-of-effect
 * saves, escape checks) into the Combat Log of the fight `actorId` is in. A save that had nothing
 * to roll with (auto-success, no breakdown) is skipped rather than shown as a fake roll.
 */
export function emitCombatRoll(cid: string, actorId: string, data: Omit<CombatRollEvent, 'breakdown'> & { breakdown: RollBreakdown | undefined }): void {
  const encounter = fightOf(cid, actorId);
  const { breakdown } = data;
  if (!encounter || !breakdown) return;
  toFight(encounter).emit('combat:roll', { ...data, breakdown });
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
): Promise<{ tagName: string; succeeded: boolean; roll: number; bonus: number; total: number; dc: number; breakdown: RollBreakdown | undefined }[]> {
  const tags = getStateEngine(cid).getHooksOwnedBy(targetId, 'illusionTag') as IllusionTagHook[];
  const results = [];
  for (const tag of tags) {
    const result = await rollSkillCheck(cid, investigatorId, 'Investigation', tag.dc);
    results.push({ tagName: tag.tagName, dc: tag.dc, ...result });
  }
  return results;
}

