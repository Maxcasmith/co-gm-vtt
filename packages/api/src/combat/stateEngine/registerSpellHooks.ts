import type { HookSpec, CreatureType } from 'shared';
import { effectApplies, resolveSpellDamageDice } from 'shared';
import type { Hook } from './Hook.ts';
import type { StateEngine } from './StateEngine.ts';
import { AcModifierHook } from './hooks/AcModifierHook.ts';
import { AcOverrideHook } from './hooks/AcOverrideHook.ts';
import { RecurringDamageHook } from './hooks/RecurringDamageHook.ts';
import { OnHitBonusDamageHook } from './hooks/OnHitBonusDamageHook.ts';
import { DamageResistanceHook } from './hooks/DamageResistanceHook.ts';
import { ExpiryHook, RoundExpiryHook, GameTimeExpiryHook, type ConditionClear } from './hooks/ExpiryHook.ts';
import { GrantAdvantageHook } from './hooks/GrantAdvantageHook.ts';
import { RetaliationDamageHook } from './hooks/RetaliationDamageHook.ts';
import { AttackerDisadvantageHook } from './hooks/AttackerDisadvantageHook.ts';
import { SanctuaryWardHook } from './hooks/SanctuaryWardHook.ts';
import { SpeedModifierHook } from './hooks/SpeedModifierHook.ts';
import { LinkedActionEconomyHook } from './hooks/LinkedActionEconomyHook.ts';
import { ReactionLockHook } from './hooks/ReactionLockHook.ts';
import { ActionUnlockHook } from './hooks/ActionUnlockHook.ts';
import { RollModifierHook } from './hooks/RollModifierHook.ts';
import { ConditionImmunityHook } from './hooks/ConditionImmunityHook.ts';
import { IllusionTagHook } from './hooks/IllusionTagHook.ts';
import { MovementDamageHook } from './hooks/MovementDamageHook.ts';
import { IlluminationSourceHook } from './hooks/IlluminationSourceHook.ts';
import { WeaponAttackOverrideHook } from './hooks/WeaponAttackOverrideHook.ts';
import { applyCondition, recomputeIllumination } from '../runtime.ts';

export interface SpellHookContext {
  /** Who the hook attaches to — the caster for 'self' specs, an affected target otherwise. */
  ownerId: string;
  casterId: string;
  casterLevel: number;
  slotLevel: number;
  currentRound: number;
  /** onHitBonusDamage only — the specific target the owner's hits are checked against. */
  markedTargetId?: string | undefined;
  /** recurringDamage + saveToEnd only — the fixed DC re-rolled against every trigger (Searing Smite's Burning). */
  dc?: number;
  /** appliesIf gate only — the actual target's creature type, checked once here rather than trusting the caller to have pre-filtered (Cause Fear's Construct/Undead immunity). */
  targetCreatureType?: CreatureType;
  /** gameTime duration only — the campaign's current worldTimeSecs, needed to turn a relative gameSecs into the absolute expiry timestamp GameTimeExpiryHook is swept against. */
  currentWorldTimeSecs?: number | undefined;
  /** recurringDamage's scaling/tempHpScaling, mode 'ability-mod' only — the caster's spellcasting ability modifier, frozen at cast time same as dc (Heroism's temp HP). */
  casterAbilityMod?: number | undefined;
  /** damageResistance's damageTypeOptions only — the caster's cast-time pick (Resistance's chosen damage type), same client payload field EffectSpec.damageTypeOptions already reads. */
  chosenDamageType?: string | undefined;
  /** rollModifier's scopedToChosenSkill only — the caster's cast-time pick (Guidance's chosen skill), see SpellCombatMeta.skillOptions. */
  chosenSkill?: string | undefined;
}

