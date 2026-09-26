import type { StoredFamiliar, TurnOrderEntry, Weapon, Spell, SpellAttackResult, RollBreakdown, RollModifier, SpellSaveOutcome, SpellSaveResult, CreatureType, Character, ActionResource, AttackContext, DungeonEntity, EffectSpec, AbilityKey, HookSpec } from 'shared';
import { effectiveWeaponProfs, CLASS_SPELLCASTING_ABILITY, CLASS_SAVING_THROWS, isAmmunition, isWeapon, isMonkWeapon, statMod, parseRangeFeet, resolveForcedMovement, findPath, effectApplies, actionCostFromCastingTime, requiresConcentration, resolveSpellDamageDice, hasOriginFeat, hasClassLevel, crossesObscuredArea, ABILITY_DEFS, trySpendResource, trySpendResourceAmount, resourceCurrent, getSenses, hasLineOfSight, closedDoorCells, monkMartialArtsActive, monkLevel, martialArtsDie, breathWeaponSpell, ownsAbility, invocationSpell, PACT_FAMILIAR_FORMS, isPactWeapon, weaponDamageType, PACT_WEAPON_CHOICES, PACT_WEAPON_DAMAGE_TYPES } from 'shared';
import { randomUUID } from 'crypto';
import { getCharacter, updateCharacter, saveEncounter, listCharacters, getConfig, saveDungeon, getHouseRules, loadPartyAllies, savePartyAllies } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateCombatFlavour, generateSpellSaveFlavour } from '../session-processor/imagePrompts.ts';
import { Participant, type Encounter } from '../domain/encounter.ts';
import { logError, logDebug } from '../logger.ts';
import { io, campaignRoom, fightOf, toFight, toFightOf, positionsOf, dungeonOf, fightDungeon, toDungeon, playerSocketIds, pendingWeaponBonuses, connected, getStateEngine, STAT_FULL, HIT_DICE, PLAYER_SIGHT_RADIUS, toDungeonOf } from '../state.ts';
import { toClientDungeon, broadcastDungeon } from '../dungeon/index.ts';
import { registerSpellHooks } from '../combat/stateEngine/registerSpellHooks.ts';
import { RecurringDamageHook } from '../combat/stateEngine/hooks/RecurringDamageHook.ts';
import { rollAndConsumeRollMods, type RollModifierHook } from '../combat/stateEngine/hooks/RollModifierHook.ts';
import { dcBonusFor } from '../combat/stateEngine/hooks/DcModifierHook.ts';
import type { WeaponAttackOverrideHook } from '../combat/stateEngine/hooks/WeaponAttackOverrideHook.ts';
import { resolveReaction } from '../combat/stateEngine/reactionPrompt.ts';
import { rollD20, adv, dis, keptDie, withModifiers, reconcile, sumModifiers, rollDice, rollDiceRerollLow, fmtMod, rollApplicableDamage, rollApplicableHeal, rollChainableDamage, resolveHit, maxDiceValue } from '../combat/dice.ts';
import { conditionModeSources, targetModeSources } from '../combat/conditions/rollModeFor.ts';
import { applyDamageToCreature, applyDamageToPlayer, applyHealingToPlayer, applyHealingToCreature, grantTempHpToPlayer, bladeWardPenalty } from '../combat/runtime/damage.ts';
import { advanceTurn, tryBeginCombat, updateAlertSelection, resolveAlertPause } from '../combat/runtime/lifecycle.ts';
import { trySpendSpellSlot, offerLuckAttackReroll, trySpendHeroicInspiration } from '../combat/runtime/resources.ts';
import { emitResources } from '../combat/runtime/shared.ts';
import { resolveCreatureAttack } from '../combat/runtime/ai.ts';
import { applyCondition, clearCondition, breakSanctuaryOn } from '../combat/runtime/statusEffects.ts';
import { startConcentrating, isConcentratingOn, breakConcentration } from '../combat/runtime/concentration.ts';
import { rollSavingThrow, rollSave, effectConditions, investigateIllusion, emitCombatRoll } from '../combat/runtime/rolls.ts';
import { checkTrapAt } from '../combat/runtime/traps.ts';
import { canMove, applyElevationChange, checkMovementTriggers } from '../combat/runtime/movement.ts';
import { getWorldTimeSecs } from '../combat/runtime/environment.ts';
import { stabilizeParticipant } from '../combat/runtime/deathSaves.ts';
import { checkDungeonProximity, toggleDoor, useStairs } from '../dungeon/runtime.ts';
import { applyEffects } from '../effects.ts';
import type { JoinContext } from './context.ts';
import { postChat } from '../partyGroups.ts';

/** Staggers multi-target spell resolution (Magic Missile's darts, Bless's allies, ...) so results land one at a time rather than all at once. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Every living participant within radiusFt (Chebyshev, 5ft/cell — same convention as checkTrapAt/RetaliationOfferHook's range check) of a grid point. Positions are best-effort; a participant with no placed token is skipped rather than assumed in range. Exported for origin points that aren't an existing participant (e.g. an environmental blast). */
export function participantsNearPoint(cid: string, encounter: Encounter, gx: number, gy: number, radiusFt: number, excludeIds: Set<string> = new Set()): string[] {
  const positions = fightDungeon(cid, encounter)?.positions ?? {};
  const all = [...encounter.players, ...encounter.enemies];
  return all
    .filter(p => !p.isDead() && !excludeIds.has(p.id))
    .filter(p => {
      const pos = positions[p.id] ?? positions[p.name];
      if (!pos) return false;
      return Math.max(Math.abs(pos.gx - gx), Math.abs(pos.gy - gy)) * 5 <= radiusFt;
    })
    .map(p => p.id);
}

/**
 * True if a living creature on the opposing team is within 5ft of (gx,gy) — the "hostile creature
 * within reach" condition a ranged weapon/spell attack imposes Disadvantage under (PHB: "you have
 * Disadvantage on an attack roll with a ranged weapon if a hostile creature is within 5 feet of
 * you"). ponytail: skips the "unless that creature is Incapacitated" carve-out — no cheap sync
 * access to an arbitrary nearby participant's conditions from here; add if it matters in practice.
 */
function hasHostileWithinMeleeRange(cid: string, actorId: string, gx: number, gy: number): boolean {
  const encounter = fightOf(cid, actorId);
  const actor = encounter?.findParticipant(actorId);
  if (!encounter || !actor) return false;
  return participantsNearPoint(cid, encounter, gx, gy, 5, new Set([actorId]))
    .some(id => encounter.findParticipant(id)?.teamId !== actor.teamId);
}

/**
 * True if a living, non-Incapacitated ally of actorId (same team, excluding actorId) is within
 * 5ft of (gx,gy) — Sneak Attack's (2024 PHB) "ally within 5 feet of the target" substitute for
 * Advantage. Unlike hasHostileWithinMeleeRange this does check Incapacitated, since Sneak
 * Attack's own text calls it out by name.
 */
async function hasHelpfulAllyWithinMeleeRange(cid: string, actorId: string, gx: number, gy: number): Promise<boolean> {
  const encounter = fightOf(cid, actorId);
  const actor = encounter?.findParticipant(actorId);
  if (!encounter || !actor) return false;
  const allyIds = participantsNearPoint(cid, encounter, gx, gy, 5, new Set([actorId]))
    .filter(id => encounter.findParticipant(id)?.teamId === actor.teamId);
  for (const id of allyIds) {
    const participant = encounter.findParticipant(id);
    if (!participant) continue;
    const conditions = participant.isPlayer
      ? (await getCharacter(cid, id))?.conditions
      : encounter.findCreature(id)?.conditions;
    if (!conditions?.some(c => c.name === 'Incapacitated')) return true;
  }
  return false;
}

/** Every living participant within radiusFt of centerId's own token, centerId included — see participantsNearPoint for the underlying distance rule. */
function nearbyParticipantIds(cid: string, centerId: string, radiusFt: number): string[] {
  const encounter = fightOf(cid, centerId);
  if (!encounter) return [];
  const positions = positionsOf(cid, centerId);
  const all = [...encounter.players, ...encounter.enemies];
  const center = all.find(p => p.id === centerId);
  const centerPos = center ? (positions[center.id] ?? positions[center.name]) : undefined;
  if (!centerPos) return center && !center.isDead() ? [centerId] : [];
  const rest = participantsNearPoint(cid, encounter, centerPos.gx, centerPos.gy, radiusFt, new Set([centerId]));
  return center?.isDead() ? rest : [centerId, ...rest];
}

/**
 * Resolves a save-based AoE splash (Hail of Thorns' "target and each creature within 5ft",
 * Ice Knife's Cold burst) against every living creature within radiusFt of centerId, centerId
 * included. Shared by the bundled-weapon-hit path and the ranged-spell-attack path since both
 * need the identical "gather nearby, roll a save each, apply the same damage effects" shape —
 * only how the caller gets to a centerId differs.
 */
async function resolveSplashAoE(
  cid: string, casterId: string, casterName: string, spellName: string,
  centerId: string, radiusFt: number, effects: EffectSpec[], saveAbility: AbilityKey, halfOnSave: boolean, dc: number,
  casterLevel: number, slotLevel: number, excludeIds: Set<string> = new Set(),
): Promise<void> {
  const encounter = fightOf(cid, centerId);
  if (!encounter) return;
  const engine = getStateEngine(cid);
  const outcomes: SpellSaveOutcome[] = [];

  for (const targetId of nearbyParticipantIds(cid, centerId, radiusFt).filter(id => !excludeIds.has(id))) {
    const participant = encounter.findParticipant(targetId);
    if (!participant || participant.isDead()) continue;

    const { saved, roll, total, breakdown } = await rollSavingThrow(cid, targetId, saveAbility, dc, effectConditions(effects));
    const targetType: CreatureType = participant.isPlayer ? 'Humanoid' : (participant.creature?.creatureType ?? 'Humanoid');
    const rolledDamage = rollApplicableDamage(effects, targetType, casterLevel, slotLevel);

    let damage: number | undefined;
    if (rolledDamage && (!saved || halfOnSave)) {
      const dmgCtx = await engine.trigger('beforeDamage', {
        sourceId: casterId, targetId, targetName: participant.name,
        amount: saved ? Math.floor(rolledDamage.total / 2) : rolledDamage.total,
        damageType: rolledDamage.damageType, sourceName: spellName,
      });
      damage = Math.max(0, dmgCtx.amount);
      if (participant.isPlayer) await applyDamageToPlayer(cid, participant, damage, { sourceId: casterId });
      else await applyDamageToCreature(cid, targetId, damage);
      await engine.trigger('afterDamage', dmgCtx);
    }

    outcomes.push({
      targetId, targetName: participant.name, isPC: participant.isPlayer,
      roll, breakdown, total, dc, saved, damage,
      remainingHp: participant.isPlayer ? participant.currentHp : participant.creature?.currentHp,
      targetDead: participant.isDead(),
    });
  }

  if (outcomes.length) {
    toFight(encounter).emit('combat:spell:save:result', { casterName, spellName, dc, saveAbility, slotLevel, outcomes });
  }
}

/** Drops a spell's `grantsItem` spec straight into the caster's inventory (Goodberry's ten berries) — stacked as one Consumable entry, same shape `consumable:used` already decrements. */
async function grantItem(cid: string, casterId: string, spec: NonNullable<Spell['combat']>['grantsItem']): Promise<void> {
  if (!spec) return;
  const item = {
    id: randomUUID(), type: 'consumable' as const,
    name: spec.name, description: spec.description, quantity: spec.quantity,
    effect: spec.effect, actionCost: spec.actionCost,
  };
  await updateCharacter(cid, casterId, c => ({ ...c, inventory: [...(c.inventory ?? []), item] }));
  const sid = playerSocketIds.get(casterId);
  if (sid) io.to(sid).emit('character:inventory:add', [item]);
}

const FAMILIAR_NAMES = new Set(['Familiar', ...Object.keys(PACT_FAMILIAR_FORMS)]);

/** The Find Familiar modal's pick, trimmed and capped — undefined unless it has a name. */
function sanitizeFamiliar(raw: StoredFamiliar | undefined): StoredFamiliar | undefined {
  if (!raw || typeof raw.name !== 'string' || typeof raw.description !== 'string') return undefined;
  const name = raw.name.trim().slice(0, 40);
  if (!name) return undefined;
  const form = typeof raw.form === 'string' && raw.form in PACT_FAMILIAR_FORMS ? raw.form : undefined;
  return { name, description: raw.description.trim().slice(0, 500), ...(form ? { form } : {}) };
}

/**
 * A summon spell's companion. Find Familiar takes the modal's name/description, and its form's
 * stat block when the caster has Pact of the Chain; it's tagged `familiar` so a later summon
 * replaces it (grantCompanion).
 */
function companionFor(char: Character, spell: Spell, familiar: StoredFamiliar | undefined): NonNullable<Spell['combat']>['grantsCompanion'] {
  const base = spell.combat?.grantsCompanion;
  if (!base || spell.name !== 'Find Familiar') return base;
  const form = familiar?.form && char.invocations?.includes('Pact of the Chain') ? PACT_FAMILIAR_FORMS[familiar.form] : undefined;
  return {
    ...(form ?? base),
    ...(familiar ? { name: familiar.name } : {}),
    ...(familiar?.description ? { appearance: familiar.description } : {}),
    familiar: true,
  };
}

/** Saves the summoned familiar to the caster's stored list (upsert by name) for the modal to offer next time. */
async function rememberFamiliar(cid: string, casterId: string, familiar: StoredFamiliar | undefined): Promise<void> {
  if (!familiar) return;
  const key = familiar.name.toLowerCase();
  const updated = await updateCharacter(cid, casterId, c => ({
    ...c,
    familiars: [...(c.familiars ?? []).filter(f => f.name.toLowerCase() !== key), familiar],
  }));
  const sid = playerSocketIds.get(casterId);
  if (sid && updated?.familiars) io.to(sid).emit('character:familiars:update', { characterId: casterId, familiars: updated.familiars });
}

/**
 * Summons a spell's `grantsCompanion` spec via the same party_join effect a recruited NPC ally
 * uses (persists, auto-joins turn order if combat is active) — tagged with `ownerId: casterId`
 * so the summoner gets the same drag/move control over its token as their own (the "telepathic
 * link," simplified — see EnemyStatBlock.ownerId), and dropped at the caster's own cell so it
 * actually has a token to grab in the first place.
 */
async function grantCompanion(cid: string, casterId: string, casterName: string, spec: NonNullable<Spell['combat']>['grantsCompanion']): Promise<void> {
  if (!spec) return;
  const id = randomUUID();
  // Casting Find Familiar again swaps the form (2024 PHB) — drop this caster's old familiar first.
  // ponytail: only the saved roster; an old familiar already in a live fight stays until it ends.
  if (spec.familiar) {
    const allies = await loadPartyAllies(cid);
    // FAMILIAR_NAMES catches familiars summoned before the `familiar` tag existed.
    const kept = allies.filter(a => !(a.ownerId === casterId && (a.familiar || FAMILIAR_NAMES.has(a.name))));
    if (kept.length !== allies.length) await savePartyAllies(cid, kept);
  }
  await applyEffects(cid, [{ type: 'party_join', ally: { ...spec, id, ownerId: casterId } }], [casterId]);
  const pos = positionsOf(cid, casterName)[casterName] ?? positionsOf(cid, casterName)[casterId];
  if (pos) {
    const positions = positionsOf(cid, casterName);
    positions[id] = { gx: pos.gx, gy: pos.gy };
    toDungeonOf(cid, id).emit('token:moved', { tokenId: id, gx: pos.gx, gy: pos.gy });
  }
}

/**
 * Spends one of the actor's per-turn resources, telling them why if they have none left.
 * Returns false when the action must not proceed.
 *
 * Only gates the participant whose turn it is — a reaction spent on someone else's turn goes
 * through ReactionOfferHook, which does its own check against the same budget.
 */
export function trySpendAction(cid: string, actorId: string, kind: ActionResource): boolean {
  const participant = fightOf(cid, actorId)?.findParticipant(actorId);
  if (!participant) return true; // not tracked in this encounter — don't block on missing state
  if (participant.trySpend(kind)) {
    emitResources(cid, participant);
    return true;
  }
  const sid = playerSocketIds.get(actorId);
  const label = kind === 'bonusAction' ? 'bonus action' : kind;
  if (sid) io.to(sid).emit('combat:attack:blocked', { reason: `No ${label} left this turn` });
  return false;
}

/**
 * Nearest living enemy within 30ft of `fromId` not already hit this casting — Chaos Bolt and
 * Chromatic Orb's leap target. Enemies-only pool: RAW allows any creature, but an offensive bolt
 * leaping onto an ally is vanishingly rare table behavior and not worth a mid-resolution targeting
 * prompt.
 */
function pickChainTarget(cid: string, fromId: string, visited: Set<string>, radiusFt = 30): string | undefined {
  const encounter = fightOf(cid, fromId);
  if (!encounter) return undefined;
  const positions = positionsOf(cid, fromId);
  const fromPos = positions[fromId];
  if (!fromPos) return undefined;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const p of encounter.enemies) {
    if (p.isDead() || visited.has(p.id)) continue;
    const pos = positions[p.id];
    if (!pos) continue;
    const dist = Math.max(Math.abs(pos.gx - fromPos.gx), Math.abs(pos.gy - fromPos.gy)) * 5;
    if (dist <= radiusFt && dist < bestDist) { best = p.id; bestDist = dist; }
  }
  return best;
}

// Fallback impact visual for spells that don't declare their own impactColor — keyed by damage
// type so any new damage spell gets a fitting burst for free. 'fire' reuses the flame-lick style
// built for Searing Smite; every other type just tints the default starburst.
// ponytail: one shared color/style per damage type, not a bespoke shape per element — add a new
// TokenSpecialEffect style (like 'fire') the day a specific type needs more than a recolor.
const DAMAGE_TYPE_VISUAL: Record<string, { color: string; style?: 'fire' }> = {
  fire: { color: '#ff8c1a', style: 'fire' },
  cold: { color: '#8fd9ff' },
  lightning: { color: '#7fd4ff' },
  thunder: { color: '#8f7bff' },
  radiant: { color: '#ffe066' },
  necrotic: { color: '#7a3fa0' },
  force: { color: '#c9a0ff' },
  poison: { color: '#7fbf3f' },
  acid: { color: '#9fd63a' },
  psychic: { color: '#ff5fd1' },
  bludgeoning: { color: '#a9825f' },
  piercing: { color: '#d8d8e0' },
  slashing: { color: '#e0b84a' },
};
function impactVisualFor(spellCombat: Spell['combat'], damageType: string | undefined): { color: string; style?: 'fire' } {
  if (spellCombat?.impactColor) return { color: spellCombat.impactColor, style: spellCombat.impactStyle };
  const key = damageType?.toLowerCase();
  return (key && DAMAGE_TYPE_VISUAL[key]) || { color: '#e8e8e8' };
}

/**
 * Places a hidden trap on the battlefield (Snare) instead of resolving against creatures now —
 * shared by the normal in-combat cast path and the exploration-cast path (spells tagged
 * `combat.explorationCastable`, which skip the action-economy gate entirely — see the
 * combat:spell:cast handler below). The trap sits inert until checkTrapAt (shared with
 * dungeon-authored traps) fires when something later steps on its cell.
 */
function placeTrapSpell(cid: string, char: Character, casterName: string, spell: Spell, originGx: number | undefined, originGy: number | undefined): void {
  const combat = spell.combat;
  const dungeon = dungeonOf(cid, casterName);
  if (!dungeon || originGx === undefined || originGy === undefined) {
    logDebug(`[trap] placesTrap cast blocked — dungeon=${!!dungeon} originGx=${originGx} originGy=${originGy}`);
    return;
  }
  const spellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
  const dc = 8 + (char.proficiencyBonus ?? 2) + statMod(char.stats[spellAbility]) + dcBonusFor(getStateEngine(cid), char.id);
  const entity: DungeonEntity = {
    id: randomUUID(), type: 'trap', x: originGx, y: originGy, name: spell.name,
    discovered: false, hideDC: dc, placedBy: casterName,
    trap: {
      ...(combat?.save ? { save: { ability: combat.save.ability, dc, halfOnSave: combat.save.halfOnSave } } : {}),
      effects: combat?.onHit ?? [],
      ...(combat?.trapRadiusFt ? { radiusFt: combat.trapRadiusFt } : {}),
    },
  };
  dungeon.entities = [...dungeon.entities, entity];
  void saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);
  const msg = { text: `${casterName} sets ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
  void postChat(cid, msg, [casterName]);
  console.log(`[trap] ${casterName} places ${spell.name} at (${originGx},${originGy}), DC${dc}`);
  logDebug(`[trap] ${casterName} places ${spell.name} at (${originGx},${originGy}), DC${dc}`);
}

/** Conjures a spell's `followingObject` spec at the caster's own token position (Tenser's Floating Disk) — see DungeonEntity.followsId. No-ops quietly if there's no dungeon or the caster has no placed token yet, same as placeTrapSpell. */
function placeFollowingObject(cid: string, casterId: string, casterName: string, spec: NonNullable<Spell['combat']>['followingObject']): void {
  if (!spec) return;
  const dungeon = dungeonOf(cid, casterName);
  const pos = positionsOf(cid, casterName)[casterId] ?? positionsOf(cid, casterName)[casterName];
  if (!dungeon || !pos) return;

  const entity: DungeonEntity = {
    id: randomUUID(), type: 'object', x: pos.gx, y: pos.gy, name: spec.name,
    discovered: true, followsId: casterId, leashFt: spec.leashFt,
  };
  dungeon.entities = [...dungeon.entities, entity];
  void saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);
}

/** Drops Silent Image's stationary marker at the targeted cell — a labeled 'object' entity with no followsId, so it just sits there (see the spell's own todo for what's still missing: moving it, and revealing it on inspection). */
function placeIllusionMarker(cid: string, casterName: string, spell: Spell, originGx: number, originGy: number): void {
  const dungeon = dungeonOf(cid, casterName);
  if (!dungeon) return;
  const entity: DungeonEntity = {
    id: randomUUID(), type: 'object', x: originGx, y: originGy, name: spell.name,
    discovered: true, placedBy: casterName,
  };
  dungeon.entities = [...dungeon.entities, entity];
  void saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);
}

/**
 * Lays a hazard overlay over the square area a spell was cast on (Entangle/Grease's
 * `difficultTerrain`, Fog Cloud's `obscuresArea`) — approximated as a square centered on the
 * origin cell rather than the AoE's true shape/size (the client owns the real
 * area-of-effect geometry for targeting; porting it server-side for one hazard-placement path
 * isn't worth it), erring toward slightly larger coverage rather than smaller. Cleared later by
 * pruneExpiredHazardCells (runtime.ts).
 */
function placeHazardCells(
  cid: string, originGx: number, originGy: number, sizeFt: number,
  spec: { multiplier?: number; obscures?: boolean; durationRounds: number } | undefined, fight: Encounter,
  visual?: NonNullable<Spell['combat']>['hazardVisual'],
): void {
  if (!spec) return;
  const dungeon = fightDungeon(cid, fight);
  if (!dungeon) return;
  const half = Math.floor(sizeFt / 5 / 2);
  const cx = Math.round(originGx);
  const cy = Math.round(originGy);
  const expiresOnRound = (fight.currentRound?.number ?? 1) + spec.durationRounds;
  const added: NonNullable<typeof dungeon.hazardCells> = [];
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) {
      added.push({
        gx: cx + dx, gy: cy + dy, multiplier: spec.multiplier, obscures: spec.obscures, expiresOnRound, fightId: fight.id,
        style: visual?.style, color: visual?.color,
      });
    }
  }
  dungeon.hazardCells = [...(dungeon.hazardCells ?? []), ...added];
  void saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);
}

/** Whether a straight line between two cells crosses a Heavily Obscured hazard cell (Fog Cloud) — see crossesObscuredArea. */
function isLineObscured(cid: string, viewer: string, x0: number, y0: number, x1: number, y1: number): boolean {
  const obscured = dungeonOf(cid, viewer)?.hazardCells?.filter(h => h.obscures) ?? [];
  return crossesObscuredArea(obscured, x0, y0, x1, y1);
}

// Matches the canvas's DARKVISION_THRESHOLD (client/canvas/constants.ts) — illumination at/below
// this counts as actual darkness, where seeing clearly needs darkvision (or better); merely dim
// light (above this) needs no special sense at all, per PHB.
const DARKVISION_THRESHOLD = 0.5;

/**
 * True when the target is standing somewhere dark enough that seeing it clearly needs a sense
 * that works in darkness (PHB: no light + no darkvision imposes Disadvantage on the attack roll)
 * — false if a light source reaches the target's own cell (that always mitigates it, regardless
 * of the attacker's vision) or the attacker's senses reach that far. No wall-blocked line of
 * sight for either the light radius or the sense range — same distance-only simplification the
 * other range checks in this file already make (see hasHostileWithinMeleeRange).
 */
function targetBeyondAttackerVisionInDarkness(
  cid: string, char: Character,
  attackerGx: number, attackerGy: number, targetGx: number, targetGy: number,
): boolean {
  const dungeon = dungeonOf(cid, char.name);
  if ((dungeon?.illumination ?? 1) > DARKVISION_THRESHOLD) return false;

  const positions = positionsOf(cid, char.name);
  const targetLit = (dungeon?.pointLights ?? []).some(l =>
    Math.max(Math.abs(l.gx - targetGx), Math.abs(l.gy - targetGy)) * 5 <= l.rangeFt
  ) || Object.entries(dungeon?.lightSources ?? {}).some(([key, rangeFt]) => {
    const pos = positions[key];
    return !!pos && Math.max(Math.abs(pos.gx - targetGx), Math.abs(pos.gy - targetGy)) * 5 <= rangeFt;
  });
  if (targetLit) return false;

  const distFt = Math.max(Math.abs(attackerGx - targetGx), Math.abs(attackerGy - targetGy)) * 5;
  return !getSenses(char.species).some(s => s.rangeFt >= distFt);
}

/**
 * What Command's onHit/hooks actually are depends on which one-word command was chosen at cast
 * time — the spell's own JSON only carries commandOptions (the button labels), not per-word
 * mechanics, so this is where each word's real 5.5e effect (or lack of one) lives.
 *
 * Grovel and Halt are the only two with anything mechanical behind them:
 *  - Grovel: "has the Prone condition" — a bare onHit condition, same as any other Prone effect.
 *  - Halt: "doesn't move and takes no action or Bonus Action" on its next turn — approximated as
 *    zero movement (speedModifier multiplier 0) for that turn, since there's no per-participant
 *    action-lock hook yet (Wardaway's linkedActionEconomy forces a *choice* between the two, not
 *    zero of both) — the movement half is real, the action-lock half isn't, until one gets built.
 *  - Approach/Drop/Flee, and any free-text word: RAW forced movement/disarm with no system to
 *    drive it (no AI-turn override for forced movement, no held-item tracking on creatures to
 *    force a drop) — narrative only, the caster announces it and the GM/table enforces it by hand.
 */
function commandEffectsFor(word: string | undefined): { onHit: EffectSpec[]; hooks: HookSpec[] } {
  if (word === 'Halt') {
    return {
      onHit: [],
      hooks: [{ type: 'speedModifier', multiplier: 0, duration: { until: 'rounds', rounds: 2 } }],
    };
  }
  if (word === 'Grovel' || word === undefined) {
    return { onHit: [{ type: 'condition', condition: 'Prone' }], hooks: [] };
  }
  return { onHit: [], hooks: [] };
}

/**
 * Snaps every object following tokenId to catch up whenever token:move puts them past its
 * leash — or despawns it on a jump so large it "can't keep up" (100ft, RAW's cutoff for Tenser's
 * Floating Disk). Called from the token:move handler for every mover, not just spellcasters —
 * cheap no-op scan when nothing is currently following anyone.
 */

function updateFollowingObjects(cid: string, tokenId: string, gx: number, gy: number): void {
  const dungeon = dungeonOf(cid, tokenId);
  const followers = dungeon?.entities.filter(e => e.type === 'object' && e.followsId === tokenId);
  if (!dungeon || !followers?.length) return;

  let changed = false;
  const kept = dungeon.entities.filter(e => {
    if (e.type !== 'object' || e.followsId !== tokenId) return true;
    const distFt = Math.max(Math.abs(e.x - gx), Math.abs(e.y - gy)) * 5;
    if (distFt > 100) {
      changed = true;
      const msg = { text: `${e.name} can't keep up and fades away.`, senderName: 'System', timestamp: Date.now() };
      void postChat(cid, msg, [tokenId]);
      return false;
    }
    if (distFt > (e.leashFt ?? 20)) {
      changed = true;
      e.x = gx;
      e.y = gy;
    }
    return true;
  });

  if (changed) {
    dungeon.entities = kept;
    void saveDungeon(cid, dungeon);
    broadcastDungeon(cid, dungeon);
  }
}