/** Instantiates the class a HookSpec names. Returns null for specs missing the data their type needs. */
function hookFromSpec(spec: HookSpec, source: string, ctx: SpellHookContext): Hook | null {
  const base = { ownerId: ctx.ownerId, source, kind: spec.type, ...(spec.priority !== undefined ? { priority: spec.priority } : {}) };

  switch (spec.type) {
    case 'acModifier':
      if (spec.value === undefined) return null;
      return new AcModifierHook({ ...base, value: spec.value });
    case 'recurringDamage':
      // Needs at least a damage tick, a temp-hp tick, or a condition to track — a spec with none
      // of those has nothing for this hook to do. Cause Fear/Ray of Sickness/Wrathful Smite's
      // Frightened/Poisoned use it purely for the conditionName + duration/saveToEnd side, no
      // scaling at all; Heroism uses it purely for the tempHpScaling side.
      if (!spec.scaling && !spec.tempHpScaling && !spec.conditionName && !spec.conditionNames?.length) return null;
      return new RecurringDamageHook({
        ...base,
        casterId: ctx.casterId,
        casterLevel: ctx.casterLevel,
        slotLevel: ctx.slotLevel,
        scaling: spec.scaling,
        damageType: spec.damageType,
        tempHpScaling: spec.tempHpScaling,
        casterAbilityMod: ctx.casterAbilityMod,
        conditionName: spec.conditionName,
        conditionNames: spec.conditionNames,
        saveToEnd: spec.saveToEnd,
        dc: ctx.dc,
        stage: spec.recurringStage,
        escapeSkillCheck: spec.escapeSkillCheck,
        endsIfCasterDamages: spec.endsIfCasterDamages,
      });
    case 'onHitBonusDamage':
      // markedTargetId locks the bonus to one creature (Hunter's Mark) — omitted entirely, it
      // applies to every hit the owner lands for the duration (Divine Favor, Zephyr Strike).
      return new OnHitBonusDamageHook({
        ...base,
        markedTargetId: ctx.markedTargetId,
        scaling: spec.scaling,
        damageType: spec.damageType,
        casterLevel: ctx.casterLevel,
        slotLevel: ctx.slotLevel,
        consumeOnUse: spec.consumeOnUse,
      });
    case 'grantAdvantage':
      // self:true (Zephyr Strike) registers under a different kind so the attacker-side query in
      // combat.ts (hasHookOwnedBy(attackerId, 'grantAdvantageSelf')) never collides with the
      // ordinary target-side one (Faerie Fire/Guiding Bolt, kind 'grantAdvantage'). disadvantage
      // (Frostbite's "disadvantage on the next weapon attack it makes") is the same bookkeeping
      // shape again — the hook itself doesn't care which direction, only which kind string the
      // query site checks and which of withAdvantage/withDisadvantage it feeds into — so it's a
      // third kind on the identical class rather than a new one. Target-side disadvantage
      // (no `self`) has no consumer yet, so it's left registering as plain 'grantAdvantage' —
      // wrong if one ever shows up, fix then.
      return new GrantAdvantageHook({
        ...base, kind: spec.self ? (spec.disadvantage ? 'grantDisadvantageSelf' : 'grantAdvantageSelf') : base.kind,
        consumeOnUse: spec.consumeOnUse, self: spec.self, speedBonusOnUseFt: spec.speedBonusOnUseFt,
      });
    case 'damageResistance': {
      if (!spec.resistanceMode) return null;
      const chosenType = spec.damageTypeOptions && ctx.chosenDamageType && spec.damageTypeOptions.includes(ctx.chosenDamageType) ? ctx.chosenDamageType : undefined;
      const damageType = chosenType ?? spec.damageType;
      if (!damageType && !spec.spellName) return null;
      return new DamageResistanceHook({ ...base, damageType, spellName: spec.spellName, mode: spec.resistanceMode, reduceDieSize: spec.reduceDieSize });
    }
    case 'acOverride':
      if (spec.baseValue === undefined) return null;
      return new AcOverrideHook({ ...base, baseValue: spec.baseValue, requiresUnarmored: spec.requiresUnarmored });
    case 'retaliateDamage':
      if (!spec.scaling) return null;
      return new RetaliationDamageHook({ ...base, scaling: spec.scaling, damageType: spec.damageType });
    case 'attackerDisadvantage':
      if (!spec.creatureTypes?.length) return null;
      return new AttackerDisadvantageHook({ ...base, creatureTypes: spec.creatureTypes });
    case 'sanctuaryWard':
      if (ctx.dc === undefined) return null;
      return new SanctuaryWardHook({ ...base, dc: ctx.dc });
    case 'speedModifier':
      if (spec.multiplier === undefined && spec.bonusFt === undefined) return null;
      return new SpeedModifierHook({ ...base, multiplier: spec.multiplier, bonusFt: spec.bonusFt });
    case 'linkedActionEconomy':
      return new LinkedActionEconomyHook(base);
    case 'reactionLock':
      // opportunityOnly (Shocking Grasp) registers under a narrower kind so it only blocks
      // Opportunity Attacks specifically, not every reaction the owner has (Shield, Hellish
      // Rebuke, ...) the way Arms of Hadar's full-block does — same class, different kind string,
      // same trick GrantAdvantageHook already uses for self/disadvantage.
      return new ReactionLockHook({ ...base, kind: spec.opportunityOnly ? 'opportunityAttackLock' : base.kind });
    case 'actionUnlock':
      if (!spec.action) return null;
      return new ActionUnlockHook({ ...base, action: spec.action });
    case 'rollModifier': {
      if (!spec.dieSize || !spec.sign) return null;
      // Blade Ward, Guidance, and Mind Sliver each register under their own narrower kind so
      // they're only ever read at the roll they actually apply to (bladeWardPenalty; roll:check
      // filtered by skill; rollSavingThrow only), never mistaken for a Bless/Bane-style
      // every-attack-and-save modifier.
      const kind = spec.appliesToAttacker ? 'rollModifierVsAttacker'
        : spec.scopedToChosenSkill ? 'rollModifierCheck'
        : spec.savesOnly ? 'rollModifierSaveOnly'
        : base.kind;
      return new RollModifierHook({ ...base, kind, dieSize: spec.dieSize, sign: spec.sign, skill: spec.scopedToChosenSkill ? ctx.chosenSkill : undefined });
    }
    case 'conditionImmunity':
      if (!spec.immuneConditions?.length) return null;
      return new ConditionImmunityHook({ ...base, immuneConditions: spec.immuneConditions });
    case 'illusionTag':
      if (ctx.dc === undefined) return null;
      return new IllusionTagHook({ ...base, tagName: spec.illusionTagName ?? 'Illusion', dc: ctx.dc });
    case 'movementDamage':
      if (!spec.scaling || spec.thresholdFt === undefined) return null;
      return new MovementDamageHook({
        ...base, casterId: ctx.casterId, casterLevel: ctx.casterLevel, slotLevel: ctx.slotLevel,
        scaling: spec.scaling, damageType: spec.damageType, thresholdFt: spec.thresholdFt, consumeOnUse: spec.consumeOnUse,
      });
    case 'illuminationSource':
      if (spec.illuminationLevel === undefined) return null;
      return new IlluminationSourceHook({ ...base, level: spec.illuminationLevel });
    case 'weaponAttackOverride':
      return new WeaponAttackOverrideHook({
        ...base,
        damageDie: spec.scaling ? resolveSpellDamageDice(spec.scaling, ctx.casterLevel, ctx.slotLevel) : undefined,
      });
  }
}

/**
 * Builds the cleanup hook a spec's duration implies. 'endOfCombat' needs none — the engine dies
 * with the fight. Every branch also tears down `conditionName` if the spec applied one (see
 * ExpiryHook's own doc) — a spec with no conditionName just passes `undefined` through, a no-op.
 */
function expiryFor(spec: HookSpec, hookId: string, source: string, ctx: SpellHookContext): Hook | null {
  const names = spec.conditionNames ?? (spec.conditionName ? [spec.conditionName] : undefined);
  const clearCondition: ConditionClear | undefined = names ? { ownerId: ctx.ownerId, name: names } : undefined;
  if (spec.duration.until === 'endOfCombat') return null;
  if (spec.duration.until === 'startOfOwnerTurn') {
    return new ExpiryHook({ ownerId: ctx.ownerId, source, targetHookIds: [hookId], clearCondition });
  }
  if (spec.duration.until === 'startOfCasterNextTurn') {
    return new ExpiryHook({ ownerId: ctx.ownerId, anchorId: ctx.casterId, source, targetHookIds: [hookId], clearCondition });
  }
  if (spec.duration.until === 'gameTime') {
    const startSecs = ctx.currentWorldTimeSecs ?? 0;
    return new GameTimeExpiryHook({
      ownerId: ctx.ownerId,
      source,
      targetHookIds: [hookId],
      expiresAtSecs: startSecs + (spec.duration.gameSecs ?? 0),
      clearCondition,
    });
  }
  return new RoundExpiryHook({
    ownerId: ctx.ownerId,
    source,
    targetHookIds: [hookId],
    expiresOnRound: ctx.currentRound + (spec.duration.rounds ?? 1),
    clearCondition,
  });
}

/**
 * Registers a set of hook specs onto one participant, plus the expiry jobs their durations
 * imply. Takes the specs + a source name directly (rather than a whole Spell) so a caller can
 * register a partial subset — e.g. only the save-gated hooks a bundled smite failed against
 * (Searing Smite's Burning), out of a spell that also has ungated ones.
 *
 * Recasting replaces rather than stacks — a second Shield should refresh the +5, not make it +10.
 */
export async function registerSpellHooks(engine: StateEngine, specs: HookSpec[], source: string, ctx: SpellHookContext): Promise<void> {
  if (!specs.length) return;

  engine.unregisterBySource(ctx.ownerId, source);

  for (const spec of specs) {
    // Same gate as EffectSpec.appliesIf (Divine Smite's Fiend/Undead bonus) — a spec that names
    // creature types skips entirely for a target outside that list (Cause Fear's Construct/Undead
    // immunity), reusing the identical shape and effectApplies rather than a new exclude-list.
    if (spec.appliesIf && !effectApplies({ appliesIf: spec.appliesIf }, ctx.targetCreatureType ?? 'Humanoid')) continue;
    const hook = hookFromSpec(spec, source, ctx);
    if (!hook) continue;
    engine.register(hook);
    const expiry = expiryFor(spec, hook.id, source, ctx);
    if (expiry) engine.register(expiry);
    // recurringDamage hooks that represent named condition(s) (Searing Smite's Burning, Tasha's
    // Hideous Laughter's Prone+Incapacitated) apply them the moment they land — RecurringDamageHook
    // itself clears them when the effect ends.
    if (spec.type === 'recurringDamage') {
      for (const name of spec.conditionNames ?? (spec.conditionName ? [spec.conditionName] : [])) {
        await applyCondition(engine.campaignId, ctx.ownerId, name);
      }
    }
  }

  // Light spells need their brightness reflected the instant they're cast, not on the next
  // turn-start sweep — cheap no-op for every other spell (recomputeIllumination bails out fast
  // when nothing changed).
  if (specs.some(s => s.type === 'illuminationSource')) recomputeIllumination(engine.campaignId);
}