export async function resolvePlayerAttack(
  campaignId: string,
  { attackerId, attackerName, targetId, weapon, bonusSpell, isOffhand, actionType, useInspiration }: {
    attackerId: string; attackerName: string; targetId: string; weapon: Weapon; bonusSpell?: Spell; isOffhand?: boolean; actionType?: 'action' | 'bonusAction'; useInspiration?: boolean;
  },
): Promise<{ hit: boolean } | undefined> {
      const cid = campaignId;
      const encounter = fightOf(cid, attackerId);
      if (!encounter) return;

      const char = await getCharacter(cid, attackerId);
      const creature = encounter.findCreature(targetId);
      if (!char || !creature || creature.isDead()) return;
      const inspirationSpent = await trySpendHeroicInspiration(cid, attackerId, char, useInspiration);

      // Two-Weapon Fighting: the off-hand attack costs the bonus action instead of the action.
      // An ordinary attack costs the action; a bundled smite costs the bonus action on top.
      // Spent before ammunition is deducted so a blocked attack cannot silently eat an arrow.
      // isOffhand alone used to double as "spend bonus action" — that broke once Monk's bonus
      // punch needed a bonus-action cost WITHOUT the offhand ability-mod suppression below.
      // actionType (already on the client's targeting payload) is the real cost signal now;
      // isOffhand stays for offhandStatBonus only.
      if (!trySpendAction(cid, attackerId, actionType === 'bonusAction' ? 'bonusAction' : 'action')) return;
      if (bonusSpell && !trySpendAction(cid, attackerId, 'bonusAction')) return;

      if (weapon.ammoSlug) {
        const ammo = char.inventory?.find(i => isAmmunition(i) && i.usableBySlug === weapon.ammoSlug && i.quantity > 0);
        if (!ammo) {
          const sid = playerSocketIds.get(attackerId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No arrows left' });
          return;
        }
        const quantity = ammo.quantity - 1;
        await updateCharacter(cid, attackerId, c => ({
          ...c,
          inventory: quantity > 0
            ? (c.inventory ?? []).map(i => i.id === ammo.id ? { ...i, quantity } : i)
            : (c.inventory ?? []).filter(i => i.id !== ammo.id),
        }));
        const sid = playerSocketIds.get(attackerId);
        if (sid) io.to(sid).emit('character:inventory:remove', { itemId: ammo.id, quantity: Math.max(0, quantity) });
      }

      await breakSanctuaryOn(cid, attackerId);

      // Shillelagh — swaps Str/Dex for the caster's spellcasting ability modifier on this attack
      // and (if the spell's scaling die was resolved into the hook) the weapon's own damage die.
      const weaponOverride = getStateEngine(cid).getHooksOwnedBy(attackerId, 'weaponAttackOverride')[0] as WeaponAttackOverrideHook | undefined;
      const strMod = statMod(char.stats.str);
      const dexMod = statMod(char.stats.dex);
      const isMelee = weapon.range <= 10; // covers reach weapons (e.g. Whip, range 10) — next tier up is bows at 80+
      // Martial Arts' Dexterous Attacks: Dex-if-higher on Unarmed Strikes/Monk weapons, same as
      // Finesse — but gated on the full RAW condition (unarmored, shieldless, monk-weapons-only).
      const monkActive = monkMartialArtsActive(char);
      const useDex = !isMelee || ((weapon.isFinesse || (monkActive && isMonkWeapon(weapon))) && dexMod > strMod);
      // Dueling Fighting Style's "no other weapon" gate — a weapon (not shield/empty) in the
      // off-hand disqualifies it regardless of which hand is actually attacking.
      const offhandItem = char.inventory?.find(i => i.id === char.equipment?.offHand);
      const hasOffhandWeapon = !!offhandItem && isWeapon(offhandItem);
      const spellAbilityKey = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      // Pact of the Blade: proficient with the bonded weapon, and Charisma may stand in for Str/Dex.
      const pact = isPactWeapon(char, weapon);
      const usePactCha = pact && !weaponOverride && statMod(char.stats.cha) > (useDex ? dexMod : strMod);
      const statBonus = weaponOverride ? statMod(char.stats[spellAbilityKey]) : usePactCha ? statMod(char.stats.cha) : (useDex ? dexMod : strMod);
      const statName = weaponOverride ? (STAT_FULL[spellAbilityKey.toUpperCase()] ?? spellAbilityKey) : usePactCha ? 'Charisma (Pact of the Blade)' : (useDex ? 'Dexterity' : 'Strength');
      const charProf = char.proficiencyBonus ?? 2;
      const classWeaponProfs = effectiveWeaponProfs(char);
      const isProficient = pact || weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
      // Bless/Bane — rerolled fresh against every attack, not fixed at cast time (see RollModifierHook).
      // Bardic Inspiration's single die is unregistered the moment it's summed in (consumeOnUse).
      const rollMods = getStateEngine(cid).getHooksOwnedBy(attackerId, 'rollModifier') as RollModifierHook[];
      const toHitLines: RollModifier[] = [
        { label: weaponOverride ? `${statName} (${weaponOverride.source})` : statName, value: statBonus },
        ...(isProficient ? [{ label: 'Proficiency', value: charProf }] : []),
        ...(weapon.attackBonus ? [{ label: weapon.name, value: weapon.attackBonus }] : []),
        // Archery Fighting Style: +2 to attack rolls with ranged weapons.
        ...(char.fightingStyle === 'Archery' && !isMelee ? [{ label: 'Archery', value: 2 }] : []),
        ...rollAndConsumeRollMods(getStateEngine(cid), rollMods),
        ...bladeWardPenalty(cid, targetId),
      ];
      const attackBonus = sumModifiers(toHitLines);

      const positions = positionsOf(cid, attackerName);
      const attackerPos = positions[attackerName];
      const targetPos = positions[targetId];
      const inExtendedRange = !!(weapon.extendedRange && attackerPos && targetPos &&
        Math.max(Math.abs(targetPos.gx - attackerPos.gx), Math.abs(targetPos.gy - attackerPos.gy)) > Math.floor(weapon.range / 5));

      const engine = getStateEngine(cid);
      // Faerie Fire's outline, Guiding Bolt's guiding light — advantage on attacks against this
      // target has to be decided before the die is rolled, too early for the hook trigger chain.
      // rollD20 itself cancels advantage/disadvantage back to a flat roll if both end up present,
      // so this only needs to feed in the raw sources, not resolve them.
      const targetAdvantageGrant = engine.getHooksOwnedBy(targetId, 'grantAdvantage')[0]?.source;
      const attackerSelfAdvantage = engine.getHooksOwnedBy(attackerId, 'grantAdvantageSelf')[0]?.source;
      const attackerSelfDisadvantage = engine.getHooksOwnedBy(attackerId, 'grantDisadvantageSelf')[0]?.source;
      const obscured = !!(attackerPos && targetPos && isLineObscured(cid, attackerName, attackerPos.gx, attackerPos.gy, targetPos.gx, targetPos.gy));
      // Ranged weapon, hostile breathing down your neck — PHB Disadvantage rule, not a melee-only concern.
      const rangedThreatened = !isMelee && !!attackerPos && hasHostileWithinMeleeRange(cid, attackerId, attackerPos.gx, attackerPos.gy);
      // Can't see the target clearly — dark, no light reaching them, and no sense that works in
      // darkness reaches that far. Monster attackers aren't checked here — EnemyStatBlock carries
      // no senses data, so there's nothing to gate on (see targetBeyondAttackerVisionInDarkness).
      const inDarkness = !!attackerPos && !!targetPos && targetBeyondAttackerVisionInDarkness(cid, char, attackerPos.gx, attackerPos.gy, targetPos.gx, targetPos.gy);
      let breakdown = withModifiers(rollD20([
        ...conditionModeSources(char, 'attack'), ...targetModeSources(creature),
        inExtendedRange && dis('Long range'), obscured && dis('Obscured'), rangedThreatened && dis('Hostile within 5 ft'),
        inDarkness && dis("Can't see target"), attackerSelfDisadvantage && dis(attackerSelfDisadvantage),
        targetAdvantageGrant && adv(targetAdvantageGrant), attackerSelfAdvantage && adv(attackerSelfAdvantage),
        inspirationSpent && adv('Heroic Inspiration'),
      ], char), toHitLines);
      let roll = keptDie(breakdown);
      const atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
        attackerId, attackerName,
        targetId, targetName: creature.name,
        targetIsPlayer: false,
        sourceName: weapon.name,
        d20: roll,
        attackBonus,
        ac: creature.ac,
        total: roll + attackBonus,
        hit: resolveHit(roll, attackBonus, creature.ac),
      }));
      if (encounter.ended) return;

      // Re-derived from the context rather than the pre-hook locals — see CONTEXT MUTATION in
      // shared/types/combat-hooks.ts.
      let total = atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
      let hit = atkCtx.hit = resolveHit(atkCtx.d20, atkCtx.attackBonus, atkCtx.ac);
      let isCrit = atkCtx.d20 === 20;
      breakdown = reconcile(breakdown, atkCtx.d20, atkCtx.attackBonus);

      // Origin feat Lucky, retroactive: the miss is known now — offer a Luck Point spend to
      // reroll before damage/narration commit to it (replaces the old pre-roll HUD toggle).
      if (!hit) {
        const rerolled = await offerLuckAttackReroll(cid, attackerId, attackerName, weapon.name, creature.name, atkCtx.total, atkCtx.ac);
        if (rerolled !== null && !encounter.ended) {
          roll = atkCtx.d20 = rerolled;
          breakdown = reconcile(breakdown, rerolled, atkCtx.attackBonus);
          total = atkCtx.total = rerolled + atkCtx.attackBonus;
          hit = atkCtx.hit = resolveHit(rerolled, atkCtx.attackBonus, atkCtx.ac);
          isCrit = rerolled === 20;
        }
      }

      let damage: number | undefined;
      let damageRoll: number | undefined;
      let damageStatBonus: number | undefined;
      let bonus: { spellName: string; damageType: string | undefined; total: number } | undefined;
      if (hit) {
        // Martial Arts Die: rolled in place of the weapon's own damage on Unarmed Strikes/Monk
        // weapons while active — takes priority over the weapon's own die, but a spell effect
        // (Shillelagh via weaponOverride) still wins over both.
        const damageFormula = weaponOverride?.damageDie
          ?? (monkActive && isMonkWeapon(weapon) ? martialArtsDie(monkLevel(char)) : weapon.damage);
        // Great Weapon Fighting: reroll 1s and 2s once on two-handed/versatile melee weapons.
        const usesGwf = isMelee && char.fightingStyle === 'Great Weapon Fighting' &&
          (weapon.twoHanded || weapon.properties?.includes('versatile'));
        // Tavern Brawler: the unarmed strike's damage die can be rerolled once if it comes up 1.
        const usesTavernBrawlerReroll = weapon.id === 'unarmed-strike' && hasOriginFeat(char, 'Tavern Brawler');
        const rollDamageDie = () => usesGwf ? rollDiceRerollLow(damageFormula)
          : usesTavernBrawlerReroll ? rollDiceRerollLow(damageFormula, 1)
          : rollDice(damageFormula);
        // Savage Attacker: once per turn, roll the weapon's damage dice twice and keep the higher
        // total — capped via the attacker's Participant flag, cleared at the start of their turn.
        const attackerParticipant = encounter.findParticipant(attackerId);
        const usesSavageAttacker = hasOriginFeat(char, 'Savage Attacker') && !attackerParticipant?.savageAttackerUsed;
        // Crit: roll the (Savage-Attacker-adjusted) dice pool twice and sum — 5e doubles dice, not the flat bonus.
        const rollPool = () => usesSavageAttacker
          ? Math.max(rollDamageDie(), rollDamageDie())
          : rollDamageDie();
        const houseRules = await getHouseRules(cid);
        damageRoll = isCrit
          ? rollPool() + (houseRules.perkinsCrit ? maxDiceValue(damageFormula) : rollPool())
          : rollPool();
        if (usesSavageAttacker && attackerParticipant) attackerParticipant.savageAttackerUsed = true;
        // Two-Weapon Fighting: the off-hand attack skips the ability-mod damage bonus unless the
        // attacker has the Two-Weapon Fighting style.
        const offhandStatBonus = !isOffhand || char.fightingStyle === 'Two-Weapon Fighting';
        damageStatBonus = offhandStatBonus ? statBonus : 0;
        damage = damageRoll + damageStatBonus;

        // Divine-Smite-style bonus damage, evaluated against this actual target so appliesIf
        // (vs Fiend/Undead, ...) can gate it. Either bundled directly onto this attack (the
        // client sends both action + bonus action together for one-shot Instantaneous smites),
        // or queued earlier by a separate cast (Divine Favor/Zephyr Strike-style duration buffs).
        if (bonusSpell) {
          // ponytail: bundled smite doesn't carry a slotLevel (no upcast picker on this
          // path) or consume a tracked slot yet — falls back to the spell's own level.
          const rolled = rollApplicableDamage(bonusSpell.combat?.onHit, creature.creatureType, char.level ?? 1, bonusSpell.level);
          if (rolled) {
            bonus = { spellName: bonusSpell.name, damageType: rolled.damageType, total: rolled.total };
            damage += rolled.total;
          }
        } else {
          const bonuses = pendingWeaponBonuses.get(cid);
          const pending = bonuses?.[attackerId];
          if (pending) {
            delete bonuses![attackerId];
            toFight(encounter).emit('combat:effect:aura:end', { casterId: attackerId, casterName: attackerName });
            if (pending.impactColor) {
              toFight(encounter).emit('combat:effect:impact', { targetId, targetName: creature.name, color: pending.impactColor, style: pending.impactStyle });
            }
            // Save rolled once (if this spell has one) and reused below to gate damage,
            // secondary effects, and hooks alike — Hail of Thorns' damage is itself save-gated
            // (halfOnSave true, via each damage effect's own `gatedBySave`), unlike
            // Thunderous/Wrathful Smite where the save only gates a secondary condition and the
            // weapon-bonus damage always lands in full (no effect there sets gatedBySave).
            let saved = false;
            let dc = 0;
            if (pending.save) {
              const casterAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
              dc = 8 + charProf + statMod(char.stats[casterAbility]) + dcBonusFor(getStateEngine(cid), attackerId);
              const { saved: s, roll: saveRoll, bonus: saveBonus, total: saveTotal, breakdown: saveBreakdown } =
                await rollSavingThrow(cid, targetId, pending.save.ability, dc, effectConditions(pending.effects, pending.hooks));
              saved = s;
              console.log(`[bundled-smite] ${creature.name} save vs ${pending.spellName} DC${dc}: d20=${saveRoll}${fmtMod(saveBonus)}=${saveTotal} — ${saved ? 'SAVE' : 'FAIL'}`);
              emitCombatRoll(cid, targetId, { actorName: creature.name, label: `${pending.save.ability.toUpperCase()} save vs ${pending.spellName}`, dc, success: saved, breakdown: saveBreakdown });
            }

            const ungatedDamage = pending.effects.filter(e => e.type === 'damage' && !e.gatedBySave);
            const gatedDamage = pending.effects.filter(e => e.type === 'damage' && e.gatedBySave);
            const rolled = rollApplicableDamage(ungatedDamage, creature.creatureType, pending.casterLevel, pending.slotLevel);
            let bonusTotal = rolled?.total ?? 0;
            let bonusType = rolled?.damageType;
            if (gatedDamage.length && (!pending.save || !saved || pending.save.halfOnSave)) {
              const gatedRolled = rollApplicableDamage(gatedDamage, creature.creatureType, pending.casterLevel, pending.slotLevel);
              if (gatedRolled) {
                bonusTotal += saved ? Math.floor(gatedRolled.total / 2) : gatedRolled.total;
                bonusType ??= gatedRolled.damageType;
              }
            }
            if (rolled || gatedDamage.length) {
              bonus = { spellName: pending.spellName, damageType: bonusType, total: bonusTotal };
              damage += bonusTotal;
            }

            if (pending.splashRadiusFt && gatedDamage.length && pending.save) {
              await resolveSplashAoE(
                cid, attackerId, attackerName, pending.spellName,
                targetId, pending.splashRadiusFt, gatedDamage, pending.save.ability, pending.save.halfOnSave, dc,
                pending.casterLevel, pending.slotLevel, new Set([targetId]),
              );
            }

            // Green-Flame Blade-style splash: one nearest enemy within reach of the hit target
            // takes flat, no-save damage — no attack roll or save involved, unlike the
            // Hail-of-Thorns splash above, so it's resolved directly rather than through
            // resolveSplashAoE (which always rolls a save per creature it hits).
            if (pending.splashOnHit?.length && pending.splashRadiusFt) {
              const splashTargetId = pickChainTarget(cid, targetId, new Set([targetId]), pending.splashRadiusFt);
              const splashParticipant = splashTargetId ? encounter.findParticipant(splashTargetId) : undefined;
              if (splashParticipant && !splashParticipant.isDead()) {
                const splashType: CreatureType = splashParticipant.isPlayer ? 'Humanoid' : (splashParticipant.creature?.creatureType ?? 'Humanoid');
                const splashRolled = rollApplicableDamage(
                  pending.splashOnHit, splashType, pending.casterLevel, pending.slotLevel, undefined, pending.casterAbilityMod,
                );
                if (splashRolled) {
                  const splashCtx = await engine.trigger('beforeDamage', {
                    sourceId: attackerId, targetId: splashParticipant.id, targetName: splashParticipant.name,
                    amount: splashRolled.total, damageType: splashRolled.damageType, sourceName: pending.spellName,
                  });
                  const splashDamage = Math.max(0, splashCtx.amount);
                  if (splashParticipant.isPlayer) await applyDamageToPlayer(cid, splashParticipant, splashDamage, { sourceId: attackerId });
                  else await applyDamageToCreature(cid, splashParticipant.id, splashDamage);
                  await engine.trigger('afterDamage', splashCtx);
                  const splashMsg = {
                    text: `${pending.spellName}'s flame leaps to ${splashParticipant.name} for ${splashDamage} ${splashRolled.damageType ?? ''} damage.`,
                    senderName: 'System', timestamp: Date.now(),
                  };
                  void postChat(cid, splashMsg, [attackerId]);
                }
              }
            }

            // Secondary save-gated effects (Thunderous Smite's push+Prone, Searing Smite's
            // Burning) — same save roll as above, not re-rolled.
            if (pending.save) {
              if (!saved) {
                const gated = pending.effects.filter(e => e.type !== 'damage' && e.gatedBySave);
                for (const e of gated) {
                  if (e.type === 'condition' && e.condition) await applyCondition(cid, targetId, e.condition);
                  if ((e.type === 'push' || e.type === 'pull') && e.distance) {
                    const positions2 = positionsOf(cid, attackerName);
                    const casterPos = positions2[attackerName] ?? positions2[attackerId];
                    const targetPos2 = positions2[targetId];
                    if (casterPos && targetPos2) {
                      const dungeon = dungeonOf(cid, attackerName);
                      const occupied = new Set(
                        Object.entries(positions2).filter(([id]) => id !== targetId).map(([, p]) => `${p.gx},${p.gy}`),
                      );
                      const moved = resolveForcedMovement(
                        dungeon?.cells, occupied, targetPos2.gx, targetPos2.gy, casterPos.gx, casterPos.gy,
                        e.distance, e.type === 'pull' ? 'pull' : 'push',
                        dungeon ? closedDoorCells(dungeon, { forMovement: true }) : undefined,
                      );
                      if (moved.gx !== targetPos2.gx || moved.gy !== targetPos2.gy) {
                        positions2[targetId] = moved;
                        toDungeonOf(cid, targetId).emit('token:moved', { tokenId: targetId, gx: moved.gx, gy: moved.gy });
                      }
                    }
                  }
                }

                const gatedHooks = pending.hooks?.filter(h => h.gatedBySave);
                if (gatedHooks?.length) {
                  await registerSpellHooks(engine, gatedHooks, pending.spellName, {
                    ownerId: targetId, casterId: attackerId,
                    casterLevel: pending.casterLevel, slotLevel: pending.slotLevel,
                    currentRound: encounter.currentRound?.number ?? 1, dc,
                  });
                }
              }
            }

            // Hooks with no save gate at all (Searing Smite's Burning — the hit always starts
            // it; only its own per-turn saveToEnd, not this attack, ever ends it) register
            // regardless of pending.save above.
            const ungatedHooks = pending.hooks?.filter(h => !h.gatedBySave);
            if (ungatedHooks?.length) {
              const casterAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
              const dc = 8 + charProf + statMod(char.stats[casterAbility]) + dcBonusFor(engine, attackerId);
              await registerSpellHooks(engine, ungatedHooks, pending.spellName, {
                ownerId: targetId, casterId: attackerId,
                casterLevel: pending.casterLevel, slotLevel: pending.slotLevel,
                currentRound: encounter.currentRound?.number ?? 1, dc,
              });
            }
          }
        }

        // Sneak Attack's gate: Advantage, or a non-Incapacitated ally within 5ft of the target.
        const helpfulAllyNearTarget = !!targetPos && await hasHelpfulAllyWithinMeleeRange(cid, attackerId, targetPos.gx, targetPos.gy);
        const dmgCtx = await engine.trigger('beforeDamage', {
          sourceId: attackerId, targetId, targetName: creature.name,
          amount: damage, damageType: weaponDamageType(char, weapon), sourceName: weapon.name,
          isMelee, weaponTwoHanded: weapon.twoHanded, hasOffhandWeapon,
          attackRollMode: breakdown.mode,
          isFinesseOrRangedWeapon: weapon.isFinesse || !isMelee,
          allyAdjacentToTargetNotIncapacitated: helpfulAllyNearTarget,
        });
        damage = Math.max(0, dmgCtx.amount);
        // Hunter's Mark, Divine Favor, ... — OnHitBonusDamageHook already folded these into
        // `damage` above; itemized here too so the combat log shows them as their own line
        // instead of the total silently growing past weapon-die + stat-bonus with no explanation.
        if (dmgCtx.bonusSources?.length) {
          const hookTotal = dmgCtx.bonusSources.reduce((sum, s) => sum + s.amount, 0);
          const hookNames = dmgCtx.bonusSources.map(s => s.sourceName).join(' + ');
          bonus = bonus
            ? { spellName: `${bonus.spellName} + ${hookNames}`, damageType: bonus.damageType, total: bonus.total + hookTotal }
            : { spellName: hookNames, damageType: dmgCtx.bonusSources[0]?.damageType, total: hookTotal };
        }
        await applyDamageToCreature(cid, targetId, damage, { sourceId: attackerId, isCrit });
        await engine.trigger('afterDamage', dmgCtx);

        // Tavern Brawler: once per turn, push the target 5 feet on an Unarmed Strike hit.
        if (weapon.id === 'unarmed-strike' && hasOriginFeat(char, 'Tavern Brawler') && attackerPos && targetPos && !attackerParticipant?.tavernBrawlerPushUsed) {
          const dungeon = dungeonOf(cid, attackerName);
          const occupied = new Set(
            Object.entries(positions).filter(([id]) => id !== targetId).map(([, p]) => `${p.gx},${p.gy}`),
          );
          const moved = resolveForcedMovement(
            dungeon?.cells, occupied, targetPos.gx, targetPos.gy, attackerPos.gx, attackerPos.gy, 5, 'push',
            dungeon ? closedDoorCells(dungeon, { forMovement: true }) : undefined,
          );
          if (moved.gx !== targetPos.gx || moved.gy !== targetPos.gy) {
            positions[targetId] = moved;
            toDungeonOf(cid, targetId).emit('token:moved', { tokenId: targetId, gx: moved.gx, gy: moved.gy });
          }
          if (attackerParticipant) attackerParticipant.tavernBrawlerPushUsed = true;
        }
      }

      const atkResult = {
        attackerName,
        targetName: creature.name,
        targetId,
        weaponName: weapon.name,
        isMelee,
        d20: roll,
        breakdown,
        attackBonus: atkCtx.attackBonus,
        statName,
        total,
        ac: atkCtx.ac,
        hit,
        isCrit,
        damage,
        damageRoll,
        damageType: weaponDamageType(char, weapon),
        damageFormula: weapon.damage,
        damageStatBonus,
        bonusSpellName: bonus?.spellName,
        bonusDamage: bonus?.total,
        bonusDamageType: bonus?.damageType,
        remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
        targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
      };
      toFight(encounter).emit('combat:attack:result', atkResult);

      void (async () => {
        try {
          const config = await getConfig();
          if (!hasFeatureProvider(config, 'combatNarration')) return;
          const flavour = await generateCombatFlavour(atkResult, getFeatureProvider(config, 'combatNarration'));
          if (!flavour) return;
          const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
          await postChat(cid, msg, [attackerId]);
        } catch (err) { logError('index:combatFlavour', err); }
      })();
      return { hit };
}

export async function resolvePlayerSpellAttack(
  campaignId: string,
  { casterId, casterName, targetIds, spell, slotLevel, chosenDamageType }: {
    casterId: string; casterName: string; targetIds: string[]; spell: Spell; slotLevel: number; chosenDamageType?: string;
  },
): Promise<{ hit: boolean } | undefined> {
      const cid = campaignId;
      const encounter = fightOf(cid, casterId);
      if (!encounter || !targetIds.length) return;

      const char = await getCharacter(cid, casterId);
      if (!char) return;
      if (targetIds.every(id => encounter.findCreature(id)?.isDead())) return;

      // Redirecting an already-sustained spell (Witch Bolt) is free — no slot, and costs a Bonus
      // Action per RAW rather than the spell's normal casting-time cost (which paid for the
      // original cast already). Reaction-cast spells are never initiated from here — they are
      // offered mid-resolution by ReactionOfferHook, which spends the reaction itself.
      const free = await isConcentratingOn(cid, casterId, spell.name);
      const castCost = free ? 'bonusAction' : (spell.combat?.actionCostOverride ?? actionCostFromCastingTime(spell.castingTime));
      if (castCost && castCost !== 'reaction' && !trySpendAction(cid, casterId, castCost)) return;

      if (!free && !(await trySpendSpellSlot(cid, casterId, char, slotLevel, spell.name))) {
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
        return;
      }

      const spellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      const abilityMod = statMod(char.stats[spellAbility]);
      const charProf = char.proficiencyBonus ?? 2;
      // Bless/Bane — rerolled fresh against every attack, not fixed at cast time (see RollModifierHook).
      // Caster-side, so the same for every target in a chain (Chaos Bolt/Chromatic Orb); Blade
      // Ward is target-side instead and gets added per-target below, inside the loop.
      const rollMods = getStateEngine(cid).getHooksOwnedBy(casterId, 'rollModifier') as RollModifierHook[];
      const baseToHitLines: RollModifier[] = [
        { label: STAT_FULL[spellAbility.toUpperCase()] ?? spellAbility, value: abilityMod },
        { label: 'Proficiency', value: charProf },
        ...rollAndConsumeRollMods(getStateEngine(cid), rollMods),
      ];
      const dc = 8 + charProf + abilityMod + dcBonusFor(getStateEngine(cid), casterId);

      const engine = getStateEngine(cid);
      await engine.trigger('beforeSpellCast', {
        casterId, casterName, spellName: spell.name,
        spellLevel: spell.level, slotLevel, targetIds,
      });

      // ponytail: Chaos Bolt/Chromatic Orb's leap is hardcoded by spell name rather than a
      // generic chain-effect schema field — generalize if a third chaining spell shows up.
      const chainable = spell.name === 'Chaos Bolt' || spell.name === 'Chromatic Orb';
      const chainCap = spell.name === 'Chromatic Orb' ? Math.max(0, slotLevel - 1) : 8; // Chaos Bolt has no RAW cap, safety-capped
      const chainVisited = new Set(targetIds);
      const primaryEffect = spell.combat?.onHit?.find(e => e.type === 'damage');

      const queue = [...targetIds];
      const hitTargetIds: string[] = [];
      let chainJumps = 0;
      let attackIndex = 0;
      let first = true;
      while (queue.length) {
        const targetId = queue.shift()!;
        if (!first) await sleep(500);
        first = false;
        if (encounter.ended) return;

        const creature = encounter.findCreature(targetId);
        if (!creature || creature.isDead()) continue;
        attackIndex++;
        const toHitLines = [...baseToHitLines, ...bladeWardPenalty(cid, targetId)];
        const attackBonus = sumModifiers(toHitLines);

        // Redirecting an already-sustained spell (Witch Bolt) auto-hits, no roll — only the
        // initial slotted cast is a real attack roll that can miss.
        let roll = 0;
        let breakdown: RollBreakdown | undefined;
        let atkCtx: AttackContext;
        let total: number;
        let hit: boolean;
        if (free) {
          atkCtx = {
            attackerId: casterId, attackerName: casterName,
            targetId, targetName: creature.name, targetIsPlayer: false,
            sourceName: spell.name, d20: 0, attackBonus, ac: creature.ac,
            total: attackBonus, hit: true,
          };
          total = attackBonus;
          hit = true;
        } else {
          const targetAdvantageGrant = engine.getHooksOwnedBy(targetId, 'grantAdvantage')[0]?.source;
          // Innate Sorcery registers narrower ('grantAdvantageSelfSpellOnly') so it never also
          // grants advantage on this caster's weapon attacks — see combat:attack's own
          // grantAdvantageSelf-only check, which deliberately does NOT read this narrower kind.
          const casterSelfAdvantage = [...engine.getHooksOwnedBy(casterId, 'grantAdvantageSelf'), ...engine.getHooksOwnedBy(casterId, 'grantAdvantageSelfSpellOnly')][0]?.source;
          const positions = positionsOf(cid, casterName);
          const casterPos = positions[casterName] ?? positions[casterId];
          const targetPos = positions[targetId];
          const obscured = !!(casterPos && targetPos && isLineObscured(cid, casterName, casterPos.gx, casterPos.gy, targetPos.gx, targetPos.gy));
          breakdown = withModifiers(rollD20([
            ...conditionModeSources(char, 'attack'), ...targetModeSources(creature), obscured && dis('Obscured'),
            targetAdvantageGrant && adv(targetAdvantageGrant), casterSelfAdvantage && adv(casterSelfAdvantage),
          ], char), toHitLines);
          roll = keptDie(breakdown);
          atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
            attackerId: casterId, attackerName: casterName,
            targetId, targetName: creature.name,
            targetIsPlayer: false,
            sourceName: spell.name,
            d20: roll,
            attackBonus,
            ac: creature.ac,
            total: roll + attackBonus,
            hit: resolveHit(roll, attackBonus, creature.ac),
          }));
          if (encounter.ended) return;

          total = atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
          hit = atkCtx.hit = resolveHit(atkCtx.d20, atkCtx.attackBonus, atkCtx.ac);
          breakdown = reconcile(breakdown, atkCtx.d20, atkCtx.attackBonus);
        }

        const isCrit = atkCtx.d20 === 20;
        const rollSpellDamage = () => chainable && primaryEffect
          ? rollChainableDamage(primaryEffect, char.level ?? 1, slotLevel, { deriveTypeFromRoll: spell.name === 'Chaos Bolt', chosenDamageType })
          : rollApplicableDamage(spell.combat?.onHit, creature.creatureType, char.level ?? 1, slotLevel, chosenDamageType, abilityMod);
        let rolledDamage = rollSpellDamage();
        if (isCrit && rolledDamage) {
          if ((await getHouseRules(cid)).perkinsCrit) {
            const bonus = maxDiceValue(rolledDamage.formula);
            rolledDamage = { ...rolledDamage, total: rolledDamage.total + bonus, formula: `${rolledDamage.formula} + ${bonus} (crit)` };
          } else {
            // Crit: roll the spell's damage dice a second time and sum — 5e doubles dice, not the flat total.
            const second = rollSpellDamage();
            if (second) rolledDamage = { ...rolledDamage, total: rolledDamage.total + second.total, formula: `${rolledDamage.formula} + ${second.formula}` };
          }
        }

        let damage: number | undefined;
        let damageRoll: number | undefined;
        let bonus: { spellName: string; damageType: string | undefined; total: number } | undefined;
        if (hit && rolledDamage) {
          damageRoll = rolledDamage.total;
          const dmgCtx = await engine.trigger('beforeDamage', {
            sourceId: casterId, targetId, targetName: creature.name,
            amount: damageRoll, // no spellcasting-mod bonus on spell damage, per 5e rules
            damageType: rolledDamage.damageType, sourceName: spell.name,
          });
          damage = Math.max(0, dmgCtx.amount);
          // Hex, Hunter's Mark redirected onto a spell-attack cast, ... — OnHitBonusDamageHook
          // already folded these into `damage` above; itemized here too so the combat log shows
          // them as their own line instead of the total silently growing with no explanation,
          // same treatment combat:attack's weapon-hit path already gets.
          if (dmgCtx.bonusSources?.length) {
            const hookTotal = dmgCtx.bonusSources.reduce((sum, s) => sum + s.amount, 0);
            const hookNames = dmgCtx.bonusSources.map(s => s.sourceName).join(' + ');
            bonus = { spellName: hookNames, damageType: dmgCtx.bonusSources[0]?.damageType, total: hookTotal };
          }
          await applyDamageToCreature(cid, targetId, damage, { sourceId: casterId, isCrit });
          await engine.trigger('afterDamage', dmgCtx);

          if (chainable && chainJumps < chainCap && 'matchedDie' in rolledDamage && rolledDamage.matchedDie) {
            const next = pickChainTarget(cid, targetId, chainVisited);
            if (next) { chainVisited.add(next); chainJumps++; queue.push(next); }
          }
        }

        if (hit) {
          hitTargetIds.push(targetId);
          await registerSpellHooks(engine, spell.combat?.hooks ?? [], spell.name, {
            ownerId: targetId, casterId, casterLevel: char.level ?? 1, slotLevel,
            currentRound: encounter.currentRound?.number ?? 1,
          });

          // Thorn Whip's pull — same forced-movement pathway Tavern Brawler's shove uses above,
          // generalized to any onHit push/pull effect on an attack-resolution spell.
          const forcedMove = (spell.combat?.onHit ?? []).find(e => e.type === 'push' || e.type === 'pull');
          if (forcedMove?.distance) {
            const positions2 = positionsOf(cid, casterName);
            const casterPos2 = positions2[casterName] ?? positions2[casterId];
            const targetPos2 = positions2[targetId];
            if (casterPos2 && targetPos2) {
              const dungeon2 = dungeonOf(cid, casterName);
              const occupied2 = new Set(
                Object.entries(positions2).filter(([id]) => id !== targetId).map(([, p]) => `${p.gx},${p.gy}`),
              );
              const moved2 = resolveForcedMovement(
                dungeon2?.cells, occupied2, targetPos2.gx, targetPos2.gy, casterPos2.gx, casterPos2.gy,
                forcedMove.distance, forcedMove.type === 'pull' ? 'pull' : 'push',
                dungeon2 ? closedDoorCells(dungeon2, { forMovement: true }) : undefined,
              );
              if (moved2.gx !== targetPos2.gx || moved2.gy !== targetPos2.gy) {
                positions2[targetId] = moved2;
                toDungeonOf(cid, targetId).emit('token:moved', { tokenId: targetId, gx: moved2.gx, gy: moved2.gy });
              }
            }
          }
        }

        // Ice Knife's shape: "hit or miss, the shard explodes" — a save-based AoE burst runs
        // unconditionally alongside the attack roll above, not gated by whether it hit.
        if (spell.combat?.onSave?.length && spell.combat.save) {
          await resolveSplashAoE(
            cid, casterId, casterName, spell.name,
            targetId, spell.combat.splashRadiusFt ?? 0, spell.combat.onSave,
            spell.combat.save.ability, spell.combat.save.halfOnSave, dc,
            char.level ?? 1, slotLevel,
          );
        }

        const atkResult: SpellAttackResult = {
          attackerName: casterName,
          targetName: creature.name,
          targetId,
          spellName: spell.name,
          d20: roll,
          breakdown,
          attackBonus,
          statName: 'Spellcasting',
          total,
          ac: atkCtx.ac,
          hit,
          isCrit,
          damage,
          damageRoll,
          damageType: rolledDamage?.damageType,
          damageFormula: rolledDamage?.formula,
          bonusSpellName: bonus?.spellName,
          bonusDamage: bonus?.total,
          bonusDamageType: bonus?.damageType,
          remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
          targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
        };
        toFight(encounter).emit('combat:spell:attack:result', atkResult);

        if (hit) {
          const visual = impactVisualFor(spell.combat, rolledDamage?.damageType);
          toFight(encounter).emit('combat:effect:impact', { targetId, targetName: creature.name, color: visual.color, style: visual.style });
        }

        // Only narrate the first attack roll of a multi-roll cast — a wall of AI flavour text
        // for every dart/blast/leap isn't worth the extra provider calls.
        if (attackIndex === 1) {
          void (async () => {
            try {
              const config = await getConfig();
              if (!hasFeatureProvider(config, 'combatNarration')) return;
              const flavour = await generateCombatFlavour(atkResult, getFeatureProvider(config, 'combatNarration'));
              if (!flavour) return;
              const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
              await postChat(cid, msg, [casterId]);
            } catch (err) { logError('index:combatFlavour', err); }
          })();
        }
      }

      if (requiresConcentration(spell)) {
        await startConcentrating(cid, casterId, spell.name, hitTargetIds);
      }
      await engine.trigger('afterSpellCast', {
        casterId, casterName, spellName: spell.name,
        spellLevel: spell.level, slotLevel, targetIds,
      });
      return { hit: hitTargetIds.length > 0 };
}

export function registerCombatHandlers(ctx: JoinContext): void {
  const { socket, campaignId, charId } = ctx;

  socket.on('token:move', ({ tokenId, gx, gy }) => {
    // The mover's client already drew the token at gx/gy — every refusal below sends it back where
    // the server still has it, or that client shows it somewhere nobody else does.
    const refuse = () => {
      const at = positionsOf(campaignId, tokenId)[tokenId];
      if (at) socket.emit('token:moved', { tokenId, ...at });
    };
    void (async () => {
      if (!(await canMove(campaignId, tokenId))) return refuse();
      // A fight still being set up (sides, initiative — no turn order yet) holds everyone in it
      // where aggro caught them; the loading screen is already up (dungeon/runtime.ts's startDungeonCombat).
      const settingUp = fightOf(campaignId, tokenId);
      if (settingUp && !settingUp.turnOrder.length) return refuse();

      // Moves happen on the map the token is standing in — a player in a different dungeon, or out
      // in the open world, has no position here to move.
      const dungeon = dungeonOf(campaignId, tokenId);
      if (!dungeon) return;
      const positions = dungeon.positions ??= {};
      const origin = positions[tokenId];

      // Backstop for the client's own wall-aware drop gating — reject a destination no walkable
      // route reaches from the token's last known cell (or, with no known cell yet, that isn't
      // floor at all), rather than trusting whatever gx/gy the socket message carries. A shut
      // door blocks a route the same as a wall.
      const cells = dungeon.cells;
      if (cells) {
        const doorBlocked = closedDoorCells(dungeon, { forMovement: true });
        const blocked = origin
          ? !findPath(cells, origin.gx, origin.gy, gx, gy, undefined, doorBlocked)
          : cells[gy]?.[gx] !== 1 || doorBlocked?.has(`${gx},${gy}`);
        if (blocked) return refuse();

        // A player can't drag their own token to a tile outside their own line of sight — a
        // GM-dragged creature/ally isn't gated (the GM already sees the whole map).
        if (connected.has(tokenId) && origin) {
          const sightBlocked = closedDoorCells(dungeon);
          const dist = Math.max(Math.abs(gx - origin.gx), Math.abs(gy - origin.gy));
          const visible = dist <= PLAYER_SIGHT_RADIUS && hasLineOfSight(cells, origin.gx, origin.gy, gx, gy, sightBlocked);
          if (!visible) return refuse();
        }
      }

      positions[tokenId] = { gx, gy };
      toDungeon(campaignId, dungeon.id).except(socket.id).emit('token:moved', { tokenId, gx, gy });
      updateFollowingObjects(campaignId, tokenId, gx, gy);
      if (origin) void checkMovementTriggers(campaignId, tokenId, origin.gx, origin.gy, gx, gy);

      if (connected.has(tokenId)) {
        void checkDungeonProximity(campaignId, gx, gy, tokenId);
      } else {
        // GM-dragged enemy/ally token — the AI's own movement loop checks traps step-by-step as
        // it walks, but a manual drag jumps straight to the destination with no loop to hook, so
        // it needs its own check here. No-ops safely if tokenId isn't a live participant.
        const name = fightOf(campaignId, tokenId)?.findParticipant(tokenId)?.name ?? tokenId;
        void checkTrapAt(campaignId, gx, gy, tokenId, name, false);
      }
    })();
  });

  socket.on('door:toggle', ({ doorId, characterName }) => {
    void toggleDoor(campaignId, doorId, characterName);
  });

  socket.on('stairs:use', ({ stairsId, characterName }) => {
    void useStairs(campaignId, stairsId, characterName);
  });

  // Manual GM-driven condition control — traps, cures, anything outside the spell-save path
  // that already applies conditions on a failed save. Works on players and creatures, in or
  // out of combat (see applyCondition/clearCondition in runtime.ts for target resolution).
  socket.on('combat:condition:add', ({ targetId, name }) => {
    void applyCondition(campaignId, targetId, name);
  });

  socket.on('combat:condition:remove', ({ targetId, name }) => {
    void clearCondition(campaignId, targetId, name);
  });

  // Player-initiated escape attempt (Ensnaring Strike/Entangle's "make a Strength (Athletics)
  // check to escape") — spends the actor's own action, unlike saveToEnd's automatic per-turn
  // reroll. targetId is always the escaping creature itself; RAW also lets a creature within
  // reach attempt it on someone else's behalf, not modeled here (no reach/adjacency check exists
  // for a non-attack action yet).
  socket.on('combat:condition:escape', ({ targetId, name }) => {
    void (async () => {
      const cid = campaignId;
      if (!fightOf(cid, targetId)) return;

      const engine = getStateEngine(cid);
      const hook = engine.getHooksOwnedBy(targetId, 'recurringDamage')
        .find((h): h is RecurringDamageHook => h instanceof RecurringDamageHook && h.conditionName === name && !!h.escapeSkillCheck);
      if (!hook?.escapeSkillCheck) return;
      if (!trySpendAction(cid, targetId, 'action')) return;

      const result = await hook.attemptEscape(engine);
      if (!result) return;

      const participant = fightOf(cid, targetId)?.findParticipant(targetId);
      const targetName = participant?.name ?? targetId;
      console.log(`[escape] ${targetName} attempts ${hook.escapeSkillCheck} vs DC${result.dc}: d20+${result.bonus}=${result.total} — ${result.succeeded ? 'FREE' : 'STUCK'}`);
      const msg = {
        text: `${targetName} attempts to escape (${hook.escapeSkillCheck} ${fmtMod(result.bonus)}, DC${result.dc}): ${result.total} — ${result.succeeded ? 'breaks free!' : 'still stuck.'}`,
        senderName: 'System', timestamp: Date.now(), breakdown: result.breakdown,
      };
      void postChat(cid, msg, [targetId]);
      toFightOf(cid, targetId).emit('combat:condition:escape:result', {
        targetId, targetName, name, skill: hook.escapeSkillCheck,
        roll: result.roll, bonus: result.bonus, total: result.total, dc: result.dc, succeeded: result.succeeded, breakdown: result.breakdown,
      });
      emitCombatRoll(cid, targetId, { actorName: targetName, label: `${hook.escapeSkillCheck} to escape ${name}`, dc: result.dc, success: result.succeeded, breakdown: result.breakdown });
    })();
  });

  // Elevation tracker — a token/player's height off the ground (Feather Fall, falling damage).
  // No permission gate on who can set whose: GM narration ("you fall") and a player's own
  // Jump/climb both need to move it, same trust model as token:move.
  socket.on('combat:elevation:set', ({ targetId, elevationFt }) => {
    if (!fightOf(campaignId, targetId)) return;
    void applyElevationChange(campaignId, targetId, elevationFt);
  });

  // Client owns movement math; this mirror exists only so a refresh mid-turn can restore it.
  socket.on('combat:movement:sync', ft => {
    const me = fightOf(campaignId, charId)?.findParticipant(charId);
    if (me && me.id === fightOf(campaignId, charId)?.currentActor?.id && Number.isFinite(ft)) me.movementRemainingFt = Math.max(0, ft);
  });

  // Disengage — makes this actor's movement not provoke Opportunity Attacks for the rest of
  // their turn (checkOpportunityAttacks reads Participant.disengaging directly, no hook needed).
  socket.on('combat:disengage', ({ actorId }) => {
    const participant = fightOf(campaignId, actorId)?.findParticipant(actorId);
    if (participant) participant.disengaging = true;
  });

  // Dash/Dodge/Disengage/Hide — CombatDock's handleStandardAction marks its own action pip spent
  // immediately for every one of these (all four cost the same action), but that's local-only
  // unless this also spends the action here: the server is the resource authority (see
  // emitResources), and the next thing that queries it (e.g. a bonus-action offhand attack) would
  // otherwise report the action as still available and stomp the client's spend, making it look
  // like it "returned". Disengage/Dash additionally dispatch their own follow-up event for the
  // side effect that's actually theirs (disengaging flag / bonus movement) — this only owns the
  // shared action spend.
  socket.on('combat:standardAction:used', ({ actorId, key, effect }) => {
    if (!trySpendAction(campaignId, actorId, 'action')) return;
    if (key === 'dash') {
      void getCharacter(campaignId, actorId).then(char => socket.emit('movement:granted', { ft: char?.speed ?? 30 }));
      return;
    }
    if (!effect) return;
    const participant = fightOf(campaignId, actorId)?.findParticipant(actorId);
    if (!participant || participant.activeEffects.includes(effect)) return;
    participant.activeEffects.push(effect);
    emitResources(campaignId, participant);
  });

  // Illusion detection (Disguise Self) — works with or without active combat, same as casting
  // the spell itself does. Results go only to the investigator's own socket: RAW's "you see
  // through it" is knowledge specific to them, not a public reveal to the whole table.
  socket.on('combat:illusion:investigate', ({ targetId, investigatorId }) => {
    void (async () => {
      const cid = campaignId;
      const tags = await investigateIllusion(cid, targetId, investigatorId);
      if (!tags.length) return;
      const targetName = fightOf(cid, targetId)?.findParticipant(targetId)?.name
        ?? (await getCharacter(cid, targetId))?.name ?? targetId;
      const sid = playerSocketIds.get(investigatorId);
      if (sid) io.to(sid).emit('combat:illusion:investigate:result', { targetId, targetName, tags });
    })();
  });

  socket.on('combat:initiative:roll', (entry: TurnOrderEntry) => {
    const cid = campaignId;
    // The fight this entry's owner belongs to (their pending claim, if they haven't rolled yet).
    const encounter = fightOf(cid, entry.id) ?? fightOf(cid, entry.name);
    if (!encounter) return;

    let participant = encounter.findParticipant(entry.id);
    if (!participant) {
      encounter.expectedParticipantCount++;
      participant = new Participant({
        id: entry.id,
        name: entry.name,
        initiative: entry.initiative,
        isPlayer: entry.isPlayer,
      });
    } else {
      participant.initiative = entry.initiative;
    }

    encounter.addToTurnOrder(participant);
    toFight(encounter).emit('combat:initiative', entry);
    tryBeginCombat(cid, encounter);
    void saveEncounter(cid, encounter);
  });

  socket.on('combat:attack', (payload: { attackerId: string; attackerName: string; targetId: string; weapon: Weapon; bonusSpell?: Spell; isOffhand?: boolean; actionType?: 'action' | 'bonusAction'; useInspiration?: boolean }) => {
    void resolvePlayerAttack(campaignId, payload);
  });

  socket.on('character:familiar:delete', ({ characterId, name }) => {
    void (async () => {
      if (typeof name !== 'string') return;
      const key = name.toLowerCase();
      const updated = await updateCharacter(campaignId, characterId, c => ({ ...c, familiars: (c.familiars ?? []).filter(f => f.name.toLowerCase() !== key) }));
      const sid = playerSocketIds.get(characterId);
      if (sid && updated) io.to(sid).emit('character:familiars:update', { characterId, familiars: updated.familiars ?? [] });
    })();
  });

  // Pact of the Blade: conjure a pact weapon (or bond a carried magic one) into the main hand —
  // a Bonus Action mid-fight, free outside one. The old conjured weapon vanishes; a bonded magic
  // weapon just stops being the pact weapon. ponytail: RAW also ends the bond after a minute more
  // than 5 ft from the weapon, or on death — neither tracked; re-bonding is the only way it ends.
  socket.on('combat:pact:bond', ({ characterId, weaponId, itemId, damageType }) => {
    void (async () => {
      const cid = campaignId;
      const char = await getCharacter(cid, characterId);
      if (!char?.invocations?.includes('Pact of the Blade')) return;
      if (damageType && !(PACT_WEAPON_DAMAGE_TYPES as readonly string[]).includes(damageType)) return;
      const template = weaponId ? PACT_WEAPON_CHOICES.find(w => w.id === weaponId) : undefined;
      const carried = itemId ? char.inventory?.find(i => i.id === itemId) : undefined;
      // RAW bonds by touch only with a magic weapon; an attack bonus is this app's only magic marker.
      const bondable = carried && isWeapon(carried) && carried.range <= 10 && (carried.attackBonus ?? 0) > 0 ? carried : undefined;
      const weapon = template ? { ...template, id: randomUUID(), name: `Pact ${template.name}`, type: 'weapon' as const } : bondable;
      if (!weapon) return;
      if (fightOf(cid, characterId) && !trySpendAction(cid, characterId, 'bonusAction')) return;

      const dropId = char.pactWeapon?.conjured && char.pactWeapon.itemId !== weapon.id ? char.pactWeapon.itemId : undefined;
      const pactWeapon = { itemId: weapon.id, conjured: !!template, ...(damageType ? { damageType } : {}) };
      const prevMain = char.inventory?.find(i => i.id === char.equipment?.mainHand);
      const equipment = { ...char.equipment, mainHand: weapon.id };
      // Two-handed takes the off hand too; freeing it from a two-hander (or the vanished weapon) empties it.
      if (weapon.twoHanded) equipment.offHand = weapon.id;
      else if (equipment.offHand === dropId || (prevMain && isWeapon(prevMain) && prevMain.twoHanded && equipment.offHand === prevMain.id)) delete equipment.offHand;
      await updateCharacter(cid, characterId, c => ({
        ...c,
        inventory: [...(c.inventory ?? []).filter(i => i.id !== dropId), ...(template ? [weapon] : [])],
        equipment,
        pactWeapon,
      }));

      const sid = playerSocketIds.get(characterId);
      if (sid && dropId) io.to(sid).emit('character:inventory:remove', { itemId: dropId, quantity: 0 });
      if (sid && template) io.to(sid).emit('character:inventory:add', [weapon]);
      for (const slot of ['mainHand', 'offHand'] as const) {
        io.to(campaignRoom(cid)).emit('character:equipment:update', { characterId, slot, itemId: equipment[slot] ?? null });
      }
      io.to(campaignRoom(cid)).emit('character:pactWeapon:update', { characterId, pactWeapon });
      const verb = template ? 'conjures' : 'bonds with';
      void postChat(cid, { text: `${char.name} ${verb} ${weapon.name}${damageType ? ` (${damageType})` : ''}.`, senderName: 'System', timestamp: Date.now() }, [characterId]);
    })();
  });

  // Pact of the Chain: forgo your attack (the Attack action, one attack at this level) so your
  // familiar makes one attack with its Reaction. It must already be within 5 ft of the target.
  socket.on('combat:familiar:attack', ({ attackerId, targetId }) => {
    void (async () => {
      const cid = campaignId;
      const encounter = fightOf(cid, attackerId);
      const char = await getCharacter(cid, attackerId);
      if (!encounter || !char?.invocations?.includes('Pact of the Chain')) return;
      const block = (reason: string) => {
        const sid = playerSocketIds.get(attackerId);
        if (sid) io.to(sid).emit('combat:attack:blocked', { reason });
      };
      const familiar = encounter.turnOrder.find(p => p.ownerId === attackerId && !p.isDead() && p.creature?.reactionAttack);
      const atk = familiar?.creature?.reactionAttack;
      const target = encounter.findParticipant(targetId);
      if (!familiar?.creature || !atk) return block('No familiar with an attack in this fight');
      if (!target || target.isDead()) return;
      const positions = positionsOf(cid, attackerId);
      const fpos = positions[familiar.id];
      const tpos = positions[target.isPlayer ? target.name : target.id];
      if (!fpos || !tpos || Math.max(Math.abs(fpos.gx - tpos.gx), Math.abs(fpos.gy - tpos.gy)) > 1) {
        return block(`${familiar.name} must be within 5 ft of ${target.name}`);
      }
      if (!familiar.hasResource('reaction')) return block(`${familiar.name} has already used its Reaction`);
      if (!trySpendAction(cid, attackerId, 'action')) return;
      familiar.trySpend('reaction');
      emitResources(cid, familiar);
      await resolveCreatureAttack(cid, familiar, familiar.creature, atk, target, positions, tpos);
    })();
  });

  // Spell attack (e.g. Fire Bolt, or Jim's Magic Missile's 3 darts) — mirrors combat:attack but
  // uses the caster's spellcasting modifier for the attack roll and adds no stat mod to damage.
  // One attack roll per entry in targetIds — most spells send a single entry (spellTargetCount
  // defaults to {min:1,max:1}), darts/blasts send one per accumulated target, and Chaos
  // Bolt/Chromatic Orb's dice-triggered leap pushes extra entries onto the queue mid-resolution.
  socket.on('combat:spell:attack', (payload: { casterId: string; casterName: string; targetIds: string[]; spell: Spell; slotLevel: number; chosenDamageType?: string }) => {
    void resolvePlayerSpellAttack(campaignId, payload);
  });

  // Save-based spell (single-target or AoE) — computes the DC once, then rolls each
  // affected target's save mechanically and applies damage/conditions behind the curtain.
  socket.on('combat:spell:cast', ({ casterId, casterName, spell, slotLevel, targetIds, chosenDamageType, chosenCommand, chosenSkill, chosenFamiliar, originGx, originGy }) => {
    void (async () => {
      const cid = campaignId;
      const familiar = sanitizeFamiliar(chosenFamiliar);

      // Journal-only spells (Ceremony) never resolve mechanically and can't be cast while combat
      // is active — no action, no attack/save, just a slot spend and a journal/chat line.
      if (spell.combat?.journalOnly) {
        if (fightOf(cid, casterId)) {
          const sid = playerSocketIds.get(casterId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: `${spell.name} can't be cast in combat` });
          return;
        }
        const char = await getCharacter(cid, casterId);
        if (!char) return;
        if (!(await trySpendSpellSlot(cid, casterId, char, slotLevel, spell.name))) {
          const sid = playerSocketIds.get(casterId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
          return;
        }
        const msg = { text: `${casterName} performs the rite of ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void postChat(cid, msg, [casterId]);
        return;
      }

      // Exploration-castable spells (combat.explorationCastable) skip the whole action-economy/
      // encounter gate outside combat: same spell slot spend, no action, no turn. Cast during an
      // active fight, they fall through to the normal gated path below instead. Two shapes: traps
      // (Snare, Alarm) place on the battlefield; everything else (Detect Magic, Comprehend
      // Languages, ...) has no mechanical resolution of its own — just spend the slot and
      // announce so the GM can narrate what it senses/does.
      if (spell.combat?.explorationCastable && !fightOf(cid, casterId)) {
        const char = await getCharacter(cid, casterId);
        if (!char) return;
        if (!(await trySpendSpellSlot(cid, casterId, char, slotLevel, spell.name))) {
          const sid = playerSocketIds.get(casterId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
          return;
        }
        if (spell.combat.placesTrap) {
          placeTrapSpell(cid, char, casterName, spell, originGx, originGy);
          return;
        }
        if (spell.combat.grantsItem) await grantItem(cid, casterId, spell.combat.grantsItem);
        if (spell.combat.grantsCompanion) {
          await grantCompanion(cid, casterId, casterName, companionFor(char, spell, familiar));
          await rememberFamiliar(cid, casterId, familiar);
        }
        if (spell.combat.followingObject) placeFollowingObject(cid, casterId, casterName, spell.combat.followingObject);
        if (spell.combat.hooks?.length) {
          // Self-only (Disguise Self) — nothing in this exploration-cast branch targets anyone
          // else, unlike the combat-gated paths below.
          const abilityMod = statMod(char.stats[CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int']);
          await registerSpellHooks(getStateEngine(cid), spell.combat.hooks, spell.name, {
            ownerId: casterId, casterId, casterLevel: char.level ?? 1, slotLevel,
            currentRound: 1,
            dc: 8 + (char.proficiencyBonus ?? 2) + abilityMod + dcBonusFor(getStateEngine(cid), casterId),
            currentWorldTimeSecs: await getWorldTimeSecs(cid),
          });
        }
        const msg = { text: `${casterName} casts ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void postChat(cid, msg, [casterId]);
        return;
      }

      // Combat casting — resolved within the caster's own fight.
      const encounter = fightOf(cid, casterId);
      if (!encounter) return;

      const char = await getCharacter(cid, casterId);
      if (!char) return;

      // Dragonborn Breath Weapon (breathWeaponSpell): rebuilt from the saved ancestry so the
      // client's damage/area can't be spoofed — only the cone/line pick comes from the payload.
      // Spends RESOURCE_DEFS.breathWeapon instead of a slot, checked before the action is spent.
      const isBreath = spell.name === 'Breath Weapon';
      let breathUses: Record<string, number> | undefined;
      if (isBreath) {
        const rebuilt = breathWeaponSpell(char, spell.combat?.area?.shape === 'line' ? 'line' : 'cone');
        breathUses = rebuilt ? trySpendResource(char, 'breathWeapon') : undefined;
        if (!rebuilt || !breathUses) {
          const sid = playerSocketIds.get(casterId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No uses of Breath Weapon left' });
          return;
        }
        spell = rebuilt;
      }
      // Armor of Shadows: the free Mage Armor is on yourself only.
      if (invocationSpell(char, spell.name)?.selfOnly) targetIds = [casterId];

      // Longer casting times (Find Familiar's 1 hour, Snare's 1 minute) cost a full action mid-fight,
      // same as the client's spellActionCost — Pact of the Chain's "cast it as a Magic action" too.
      const castCost = spell.combat?.actionCostOverride ?? actionCostFromCastingTime(spell.castingTime) ?? 'action';
      if (castCost !== 'reaction' && !trySpendAction(cid, casterId, castCost)) return;

      if (breathUses) {
        const nextResourceUses = breathUses;
        await updateCharacter(cid, casterId, fresh => ({ ...fresh, resourceUses: nextResourceUses }));
        io.to(campaignRoom(cid)).emit('combat:player:featureResources', { characterId: casterId, resourceUses: nextResourceUses });
      }

      // Redirecting an already-sustained spell (Hunter's Mark, Witch Bolt) is free — no slot, per
      // RAW — checked first so it wins over Favored Enemy below: retargeting a mark you're
      // already concentrating on costs neither a slot nor a Favored Enemy use.
      const alreadySustaining = await isConcentratingOn(cid, casterId, spell.name);

      // Ranger's Favored Enemy: Hunter's Mark twice per Long Rest with no slot spent, per 2024
      // PHB — the resource is spent here instead of the slot below, same shape as Redirecting an
      // already-sustained spell being free, just costing a different pool instead of nothing.
      let spentFavoredEnemy = false;
      if (!alreadySustaining && spell.name === "Hunter's Mark" && hasClassLevel(char, 'Ranger')) {
        const nextResourceUses = trySpendResource(char, 'favoredEnemy');
        if (nextResourceUses) {
          spentFavoredEnemy = true;
          await updateCharacter(cid, casterId, fresh => ({ ...fresh, resourceUses: nextResourceUses }));
          io.to(campaignRoom(cid)).emit('combat:player:featureResources', { characterId: casterId, resourceUses: nextResourceUses });
        }
      }

      const free = spentFavoredEnemy || alreadySustaining || isBreath;
      if (!free && !(await trySpendSpellSlot(cid, casterId, char, slotLevel, spell.name))) {
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
        return;
      }

      await breakSanctuaryOn(cid, casterId);

      const combat = spell.combat;

      // Places a hidden trap on the battlefield (Snare) instead of resolving against creatures —
      // Canvas's AoE-origin click sends the targeted cell rather than gathering targetIds for a
      // placesTrap spell. The trap sits inert until checkTrapAt (shared with dungeon-authored
      // traps) fires when something later steps on its cell.
      if (combat?.placesTrap) {
        placeTrapSpell(cid, char, casterName, spell, originGx, originGy);
        return;
      }

      // Self-buff spells (Divine Smite, Divine Favor, Zephyr Strike, Thunderous/Searing Smite,
      // ...) don't resolve now — they queue extra effects for this caster's next weapon hit
      // this turn. Damage-only smites (Divine Smite) apply unconditionally; smites with a
      // `save` also carry their condition/push effects and any `gatedBySave` hooks, resolved
      // by a save the TARGET rolls the instant the weapon hits (Thunderous Smite's push+Prone,
      // Searing Smite's Burning) — see the `pending.save` branch in combat:attack below.
      // ponytail: curse-style buffs that mark an enemy target over a duration (Hex, Hunter's
      // Mark) need target-lock + duration tracking, a different shape — not handled here yet.
      // Summons (Find Familiar) resolve here too, whatever their range — there's no target to pick.
      if ((parseRangeFeet(spell.range) === 0 || combat?.grantsCompanion) && targetIds.length === 1 && targetIds[0] === casterId) {
        // Tear down whatever this caster was concentrating on BEFORE the hooks below register —
        // same reasoning as the autoHit/curse branch above: these hooks are also caster-owned, so
        // registering them first and breaking after would unregister the ones just added right
        // along with the old cast.
        if (requiresConcentration(spell)) await breakConcentration(cid, casterId);

        // tempHp effects (Armor of Agathys) apply immediately on cast rather than arming on the
        // next weapon hit like a smite's onHit damage does — there's no "hit" involved in
        // granting your own buff, and any hooks riding along (its retaliation damage) are the
        // same self-buff, not a separate next-hit payload, so they register right away too.
        const tempHpEffect = combat?.onHit?.find(e => e.type === 'tempHp');
        if (tempHpEffect) {
          const dice = resolveSpellDamageDice(tempHpEffect.scaling, char.level ?? 1, slotLevel) ?? tempHpEffect.scaling?.base;
          const participant = encounter.findParticipant(casterId);
          if (dice && participant?.isPlayer) grantTempHpToPlayer(cid, participant, rollDice(dice));
          if (combat?.hooks?.length) {
            await registerSpellHooks(getStateEngine(cid), combat.hooks, spell.name, {
              ownerId: casterId, casterId, casterLevel: char.level ?? 1, slotLevel,
              currentRound: encounter.currentRound?.number ?? 1,
            });
          }
        } else if (combat?.onHit?.length) {
          // Bundled to the caster's next weapon hit this turn (Divine/Searing/Thunderous/Wrathful
          // Smite) — always has an onHit bonus-damage effect, since that's the "next hit deals
          // extra damage" text every smite spell has. Any hooks riding along (Searing Smite's
          // Burning) resolve at that same hit, not now.
          const bonuses = pendingWeaponBonuses.get(cid) ?? {};
          bonuses[casterId] = {
            spellName: spell.name,
            effects: combat.onHit,
            hooks: combat?.hooks,
            save: combat?.save,
            casterLevel: char.level ?? 1,
            slotLevel,
            impactColor: combat?.impactColor,
            impactStyle: combat?.impactStyle,
            splashRadiusFt: combat?.splashRadiusFt,
            splashOnHit: combat?.splashOnHit,
            casterAbilityMod: statMod(char.stats[CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int']),
          };
          pendingWeaponBonuses.set(cid, bonuses);
          if (combat?.auraColor) {
            toFight(encounter).emit('combat:effect:aura:start', { casterId, casterName, color: combat.auraColor, style: combat.auraStyle });
          }
        } else if (combat?.hooks?.length) {
          // Passive self-buff with no weapon-hit payload (Mage Armor, Protection from Evil and
          // Good) — nothing to bundle to a future attack, so the hook(s) apply the moment this is
          // cast, same as the tempHp branch above.
          await registerSpellHooks(getStateEngine(cid), combat.hooks, spell.name, {
            ownerId: casterId, casterId, casterLevel: char.level ?? 1, slotLevel,
            currentRound: encounter.currentRound?.number ?? 1,
            currentWorldTimeSecs: await getWorldTimeSecs(cid),
            casterAbilityMod: statMod(char.stats[CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int']),
          });
        } else {
          // Pure narrative self-cast (Detect Magic, Detect Evil and Good, ...) — no mechanical
          // resolution of its own, just the announcement so the table knows it's active and the
          // GM can narrate what it senses. Previously fell through to a silent no-op here.
          if (combat?.grantsItem) await grantItem(cid, casterId, combat.grantsItem);
          if (combat?.grantsCompanion) {
            await grantCompanion(cid, casterId, casterName, companionFor(char, spell, familiar));
            await rememberFamiliar(cid, casterId, familiar);
          }
          if (combat?.followingObject) placeFollowingObject(cid, casterId, casterName, combat.followingObject);
          const msg = { text: `${casterName} casts ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
          void postChat(cid, msg, [casterId]);
        }
        // Self-buff concentration spells (Detect Magic, Antimagic Field, ...) previously
        // returned above without starting concentration — harmless while none of them had
        // `hooks` a break needed to tear down, but wrong the moment one is cast alongside
        // another concentration spell (2024 rules auto-end the older one).
        if (requiresConcentration(spell)) {
          await startConcentrating(cid, casterId, spell.name, [casterId]);
        }
        return;
      }

      const engine = getStateEngine(cid);

      // No attack roll, no save — every target simply gets the effect (Hunter's Mark, Magic
      // Missile, Bless/Aid). Two shapes share this branch:
      //  - autoHit (Hunter's Mark, Witch Bolt redirects): the CASTER owns any hooks — it's their
      //    mark/bolt tracking a target, torn down if the caster loses concentration.
      //  - plain no-save buffs (Bless, Aid): each TARGET owns their own hook — it's their
      //    buff, not the caster's — and concentration links to every buffed ally, not the caster.
      // Multiple targets (Magic Missile's darts, Bless's up to three allies) resolve one at a
      // time, staggered, rather than all landing in the same instant.
      if (combat?.obscuresArea && originGx !== undefined && originGy !== undefined) {
        placeHazardCells(cid, originGx, originGy, combat.area?.size ?? 20, { obscures: true, durationRounds: combat.obscuresArea.durationRounds }, encounter, combat.hazardVisual);
        const msg = { text: `${casterName} casts ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void postChat(cid, msg, [casterId]);
      }

      if (combat?.placesIllusion && originGx !== undefined && originGy !== undefined) {
        placeIllusionMarker(cid, casterName, spell, originGx, originGy);
        const msg = { text: `${casterName} casts ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void postChat(cid, msg, [casterId]);
      }

      if (combat?.autoHit || !combat?.save) {
        const hookOwnerIsCaster = !!combat?.autoHit;
        const healAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
        const healAbilityMod = statMod(char.stats[healAbility]);
        // Computed even for spells with no save of their own — a plain-hooks spell can still
        // carry a hook that rolls its own save later (Sanctuary's sanctuaryWard, read via ctx.dc
        // same as recurringDamage's saveToEnd), frozen at the caster's stats now same as any DC.
        const dc = 8 + (char.proficiencyBonus ?? 2) + statMod(char.stats[CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int']) + dcBonusFor(engine, casterId);
        const currentWorldTimeSecs = combat?.hooks?.length ? await getWorldTimeSecs(cid) : undefined;
        // Tear down whatever this caster was concentrating on BEFORE registering this cast's
        // hooks below — startConcentrating does this too, but only after the loop, by which point
        // a caster-owned hook (Hunter's Mark, Hex) just registered for a NEW target would already
        // be unregistered right along with the old one: unregisterBySource can't tell "the hook
        // this redirect just created" apart from "the hook this redirect is replacing" since both
        // share the same ownerId+spellName. Breaking first makes the loop's registerSpellHooks
        // calls below the only ones left standing.
        if (requiresConcentration(spell)) await breakConcentration(cid, casterId);

        // Curses that target-lock via a caster-owned hook (Hunter's Mark, Hex) — captured here so
        // the "marked" token icon can be raised once concentration is confirmed below.
        let markedTarget: { targetId: string; targetName: string } | undefined;
        let first = true;
        for (const targetId of targetIds) {
          if (!first) await sleep(500);
          first = false;
          if (encounter.ended) return;

          const participant = encounter.findParticipant(targetId);
          if (!participant || participant.isDead()) continue;

          if (combat?.stabilizesTarget) await stabilizeParticipant(cid, participant);

          if (combat?.hooks?.length) {
            await registerSpellHooks(engine, spell.combat?.hooks ?? [], spell.name, {
              ownerId: hookOwnerIsCaster ? casterId : targetId,
              markedTargetId: hookOwnerIsCaster ? targetId : undefined,
              casterId, casterLevel: char.level ?? 1, slotLevel,
              currentRound: encounter.currentRound?.number ?? 1,
              dc,
              currentWorldTimeSecs,
              casterAbilityMod: healAbilityMod,
              chosenDamageType,
              chosenSkill,
            });
            if (hookOwnerIsCaster) markedTarget = { targetId, targetName: participant.name };
          }

          // Instant auto-hit damage on the spot (Witch Bolt redirects, Magic Missile darts) — no
          // roll, applies immediately rather than waiting on a hook, so redirecting to a new
          // target each activation needs no persistent mark to track.
          const targetType: CreatureType = participant.isPlayer ? 'Humanoid' : (participant.creature?.creatureType ?? 'Humanoid');
          const rolledDamage = rollApplicableDamage(combat?.onHit, targetType, char.level ?? 1, slotLevel, chosenDamageType);
          if (rolledDamage) {
            const dmgCtx = await engine.trigger('beforeDamage', {
              sourceId: casterId, targetId, targetName: participant.name,
              amount: rolledDamage.total, damageType: rolledDamage.damageType, sourceName: spell.name,
            });
            const damage = Math.max(0, dmgCtx.amount);
            if (participant.isPlayer) {
              await applyDamageToPlayer(cid, participant, damage, { sourceId: casterId });
            } else if (participant.creature) {
              await applyDamageToCreature(cid, targetId, damage, { sourceId: casterId });
            }
            await engine.trigger('afterDamage', dmgCtx);
            const visual = impactVisualFor(spell.combat, rolledDamage.damageType);
            toFight(encounter).emit('combat:effect:impact', { targetId, targetName: participant.name, color: visual.color, style: visual.style });
          }

          const rolledHeal = rollApplicableHeal(combat?.onHit, char.level ?? 1, slotLevel, healAbilityMod);
          if (rolledHeal) {
            if (participant.isPlayer) {
              applyHealingToPlayer(cid, participant, targetId, rolledHeal.total, spell.name);
            } else if (participant.creature) {
              applyHealingToCreature(cid, targetId, rolledHeal.total);
            }
          }

          const verb = rolledDamage ? 'hits' : rolledHeal ? 'heals' : (hookOwnerIsCaster ? 'marks' : 'blesses');
          console.log(`[spell-mark] ${casterName} ${verb} ${participant.name} with ${spell.name}`);
          const msg = { text: `${casterName} ${verb} ${participant.name} with ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
          void postChat(cid, msg, [casterId]);
        }

        if (requiresConcentration(spell)) {
          // The old concentration (if any) already came down before the loop above — this just
          // records the new one. startConcentrating's own breakConcentration call is a no-op here.
          await startConcentrating(cid, casterId, spell.name, hookOwnerIsCaster ? [casterId] : targetIds);
          if (markedTarget) {
            encounter.marks.set(casterId, { ...markedTarget, spellName: spell.name });
            toFight(encounter).emit('combat:mark', { casterId, ...markedTarget, spellName: spell.name, active: true });
          }
        }
        return;
      }

      await engine.trigger('beforeSpellCast', {
        casterId, casterName, spellName: spell.name,
        spellLevel: spell.level, slotLevel, targetIds,
      });

      // Breath Weapon's DC is 8 + CON + PB (2024 PHB), not the class spellcasting ability.
      const casterSpellAbility = isBreath ? 'con' : CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      const casterAbilityMod = statMod(char.stats[casterSpellAbility]);
      const charProf = char.proficiencyBonus ?? 2;
      const dc = 8 + charProf + casterAbilityMod + dcBonusFor(engine, casterId);

      const saveAbility = combat?.save?.ability ?? casterSpellAbility;
      const halfOnSave = combat?.save?.halfOnSave ?? false;
      // Command's actual effect depends on which word was chosen — see commandEffectsFor.
      const command = spell.name === 'Command' ? commandEffectsFor(chosenCommand) : undefined;
      const effectiveOnHit = command?.onHit ?? combat?.onHit;
      const effectiveHooks = command?.hooks ?? combat?.hooks;

      if (combat?.difficultTerrain && originGx !== undefined && originGy !== undefined) {
        placeHazardCells(cid, originGx, originGy, combat.area?.size ?? 10, combat.difficultTerrain, encounter, combat.hazardVisual);
      }

      const chars = await listCharacters(cid);
      const outcomes: SpellSaveOutcome[] = [];
      const hookedTargetIds: string[] = [];
      const currentWorldTimeSecs = effectiveHooks?.length ? await getWorldTimeSecs(cid) : undefined;

      let firstTarget = true;
      for (const targetId of targetIds) {
        if (!firstTarget) await sleep(500);
        firstTarget = false;
        if (encounter.ended) return;

        const participant = encounter.findParticipant(targetId);
        if (!participant || participant.isDead()) continue;

        let targetChar: Character | undefined;
        if (participant.isPlayer) {
          targetChar = chars.find(c => c.id === targetId || c.name === participant.name);
          if (!targetChar) continue;
        }
        const saveStats = targetChar?.stats ?? participant.creature?.stats;
        if (!saveStats) continue;
        // Same modifier set every other save reads (rollSave) — Bless/Bane/Mind Sliver included.
        let breakdown = rollSave(engine, targetId, saveStats, targetChar ?? participant.creature ?? {}, targetChar, saveAbility, [], effectConditions(effectiveOnHit, effectiveHooks));
        const d20 = keptDie(breakdown);
        const saveBonus = breakdown.total - d20;
        const saveCtx = await engine.trigger('beforeSave', {
          casterId, targetId, targetName: participant.name,
          targetIsPlayer: participant.isPlayer,
          spellName: spell.name,
          ability: saveAbility,
          dc,
          d20,
          saveBonus,
          total: d20 + saveBonus,
          saved: d20 + saveBonus >= dc,
        });
        if (encounter.ended) return;

        // Re-derived from the context, so a hook that moved the DC or the bonus is reflected
        // before afterSave (and everything downstream) reads the outcome.
        saveCtx.total = saveCtx.d20 + saveCtx.saveBonus;
        saveCtx.saved = saveCtx.total >= saveCtx.dc;
        breakdown = reconcile(breakdown, saveCtx.d20, saveCtx.saveBonus);
        await engine.trigger('afterSave', saveCtx);

        const roll = saveCtx.d20;
        const total = saveCtx.total;
        const saved = saveCtx.saved;
        console.log(`[spell-save] ${participant.name} vs ${spell.name} DC${saveCtx.dc}: d20=${roll}${fmtMod(saveCtx.saveBonus)}=${total} — ${saved ? 'SAVE' : 'FAIL'}`);

        // Approach/Drop/Flee (and any free-text word) have no mechanical hook behind them — this
        // is the only trace they leave, so the table knows what was commanded and can enforce it.
        if (spell.name === 'Command' && chosenCommand) {
          const cmdMsg = {
            text: saved ? `${participant.name} resists the command.` : `${participant.name} is commanded: "${chosenCommand}"!`,
            senderName: 'System', timestamp: Date.now(),
          };
          void postChat(cid, cmdMsg, [casterId]);
        }

        const targetType: CreatureType = participant.isPlayer ? 'Humanoid' : (participant.creature?.creatureType ?? 'Humanoid');
        const conditionEffects = (effectiveOnHit ?? []).filter(e => e.type === 'condition' && effectApplies(e, targetType));
        const forcedMove = (effectiveOnHit ?? []).find(e => (e.type === 'push' || e.type === 'pull') && effectApplies(e, targetType));

        // Lightning Lure-style pull: damage only lands if the pull actually ends the target
        // within requireEndWithinFt of the caster — resolved as a dry run here (same
        // deterministic resolveForcedMovement the real move below performs) purely to gate
        // damage; the token doesn't actually move until the block further down.
        let pullDamageGateOk = true;
        if (!saved && forcedMove?.distance && forcedMove.requireEndWithinFt !== undefined) {
          const positions0 = positionsOf(cid, casterName);
          const casterPos0 = positions0[casterName] ?? positions0[casterId];
          const targetPos0 = positions0[targetId] ?? positions0[participant.name];
          if (casterPos0 && targetPos0) {
            const dungeon0 = dungeonOf(cid, casterName);
            const occupied0 = new Set(
              Object.entries(positions0).filter(([id]) => id !== targetId && id !== participant.name).map(([, p]) => `${p.gx},${p.gy}`),
            );
            const dryMove = resolveForcedMovement(
              dungeon0?.cells, occupied0, targetPos0.gx, targetPos0.gy, casterPos0.gx, casterPos0.gy,
              forcedMove.distance, forcedMove.type === 'pull' ? 'pull' : 'push',
              dungeon0 ? closedDoorCells(dungeon0, { forMovement: true }) : undefined,
            );
            const endDistFt = Math.max(Math.abs(dryMove.gx - casterPos0.gx), Math.abs(dryMove.gy - casterPos0.gy)) * 5;
            pullDamageGateOk = endDistFt <= forcedMove.requireEndWithinFt;
          }
        }

        let damage: number | undefined;
        // Toll the Dead's bigger die against a target already missing HP — a target-condition
        // swap of the whole onHit set rather than a stacking bonus, so it needs its own field
        // instead of reusing appliesIf (which sums every matching effect together).
        const woundedOnHit = combat?.onHitIfTargetMissingHp?.length && participant.currentHp < participant.maxHp
          ? combat.onHitIfTargetMissingHp : effectiveOnHit;
        const rolledDamage = rollApplicableDamage(woundedOnHit, targetType, char.level ?? 1, slotLevel);
        if (rolledDamage && (!saved || halfOnSave) && pullDamageGateOk) {
          const dmgCtx = await engine.trigger('beforeDamage', {
            sourceId: casterId, targetId, targetName: participant.name,
            amount: saved ? Math.floor(rolledDamage.total / 2) : rolledDamage.total,
            damageType: rolledDamage.damageType, sourceName: spell.name,
          });
          damage = Math.max(0, dmgCtx.amount);

          // Both branches go through the shared appliers so a kill here clears turn order,
          // triggers the victory check, and fires onDown/onKill — the player branch used to
          // inline its own HP write and skipped all three.
          if (participant.isPlayer && targetChar) {
            await applyDamageToPlayer(cid, participant, damage, { charId: targetChar.id, sourceId: casterId });
          } else if (participant.creature) {
            await applyDamageToCreature(cid, targetId, damage, { sourceId: casterId });
          }
          await engine.trigger('afterDamage', dmgCtx);
        }

        const conditionsApplied = !saved
          ? conditionEffects.map(e => e.condition).filter((c): c is NonNullable<typeof c> => !!c)
          : undefined;

        if (conditionsApplied?.length) {
          for (const name of conditionsApplied) await applyCondition(cid, targetId, name);
        }

        // Lingering effects attach to whoever failed — Tasha's Caustic Brew coating a creature
        // in acid that ticks at the start of each of its turns until the spell ends.
        if (!saved && effectiveHooks?.length) {
          await registerSpellHooks(engine, effectiveHooks, spell.name, {
            ownerId: targetId,
            casterId,
            casterLevel: char.level ?? 1,
            slotLevel,
            currentRound: encounter.currentRound?.number ?? 1,
            targetCreatureType: targetType,
            dc,
            currentWorldTimeSecs,
          });
          hookedTargetIds.push(targetId);
        }

        if (!saved && forcedMove?.distance) {
          const positions = positionsOf(cid, casterName);
          const casterPos = positions[casterName] ?? positions[casterId];
          const targetKey = positions[targetId] ? targetId : participant.name;
          const targetPos = positions[targetKey];
          if (casterPos && targetPos) {
            const dungeon = dungeonOf(cid, casterName);
            const occupied = new Set(
              Object.entries(positions)
                .filter(([id]) => id !== targetKey)
                .map(([, p]) => `${p.gx},${p.gy}`),
            );
            const moved = resolveForcedMovement(
              dungeon?.cells, occupied, targetPos.gx, targetPos.gy, casterPos.gx, casterPos.gy,
              forcedMove.distance, forcedMove.type === 'pull' ? 'pull' : 'push',
              dungeon ? closedDoorCells(dungeon, { forMovement: true }) : undefined,
            );
            if (moved.gx !== targetPos.gx || moved.gy !== targetPos.gy) {
              positions[targetKey] = moved;
              toDungeonOf(cid, targetKey).emit('token:moved', { tokenId: targetKey, gx: moved.gx, gy: moved.gy });
            }
          }
        }

        // Plays whenever the spell actually landed on this target — damage, or (on a failed
        // save) a lingering condition/hook/forced-move with no damage of its own (Faerie Fire).
        if (damage !== undefined || !saved) {
          const visual = impactVisualFor(spell.combat, rolledDamage?.damageType);
          toFight(encounter).emit('combat:effect:impact', { targetId, targetName: participant.name, color: visual.color, style: visual.style });
        }

        outcomes.push({
          targetId,
          targetName: participant.name,
          isPC: participant.isPlayer,
          roll,
          breakdown,
          total,
          dc,
          saved,
          damage,
          conditionsApplied,
          remainingHp: participant.isPlayer ? participant.currentHp : participant.creature?.currentHp,
          targetDead: participant.isDead(),
        });
      }

      if (requiresConcentration(spell)) {
        await startConcentrating(cid, casterId, spell.name, hookedTargetIds);
      }

      const result: SpellSaveResult = { casterName, spellName: spell.name, dc, saveAbility, slotLevel: spell.level, outcomes };
      toFight(encounter).emit('combat:spell:save:result', result);

      if (outcomes.length) {
        void (async () => {
          try {
            const config = await getConfig();
            if (!hasFeatureProvider(config, 'combatNarration')) return;
            const flavour = await generateSpellSaveFlavour(result, getFeatureProvider(config, 'combatNarration'));
            if (!flavour) return;
            const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
            await postChat(cid, msg, [casterId]);
          } catch (err) { logError('index:combatFlavour', err); }
        })();
      }
    })();
  });

  // Generic "use ability" action (AbilityDef) — Rage, Second Wind, Bardic Inspiration, ... —
  // the counterpart to combat:attack/combat:spell:cast for class features that spend a
  // RESOURCE_DEFS pool instead of a spell slot. Reuses the same dice/apply helpers the spell
  // pipeline above uses (rollApplicableHeal, applyHealingToPlayer, ...) against onUse's
  // EffectSpec list, rather than a parallel resolution path.
  socket.on('combat:ability:use', ({ casterId, casterName, abilityKey, targetId, chosenItem, chosenAmount, cureCondition }: { casterId: string; casterName: string; abilityKey: string; targetId?: string; chosenItem?: string; chosenAmount?: number; cureCondition?: boolean }) => {
    void (async () => {
      const cid = campaignId;
      const encounter = fightOf(cid, casterId);
      if (!encounter) return;

      const ability = ABILITY_DEFS[abilityKey];
      if (!ability) return;

      const char = await getCharacter(cid, casterId);
      if (!char || !ownsAbility(char, ability)) return;

      const casterParticipant = encounter.findParticipant(casterId);
      if (!casterParticipant || casterParticipant.isDead()) return;

      // 'self' abilities (Rage, Second Wind) apply to the caster; 'ally' ones (Bardic
      // Inspiration, Lay on Hands) need a real targetId naming who receives onUse/hooks.
      const rawTargetId = ability.target === 'self' ? casterId : targetId;
      if (!rawTargetId) return;
      const effectParticipant = ability.target === 'self' ? casterParticipant : encounter.findParticipant(rawTargetId);
      if (!effectParticipant || effectParticipant.isDead()) return;
      // The client sends a player's display NAME for an ally pick (Canvas's targeting loop keys
      // off `connected: Player[]`, which is names — see Dungeon.positions), not their character id.
      // findParticipant resolves either, but everything past this point (persisting HP,
      // registering a hook by owner) needs the real id, which only the resolved participant has.
      const effectId = effectParticipant.id;

      if (!trySpendAction(cid, casterId, ability.actionCost)) return;

      // Lay on Hands spends a chosen amount out of an HP pool rather than one fixed "use" —
      // trySpendResourceAmount is the variable-amount counterpart to trySpendResource. The cure
      // option spends a flat cureCost instead of an arbitrary heal amount (see AbilityDef.cureCost).
      const isCure = !!cureCondition && ability.cureCost !== undefined;
      const pool = ability.amountChoice ? resourceCurrent(char, ability.resourceKey) : 0;
      const spentAmount = ability.amountChoice
        ? (cureCondition && ability.cureCost !== undefined ? ability.cureCost : Math.max(1, Math.min(chosenAmount ?? pool, pool)))
        : 1;
      const nextResourceUses = ability.amountChoice
        ? (pool > 0 ? trySpendResourceAmount(char, ability.resourceKey, spentAmount) : undefined)
        : trySpendResource(char, ability.resourceKey);
      if (!nextResourceUses) {
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('combat:attack:blocked', { reason: `No uses of ${ability.label} left` });
        return;
      }
      await updateCharacter(cid, casterId, fresh => ({ ...fresh, resourceUses: nextResourceUses }));
      io.to(campaignRoom(cid)).emit('combat:player:featureResources', { characterId: casterId, resourceUses: nextResourceUses });

      // Second Wind's "1d10 + Fighter level" reuses the ability-mod dice idiom (base die +
      // a flat number added once) with the caster's level standing in for an ability modifier —
      // resolveSpellDamageDice doesn't care what the number represents, only that it's added.
      const rolledHeal = rollApplicableHeal(ability.onUse, char.level ?? 1, 0, ability.addLevelToHeal ? char.level ?? 1 : 0);
      if (rolledHeal) {
        if (effectParticipant.isPlayer) applyHealingToPlayer(cid, effectParticipant, effectId, rolledHeal.total, ability.label);
        else if (effectParticipant.creature) applyHealingToCreature(cid, effectId, rolledHeal.total);
      }

      // Temp HP onUse (Adrenaline Rush) — same resolve-then-grant as a tempHp spell's cast path.
      const tempHpDice = resolveSpellDamageDice(ability.onUse.find(e => e.type === 'tempHp')?.scaling, char.level ?? 1, 0);
      if (tempHpDice && effectParticipant.isPlayer) grantTempHpToPlayer(cid, effectParticipant, rollDice(tempHpDice));

      // Adrenaline Rush's Dash — same movement grant the standard Dash action sends.
      if (ability.grantsDash) {
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('movement:granted', { ft: char.speed ?? 30 });
      }

      // Lay on Hands: heal the chosen amount straight out of the pool — no dice, no scaling.
      // The cure option spends cureCost instead of healing, clearing Poisoned off the target.
      if (ability.amountChoice) {
        if (isCure) {
          await clearCondition(cid, effectId, 'Poisoned');
        } else if (effectParticipant.isPlayer) applyHealingToPlayer(cid, effectParticipant, effectId, spentAmount, ability.label);
        else if (effectParticipant.creature) applyHealingToCreature(cid, effectId, spentAmount);
      }

      // Self-buff or ally-buff hooks (Rage, Bardic Inspiration) — identical path a buff spell
      // (Mage Armor, Bless) already registers through; reactivating replaces rather than stacks.
      if (ability.hooks?.length) {
        const needsWorldTime = ability.hooks.some(h => h.duration.until === 'gameTime');
        await registerSpellHooks(getStateEngine(cid), ability.hooks, ability.label, {
          ownerId: effectId, casterId, casterLevel: char.level ?? 1, slotLevel: 0,
          currentRound: encounter.currentRound?.number ?? 1,
          currentWorldTimeSecs: needsWorldTime ? await getWorldTimeSecs(cid) : undefined,
        });
      }

      // Rage's damage-resistance hooks have no visible client state otherwise — drives the
      // "raging" token icon the same way combat:mark drives the marked-creature icon.
      if (abilityKey === 'rage') {
        toFight(encounter).emit('combat:raging', { targetId: effectId, targetName: effectParticipant.name, active: true });
      }

      // Tinker's Magic — a "pick a name from the list" ability grants that item to inventory
      // instead of running onUse/hooks (which are empty for it). See AbilityDef.itemChoices.
      let craftedItem: string | undefined;
      if (ability.itemChoices?.length && chosenItem && ability.itemChoices.includes(chosenItem)) {
        const item = {
          id: randomUUID(), type: 'consumable' as const, name: chosenItem,
          description: `Crafted with ${ability.label}. Vanishes at your next Long Rest.`,
          quantity: 1, effect: '', actionCost: 'action' as const, expiresOnLongRest: true,
        };
        await updateCharacter(cid, casterId, c => ({ ...c, inventory: [...(c.inventory ?? []), item] }));
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('character:inventory:add', [item]);
        craftedItem = chosenItem;
      }

      const msg = { text: `${casterName} uses ${ability.label}${craftedItem ? ` to craft a ${craftedItem}` : ability.amountChoice ? (isCure ? ` on ${effectParticipant.name}, curing Poisoned` : ` on ${effectParticipant.name}, restoring ${spentAmount} HP`) : ability.target === 'ally' ? ` on ${effectParticipant.name}` : ''}.`, senderName: 'System', timestamp: Date.now() };
      void postChat(cid, msg, [casterId]);
    })();
  });

  socket.on('combat:reaction:respond', ({ requestId, spellName }) => {
    resolveReaction(requestId, spellName);
  });

  socket.on('combat:alert:select', ({ characterId, targetId }) => {
    const encounter = fightOf(campaignId, characterId);
    if (encounter) updateAlertSelection(encounter, characterId, targetId);
  });

  socket.on('combat:alert:resolve', ({ characterId, targetId }) => {
    const encounter = fightOf(campaignId, characterId);
    if (encounter) resolveAlertPause(campaignId, encounter, characterId, targetId);
  });

  // Origin feat Healer: Utilize action, expend a Healer's Kit use to tend an ally within 5ft.
  // That ally spends one of their own Hit Dice, rolled here (rerollable once on a 1) + the
  // healer's Proficiency Bonus. Hit Dice only exist for player characters, so the target must be one.
  socket.on('combat:healerKit:use', ({ casterId, casterName, targetId }) => {
    void (async () => {
      const cid = campaignId;
      const encounter = fightOf(cid, casterId);
      if (!encounter) return;

      const char = await getCharacter(cid, casterId);
      if (!char || !hasOriginFeat(char, 'Healer')) return;
      const kit = char.inventory?.find(i => i.name === "Healer's Kit" && i.quantity > 0);
      if (!kit) return;

      const casterParticipant = encounter.findParticipant(casterId);
      const targetParticipant = encounter.findParticipant(targetId);
      if (!casterParticipant || casterParticipant.isDead() || !targetParticipant || targetParticipant.isDead() || !targetParticipant.isPlayer) return;

      const positions = positionsOf(cid, casterId);
      const casterPos = positions[casterParticipant.name] ?? positions[casterId];
      const targetPos = positions[targetParticipant.name] ?? positions[targetId];
      if (!casterPos || !targetPos || Math.max(Math.abs(casterPos.gx - targetPos.gx), Math.abs(casterPos.gy - targetPos.gy)) > 1) return;

      const targetChar = await getCharacter(cid, targetId);
      if (!targetChar) return;
      const hitDiceRemaining = Math.max(0, (targetChar.level ?? 1) - (targetChar.hitDiceUsed ?? 0));
      if (hitDiceRemaining <= 0) return;

      if (!trySpendAction(cid, casterId, 'action')) return;

      const quantity = kit.quantity - 1;
      await updateCharacter(cid, casterId, c => ({
        ...c,
        inventory: quantity > 0
          ? (c.inventory ?? []).map(i => i.id === kit.id ? { ...i, quantity } : i)
          : (c.inventory ?? []).filter(i => i.id !== kit.id),
      }));
      const casterSid = playerSocketIds.get(casterId);
      if (casterSid) io.to(casterSid).emit('character:inventory:remove', { itemId: kit.id, quantity: Math.max(0, quantity) });

      const dieSize = HIT_DICE[targetChar.class] ?? 8;
      const healAmount = rollDiceRerollLow(`1d${dieSize}`, 1) + (char.proficiencyBonus ?? 2);
      await updateCharacter(cid, targetId, c => ({ ...c, hitDiceUsed: (c.hitDiceUsed ?? 0) + 1 }));
      applyHealingToPlayer(cid, targetParticipant, targetId, healAmount, 'Healer');

      const msg = { text: `${casterName} tends to ${targetParticipant.name} with a Healer's Kit, restoring ${healAmount} HP.`, senderName: 'System', timestamp: Date.now() };
      void postChat(cid, msg, [casterId]);
    })();
  });

  socket.on('combat:turn:end', () => {
    const encounter = fightOf(campaignId, charId);
    const actor = encounter?.currentActor;
    console.log(`[turn] combat:turn:end received — currentActor=${actor?.name ?? 'none'} isPlayer=${actor?.isPlayer}`);
    // Only the actor can end their own turn — a late click from someone whose fight was just merged
    // into this one must not skip whoever's actually up.
    if (actor?.isPlayer && actor.id === charId) {
      // Unused on-hit buffs (e.g. Divine Smite) expire if not spent by end of turn.
      const bonuses = pendingWeaponBonuses.get(campaignId);
      if (bonuses?.[actor.id]) {
        delete bonuses[actor.id];
        toFightOf(campaignId, actor.id).emit('combat:effect:aura:end', { casterId: actor.id, casterName: actor.name });
      }
      if (encounter) advanceTurn(campaignId, encounter);
    }
  });
}
