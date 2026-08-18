import type { TurnOrderEntry, Weapon, Spell, SpellAttackResult, SpellSaveOutcome, SpellSaveResult, CreatureType, Character, ActionResource, AttackContext, DungeonEntity, EffectSpec, AbilityKey, HookSpec } from 'shared';
import { CLASS_WEAPON_PROFS, CLASS_SPELLCASTING_ABILITY, CLASS_SAVING_THROWS, isAmmunition, statMod, parseRangeFeet, resolveForcedMovement, findPath, effectApplies, actionCostFromCastingTime, requiresConcentration, resolveSpellDamageDice, hasOriginFeat, crossesObscuredArea } from 'shared';
import { randomUUID } from 'crypto';
import { getCharacter, updateCharacter, saveEncounter, listCharacters, getConfig, appendChatLog, saveDungeon } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateCombatFlavour, generateSpellSaveFlavour } from '../session-processor/imagePrompts.ts';
import { Participant } from '../domain/encounter.ts';
import { logError, logDebug } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, dungeons, playerSocketIds, pendingWeaponBonuses, connected, getStateEngine, withLivePositions, STAT_FULL } from '../state.ts';
import { toClientDungeon } from '../dungeon/index.ts';
import { registerSpellHooks } from '../combat/stateEngine/registerSpellHooks.ts';
import { RecurringDamageHook } from '../combat/stateEngine/hooks/RecurringDamageHook.ts';
import type { RollModifierHook } from '../combat/stateEngine/hooks/RollModifierHook.ts';
import type { WeaponAttackOverrideHook } from '../combat/stateEngine/hooks/WeaponAttackOverrideHook.ts';
import { resolveReaction } from '../combat/stateEngine/reactionPrompt.ts';
import { D20Roll, rollDice, fmtMod, rollApplicableDamage, rollApplicableHeal, rollChainableDamage } from '../combat/dice.ts';
import { rollModeFor, attackModeAgainstTarget } from '../combat/conditions/rollModeFor.ts';
import { applyDamageToCreature, applyDamageToPlayer, applyHealingToPlayer, applyHealingToCreature, grantTempHpToPlayer, advanceTurn, trySpendSpellSlot, tryBeginCombat, emitResources, applyCondition, clearCondition, startConcentrating, isConcentratingOn, rollSavingThrow, checkTrapAt, canMove, breakSanctuaryOn, getWorldTimeSecs, applyElevationChange, investigateIllusion, checkMovementTriggers, bladeWardPenalty, stabilizeParticipant } from '../combat/runtime.ts';
import { checkDungeonProximity } from '../dungeon/runtime.ts';
import { applyEffects } from '../effects.ts';
import type { JoinContext } from './context.ts';

/** Staggers multi-target spell resolution (Magic Missile's darts, Bless's allies, ...) so results land one at a time rather than all at once. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Every living participant within radiusFt (Chebyshev, 5ft/cell — same convention as checkTrapAt/RetaliationOfferHook's range check) of centerId's token, centerId included. Positions are best-effort; a participant with no placed token is skipped rather than assumed in range. */
function nearbyParticipantIds(cid: string, centerId: string, radiusFt: number): string[] {
  const encounter = encounters.get(cid);
  if (!encounter) return [];
  const positions = tokenPositions.get(cid) ?? {};
  const all = [...encounter.players, ...encounter.enemies];
  const center = all.find(p => p.id === centerId);
  const centerPos = center ? (positions[center.id] ?? positions[center.name]) : undefined;
  if (!centerPos) return center && !center.isDead() ? [centerId] : [];
  return all
    .filter(p => !p.isDead())
    .filter(p => {
      if (p.id === centerId) return true;
      const pos = positions[p.id] ?? positions[p.name];
      if (!pos) return false;
      return Math.max(Math.abs(pos.gx - centerPos.gx), Math.abs(pos.gy - centerPos.gy)) * 5 <= radiusFt;
    })
    .map(p => p.id);
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
  const encounter = encounters.get(cid);
  if (!encounter) return;
  const engine = getStateEngine(cid);
  const outcomes: SpellSaveOutcome[] = [];

  for (const targetId of nearbyParticipantIds(cid, centerId, radiusFt).filter(id => !excludeIds.has(id))) {
    const participant = encounter.findParticipant(targetId);
    if (!participant || participant.isDead()) continue;

    const { saved, roll, bonus, total } = await rollSavingThrow(cid, targetId, saveAbility, dc);
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
      roll, saveBonus: bonus, total, dc, saved, damage,
      remainingHp: participant.isPlayer ? participant.currentHp : participant.creature?.currentHp,
      targetDead: participant.isDead(),
    });
  }

  if (outcomes.length) {
    io.to(ROOM).emit('combat:spell:save:result', { casterName, spellName, dc, saveAbility, slotLevel, outcomes });
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
  await applyEffects(cid, [{ type: 'party_join', ally: { ...spec, id, ownerId: casterId } }]);
  const pos = (tokenPositions.get(cid) ?? {})[casterName] ?? (tokenPositions.get(cid) ?? {})[casterId];
  if (pos) {
    const positions = tokenPositions.get(cid) ?? {};
    positions[id] = { gx: pos.gx, gy: pos.gy };
    tokenPositions.set(cid, positions);
    io.to(ROOM).emit('token:moved', { tokenId: id, gx: pos.gx, gy: pos.gy });
  }
}

/**
 * Spends one of the actor's per-turn resources, telling them why if they have none left.
 * Returns false when the action must not proceed.
 *
 * Only gates the participant whose turn it is — a reaction spent on someone else's turn goes
 * through ReactionOfferHook, which does its own check against the same budget.
 */
function trySpendAction(cid: string, actorId: string, kind: ActionResource): boolean {
  const participant = encounters.get(cid)?.findParticipant(actorId);
  if (!participant) return true; // not tracked in this encounter — don't block on missing state
  if (participant.trySpend(kind)) {
    emitResources(participant);
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
  const encounter = encounters.get(cid);
  if (!encounter) return undefined;
  const positions = tokenPositions.get(cid) ?? {};
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
  const dungeon = dungeons.get(cid);
  if (!dungeon || originGx === undefined || originGy === undefined) {
    logDebug(`[trap] placesTrap cast blocked — dungeon=${!!dungeon} originGx=${originGx} originGy=${originGy}`);
    return;
  }
  const spellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
  const dc = 8 + (char.proficiencyBonus ?? 2) + statMod(char.stats[spellAbility]);
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
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  const msg = { text: `${casterName} sets ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
  void appendChatLog(cid, msg);
  io.to(ROOM).emit('chat:message', msg);
  console.log(`[trap] ${casterName} places ${spell.name} at (${originGx},${originGy}), DC${dc}`);
  logDebug(`[trap] ${casterName} places ${spell.name} at (${originGx},${originGy}), DC${dc}`);
}

/** Conjures a spell's `followingObject` spec at the caster's own token position (Tenser's Floating Disk) — see DungeonEntity.followsId. No-ops quietly if there's no dungeon or the caster has no placed token yet, same as placeTrapSpell. */
function placeFollowingObject(cid: string, casterId: string, casterName: string, spec: NonNullable<Spell['combat']>['followingObject']): void {
  if (!spec) return;
  const dungeon = dungeons.get(cid);
  const pos = (tokenPositions.get(cid) ?? {})[casterId] ?? (tokenPositions.get(cid) ?? {})[casterName];
  if (!dungeon || !pos) return;

  const entity: DungeonEntity = {
    id: randomUUID(), type: 'object', x: pos.gx, y: pos.gy, name: spec.name,
    discovered: true, followsId: casterId, leashFt: spec.leashFt,
  };
  dungeon.entities = [...dungeon.entities, entity];
  void saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
}

/** Drops Silent Image's stationary marker at the targeted cell — a labeled 'object' entity with no followsId, so it just sits there (see the spell's own todo for what's still missing: moving it, and revealing it on inspection). */
function placeIllusionMarker(cid: string, casterName: string, spell: Spell, originGx: number, originGy: number): void {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const entity: DungeonEntity = {
    id: randomUUID(), type: 'object', x: originGx, y: originGy, name: spell.name,
    discovered: true, placedBy: casterName,
  };
  dungeon.entities = [...dungeon.entities, entity];
  void saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
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
  spec: { multiplier?: number; obscures?: boolean; durationRounds: number } | undefined, currentRound: number,
  visual?: NonNullable<Spell['combat']>['hazardVisual'],
): void {
  if (!spec) return;
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const half = Math.floor(sizeFt / 5 / 2);
  const cx = Math.round(originGx);
  const cy = Math.round(originGy);
  const expiresOnRound = currentRound + spec.durationRounds;
  const added: NonNullable<typeof dungeon.hazardCells> = [];
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) {
      added.push({
        gx: cx + dx, gy: cy + dy, multiplier: spec.multiplier, obscures: spec.obscures, expiresOnRound,
        style: visual?.style, color: visual?.color,
      });
    }
  }
  dungeon.hazardCells = [...(dungeon.hazardCells ?? []), ...added];
  void saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
}

/** Whether a straight line between two cells crosses a Heavily Obscured hazard cell (Fog Cloud) — see crossesObscuredArea. */
function isLineObscured(cid: string, x0: number, y0: number, x1: number, y1: number): boolean {
  const obscured = dungeons.get(cid)?.hazardCells?.filter(h => h.obscures) ?? [];
  return crossesObscuredArea(obscured, x0, y0, x1, y1);
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
  const dungeon = dungeons.get(cid);
  const followers = dungeon?.entities.filter(e => e.type === 'object' && e.followsId === tokenId);
  if (!dungeon || !followers?.length) return;

  let changed = false;
  const kept = dungeon.entities.filter(e => {
    if (e.type !== 'object' || e.followsId !== tokenId) return true;
    const distFt = Math.max(Math.abs(e.x - gx), Math.abs(e.y - gy)) * 5;
    if (distFt > 100) {
      changed = true;
      const msg = { text: `${e.name} can't keep up and fades away.`, senderName: 'System', timestamp: Date.now() };
      void appendChatLog(cid, msg);
      io.to(ROOM).emit('chat:message', msg);
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
    io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
  }
}

export function registerCombatHandlers(ctx: JoinContext): void {
  const { socket, campaignId } = ctx;

  socket.on('token:move', ({ tokenId, gx, gy }) => {
    void (async () => {
      if (!(await canMove(campaignId, tokenId))) return;

      const positions = tokenPositions.get(campaignId) ?? {};
      const origin = positions[tokenId];

      // Backstop for the client's own wall-aware drop gating — reject a destination no walkable
      // route reaches from the token's last known cell (or, with no known cell yet, that isn't
      // floor at all), rather than trusting whatever gx/gy the socket message carries.
      const cells = dungeons.get(campaignId)?.cells;
      if (cells) {
        const blocked = origin ? !findPath(cells, origin.gx, origin.gy, gx, gy) : cells[gy]?.[gx] !== 1;
        if (blocked) return;
      }

      positions[tokenId] = { gx, gy };
      tokenPositions.set(campaignId, positions);
      socket.to(ROOM).emit('token:moved', { tokenId, gx, gy });
      updateFollowingObjects(campaignId, tokenId, gx, gy);
      if (origin) void checkMovementTriggers(campaignId, tokenId, origin.gx, origin.gy, gx, gy);

      if (connected.has(tokenId)) {
        void checkDungeonProximity(campaignId, gx, gy, tokenId);
      } else {
        // GM-dragged enemy/ally token — the AI's own movement loop checks traps step-by-step as
        // it walks, but a manual drag jumps straight to the destination with no loop to hook, so
        // it needs its own check here. No-ops safely if tokenId isn't a live participant.
        const name = encounters.get(campaignId)?.findParticipant(tokenId)?.name ?? tokenId;
        void checkTrapAt(campaignId, gx, gy, tokenId, name, false);
      }
    })();
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
      if (!combatState.get(cid)) return;

      const engine = getStateEngine(cid);
      const hook = engine.getHooksOwnedBy(targetId, 'recurringDamage')
        .find((h): h is RecurringDamageHook => h instanceof RecurringDamageHook && h.conditionName === name && !!h.escapeSkillCheck);
      if (!hook?.escapeSkillCheck) return;
      if (!trySpendAction(cid, targetId, 'action')) return;

      const result = await hook.attemptEscape(engine);
      if (!result) return;

      const participant = encounters.get(cid)?.findParticipant(targetId);
      const targetName = participant?.name ?? targetId;
      console.log(`[escape] ${targetName} attempts ${hook.escapeSkillCheck} vs DC${result.dc}: d20+${result.bonus}=${result.total} — ${result.succeeded ? 'FREE' : 'STUCK'}`);
      const msg = {
        text: `${targetName} attempts to escape (${hook.escapeSkillCheck} ${fmtMod(result.bonus)}, DC${result.dc}): ${result.total} — ${result.succeeded ? 'breaks free!' : 'still stuck.'}`,
        senderName: 'System', timestamp: Date.now(),
      };
      void appendChatLog(cid, msg);
      io.to(ROOM).emit('chat:message', msg);
      io.to(ROOM).emit('combat:condition:escape:result', {
        targetId, targetName, name, skill: hook.escapeSkillCheck,
        roll: result.roll, bonus: result.bonus, total: result.total, dc: result.dc, succeeded: result.succeeded,
      });
    })();
  });

  // Elevation tracker — a token/player's height off the ground (Feather Fall, falling damage).
  // No permission gate on who can set whose: GM narration ("you fall") and a player's own
  // Jump/climb both need to move it, same trust model as token:move.
  socket.on('combat:elevation:set', ({ targetId, elevationFt }) => {
    if (!combatState.get(campaignId)) return;
    void applyElevationChange(campaignId, targetId, elevationFt);
  });

  // Disengage — makes this actor's movement not provoke Opportunity Attacks for the rest of
  // their turn (checkOpportunityAttacks reads Participant.disengaging directly, no hook needed).
  socket.on('combat:disengage', ({ actorId }) => {
    const participant = encounters.get(campaignId)?.findParticipant(actorId);
    if (participant) participant.disengaging = true;
  });

  // Illusion detection (Disguise Self) — works with or without active combat, same as casting
  // the spell itself does. Results go only to the investigator's own socket: RAW's "you see
  // through it" is knowledge specific to them, not a public reveal to the whole table.
  socket.on('combat:illusion:investigate', ({ targetId, investigatorId }) => {
    void (async () => {
      const cid = campaignId;
      const tags = await investigateIllusion(cid, targetId, investigatorId);
      if (!tags.length) return;
      const targetName = encounters.get(cid)?.findParticipant(targetId)?.name
        ?? (await getCharacter(cid, targetId))?.name ?? targetId;
      const sid = playerSocketIds.get(investigatorId);
      if (sid) io.to(sid).emit('combat:illusion:investigate:result', { targetId, targetName, tags });
    })();
  });

  socket.on('combat:initiative:roll', (entry: TurnOrderEntry) => {
    const cid = campaignId;
    if (!combatState.get(cid)) return;
    const encounter = encounters.get(cid);
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
    io.to(ROOM).emit('combat:initiative', entry);
    tryBeginCombat(cid);
    void saveEncounter(cid, encounter);
  });

  socket.on('combat:attack', ({ attackerId, attackerName, targetId, weapon, bonusSpell }: { attackerId: string; attackerName: string; targetId: string; weapon: Weapon; bonusSpell?: Spell }) => {
    void (async () => {
      const cid = campaignId;
      if (!combatState.get(cid)) return;
      const encounter = encounters.get(cid);
      if (!encounter) return;

      const char = await getCharacter(cid, attackerId);
      const creature = encounter.findCreature(targetId);
      if (!char || !creature || creature.isDead()) return;

      // An attack costs the action; a bundled smite costs the bonus action on top. Spent before
      // ammunition is deducted so a blocked attack cannot silently eat an arrow.
      if (!trySpendAction(cid, attackerId, 'action')) return;
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
      const useDex = !isMelee || (weapon.isFinesse && dexMod > strMod);
      const spellAbilityKey = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      const statBonus = weaponOverride ? statMod(char.stats[spellAbilityKey]) : (useDex ? dexMod : strMod);
      const statName = weaponOverride ? (STAT_FULL[spellAbilityKey.toUpperCase()] ?? spellAbilityKey) : (useDex ? 'Dexterity' : 'Strength');
      const charProf = char.proficiencyBonus ?? 2;
      const classWeaponProfs = CLASS_WEAPON_PROFS[char.class] ?? [];
      const isProficient = weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
      const weaponBonus = (weapon.attackBonus ?? 0) + (isProficient ? charProf : 0);
      // Bless/Bane — rerolled fresh against every attack, not fixed at cast time (see RollModifierHook).
      const rollMods = getStateEngine(cid).getHooksOwnedBy(attackerId, 'rollModifier') as RollModifierHook[];
      const attackBonus = statBonus + weaponBonus + rollMods.reduce((sum, h) => sum + h.sign * rollDice(`1d${h.dieSize}`), 0) + bladeWardPenalty(cid, targetId);

      const positions = tokenPositions.get(cid) ?? {};
      const attackerPos = positions[attackerName];
      const targetPos = positions[targetId];
      const inExtendedRange = !!(weapon.extendedRange && attackerPos && targetPos &&
        Math.max(Math.abs(targetPos.gx - attackerPos.gx), Math.abs(targetPos.gy - attackerPos.gy)) > Math.floor(weapon.range / 5));

      const engine = getStateEngine(cid);
      const mode = rollModeFor(char, 'attack');
      // Faerie Fire's outline, Guiding Bolt's guiding light — advantage on attacks against this
      // target has to be decided before the die is rolled, too early for the hook trigger chain.
      // D20Roll itself cancels advantage/disadvantage back to a flat roll if both end up true,
      // so this only needs to feed in the raw sources, not resolve them.
      const targetHasAdvantageGrant = engine.hasHookOwnedBy(targetId, 'grantAdvantage');
      const attackerHasSelfAdvantage = engine.hasHookOwnedBy(attackerId, 'grantAdvantageSelf');
      const attackerHasSelfDisadvantage = engine.hasHookOwnedBy(attackerId, 'grantDisadvantageSelf');
      const targetRestrained = attackModeAgainstTarget(creature) > 0;
      const obscured = !!(attackerPos && targetPos && isLineObscured(cid, attackerPos.gx, attackerPos.gy, targetPos.gx, targetPos.gy));
      const roll = new D20Roll({ withDisadvantage: inExtendedRange || mode < 0 || obscured || attackerHasSelfDisadvantage, withAdvantage: mode > 0 || targetHasAdvantageGrant || attackerHasSelfAdvantage || targetRestrained }).roll();
      const atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
        attackerId, attackerName,
        targetId, targetName: creature.name,
        targetIsPlayer: false,
        sourceName: weapon.name,
        d20: roll,
        attackBonus,
        ac: creature.ac,
        total: roll + attackBonus,
        hit: roll + attackBonus >= creature.ac,
      }));
      if (!combatState.get(cid)) return;

      // Re-derived from the context rather than the pre-hook locals — see CONTEXT MUTATION in
      // shared/types/combat-hooks.ts.
      const total = atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
      const hit = atkCtx.hit = total >= atkCtx.ac;

      let damage: number | undefined;
      let damageRoll: number | undefined;
      let bonus: { spellName: string; damageType: string | undefined; total: number } | undefined;
      if (hit) {
        const damageFormula = weaponOverride?.damageDie ?? weapon.damage;
        // Savage Attacker: roll the weapon's damage dice twice and keep the higher total.
        damageRoll = hasOriginFeat(char, 'Savage Attacker')
          ? Math.max(rollDice(damageFormula), rollDice(damageFormula))
          : rollDice(damageFormula);
        damage = damageRoll + statBonus;

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
            io.to(ROOM).emit('combat:effect:aura:end', { casterId: attackerId, casterName: attackerName });
            if (pending.impactColor) {
              io.to(ROOM).emit('combat:effect:impact', { targetId, targetName: creature.name, color: pending.impactColor, style: pending.impactStyle });
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
              dc = 8 + charProf + statMod(char.stats[casterAbility]);
              const { saved: s, roll: saveRoll, bonus: saveBonus, total: saveTotal } =
                await rollSavingThrow(cid, targetId, pending.save.ability, dc);
              saved = s;
              console.log(`[bundled-smite] ${creature.name} save vs ${pending.spellName} DC${dc}: d20=${saveRoll}${fmtMod(saveBonus)}=${saveTotal} — ${saved ? 'SAVE' : 'FAIL'}`);
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
                  void appendChatLog(cid, splashMsg);
                  io.to(ROOM).emit('chat:message', splashMsg);
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
                    const positions2 = tokenPositions.get(cid) ?? {};
                    const casterPos = positions2[attackerName] ?? positions2[attackerId];
                    const targetPos2 = positions2[targetId];
                    if (casterPos && targetPos2) {
                      const dungeon = dungeons.get(cid);
                      const occupied = new Set(
                        Object.entries(positions2).filter(([id]) => id !== targetId).map(([, p]) => `${p.gx},${p.gy}`),
                      );
                      const moved = resolveForcedMovement(
                        dungeon?.cells, occupied, targetPos2.gx, targetPos2.gy, casterPos.gx, casterPos.gy,
                        e.distance, e.type === 'pull' ? 'pull' : 'push',
                      );
                      if (moved.gx !== targetPos2.gx || moved.gy !== targetPos2.gy) {
                        positions2[targetId] = moved;
                        tokenPositions.set(cid, positions2);
                        io.to(ROOM).emit('token:moved', { tokenId: targetId, gx: moved.gx, gy: moved.gy });
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
              const dc = 8 + charProf + statMod(char.stats[casterAbility]);
              await registerSpellHooks(engine, ungatedHooks, pending.spellName, {
                ownerId: targetId, casterId: attackerId,
                casterLevel: pending.casterLevel, slotLevel: pending.slotLevel,
                currentRound: encounter.currentRound?.number ?? 1, dc,
              });
            }
          }
        }

        const dmgCtx = await engine.trigger('beforeDamage', {
          sourceId: attackerId, targetId, targetName: creature.name,
          amount: damage, damageType: weapon.damageType, sourceName: weapon.name,
        });
        damage = Math.max(0, dmgCtx.amount);
        await applyDamageToCreature(cid, targetId, damage, { sourceId: attackerId });
        await engine.trigger('afterDamage', dmgCtx);

        // Tavern Brawler: push the target 5 feet on an Unarmed Strike hit.
        if (weapon.id === 'unarmed-strike' && hasOriginFeat(char, 'Tavern Brawler') && attackerPos && targetPos) {
          const dungeon = dungeons.get(cid);
          const occupied = new Set(
            Object.entries(positions).filter(([id]) => id !== targetId).map(([, p]) => `${p.gx},${p.gy}`),
          );
          const moved = resolveForcedMovement(
            dungeon?.cells, occupied, targetPos.gx, targetPos.gy, attackerPos.gx, attackerPos.gy, 5, 'push',
          );
          if (moved.gx !== targetPos.gx || moved.gy !== targetPos.gy) {
            positions[targetId] = moved;
            tokenPositions.set(cid, positions);
            io.to(ROOM).emit('token:moved', { tokenId: targetId, gx: moved.gx, gy: moved.gy });
          }
        }
      }

      const atkResult = {
        attackerName,
        targetName: creature.name,
        targetId,
        weaponName: weapon.name,
        isMelee,
        d20: roll,
        attackBonus,
        statBonus,
        statName,
        weaponBonus,
        total,
        ac: atkCtx.ac,
        hit,
        damage,
        damageRoll,
        damageType: weapon.damageType,
        damageFormula: weapon.damage,
        bonusSpellName: bonus?.spellName,
        bonusDamage: bonus?.total,
        bonusDamageType: bonus?.damageType,
        remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
        targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
      };
      io.to(ROOM).emit('combat:attack:result', atkResult);

      void (async () => {
        try {
          const config = await getConfig();
          if (!hasFeatureProvider(config, 'combatNarration')) return;
          const flavour = await generateCombatFlavour(atkResult, getFeatureProvider(config, 'combatNarration'));
          if (!flavour) return;
          const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
          await appendChatLog(cid, msg);
          io.to(ROOM).emit('chat:message', msg);
        } catch (err) { logError('index:combatFlavour', err); }
      })();
    })();
  });

  // Spell attack (e.g. Fire Bolt, or Jim's Magic Missile's 3 darts) — mirrors combat:attack but
  // uses the caster's spellcasting modifier for the attack roll and adds no stat mod to damage.
  // One attack roll per entry in targetIds — most spells send a single entry (spellTargetCount
  // defaults to {min:1,max:1}), darts/blasts send one per accumulated target, and Chaos
  // Bolt/Chromatic Orb's dice-triggered leap pushes extra entries onto the queue mid-resolution.
  socket.on('combat:spell:attack', ({ casterId, casterName, targetIds, spell, slotLevel, chosenDamageType }) => {
    void (async () => {
      const cid = campaignId;
      if (!combatState.get(cid)) return;
      const encounter = encounters.get(cid);
      if (!encounter || !targetIds.length) return;

      const char = await getCharacter(cid, casterId);
      if (!char) return;

      // Redirecting an already-sustained spell (Witch Bolt) is free — no slot, and costs a Bonus
      // Action per RAW rather than the spell's normal casting-time cost (which paid for the
      // original cast already). Reaction-cast spells are never initiated from here — they are
      // offered mid-resolution by ReactionOfferHook, which spends the reaction itself.
      const free = await isConcentratingOn(cid, casterId, spell.name);
      const castCost = free ? 'bonusAction' : (spell.combat?.actionCostOverride ?? actionCostFromCastingTime(spell.castingTime));
      if (castCost && castCost !== 'reaction' && !trySpendAction(cid, casterId, castCost)) return;

      if (!free && !(await trySpendSpellSlot(cid, casterId, char, slotLevel))) {
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
      const baseAttackBonus = abilityMod + charProf + rollMods.reduce((sum, h) => sum + h.sign * rollDice(`1d${h.dieSize}`), 0);
      const dc = 8 + charProf + abilityMod;

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
        if (!combatState.get(cid)) return;

        const creature = encounter.findCreature(targetId);
        if (!creature || creature.isDead()) continue;
        attackIndex++;
        const attackBonus = baseAttackBonus + bladeWardPenalty(cid, targetId);

        // Redirecting an already-sustained spell (Witch Bolt) auto-hits, no roll — only the
        // initial slotted cast is a real attack roll that can miss.
        let roll = 0;
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
          const spellMode = rollModeFor(char, 'attack');
          const targetHasAdvantageGrant = engine.hasHookOwnedBy(targetId, 'grantAdvantage');
          const casterHasSelfAdvantage = engine.hasHookOwnedBy(casterId, 'grantAdvantageSelf');
          const targetRestrained = attackModeAgainstTarget(creature) > 0;
          const positions = tokenPositions.get(cid) ?? {};
          const casterPos = positions[casterName] ?? positions[casterId];
          const targetPos = positions[targetId];
          const obscured = !!(casterPos && targetPos && isLineObscured(cid, casterPos.gx, casterPos.gy, targetPos.gx, targetPos.gy));
          roll = new D20Roll({ withDisadvantage: spellMode < 0 || obscured, withAdvantage: spellMode > 0 || targetHasAdvantageGrant || casterHasSelfAdvantage || targetRestrained }).roll();
          atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
            attackerId: casterId, attackerName: casterName,
            targetId, targetName: creature.name,
            targetIsPlayer: false,
            sourceName: spell.name,
            d20: roll,
            attackBonus,
            ac: creature.ac,
            total: roll + attackBonus,
            hit: roll + attackBonus >= creature.ac,
          }));
          if (!combatState.get(cid)) return;

          total = atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
          hit = atkCtx.hit = total >= atkCtx.ac;
        }

        const rolledDamage = chainable && primaryEffect
          ? rollChainableDamage(primaryEffect, char.level ?? 1, slotLevel, { deriveTypeFromRoll: spell.name === 'Chaos Bolt', chosenDamageType })
          : rollApplicableDamage(spell.combat?.onHit, creature.creatureType, char.level ?? 1, slotLevel, chosenDamageType, abilityMod);

        let damage: number | undefined;
        let damageRoll: number | undefined;
        if (hit && rolledDamage) {
          damageRoll = rolledDamage.total;
          const dmgCtx = await engine.trigger('beforeDamage', {
            sourceId: casterId, targetId, targetName: creature.name,
            amount: damageRoll, // no spellcasting-mod bonus on spell damage, per 5e rules
            damageType: rolledDamage.damageType, sourceName: spell.name,
          });
          damage = Math.max(0, dmgCtx.amount);
          await applyDamageToCreature(cid, targetId, damage, { sourceId: casterId });
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
            const positions2 = tokenPositions.get(cid) ?? {};
            const casterPos2 = positions2[casterName] ?? positions2[casterId];
            const targetPos2 = positions2[targetId];
            if (casterPos2 && targetPos2) {
              const dungeon2 = dungeons.get(cid);
              const occupied2 = new Set(
                Object.entries(positions2).filter(([id]) => id !== targetId).map(([, p]) => `${p.gx},${p.gy}`),
              );
              const moved2 = resolveForcedMovement(
                dungeon2?.cells, occupied2, targetPos2.gx, targetPos2.gy, casterPos2.gx, casterPos2.gy,
                forcedMove.distance, forcedMove.type === 'pull' ? 'pull' : 'push',
              );
              if (moved2.gx !== targetPos2.gx || moved2.gy !== targetPos2.gy) {
                positions2[targetId] = moved2;
                tokenPositions.set(cid, positions2);
                io.to(ROOM).emit('token:moved', { tokenId: targetId, gx: moved2.gx, gy: moved2.gy });
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
          attackBonus,
          statBonus: abilityMod,
          statName: 'Spellcasting',
          total,
          ac: atkCtx.ac,
          hit,
          damage,
          damageRoll,
          damageType: rolledDamage?.damageType,
          damageFormula: rolledDamage?.formula,
          remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
          targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
        };
        io.to(ROOM).emit('combat:spell:attack:result', atkResult);

        if (hit) {
          const visual = impactVisualFor(spell.combat, rolledDamage?.damageType);
          io.to(ROOM).emit('combat:effect:impact', { targetId, targetName: creature.name, color: visual.color, style: visual.style });
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
              await appendChatLog(cid, msg);
              io.to(ROOM).emit('chat:message', msg);
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
    })();
  });

  // Save-based spell (single-target or AoE) — computes the DC once, then rolls each
  // affected target's save mechanically and applies damage/conditions behind the curtain.
  socket.on('combat:spell:cast', ({ casterId, casterName, spell, slotLevel, targetIds, chosenDamageType, chosenCommand, chosenSkill, originGx, originGy }) => {
    void (async () => {
      const cid = campaignId;

      // Journal-only spells (Ceremony) never resolve mechanically and can't be cast while combat
      // is active — no action, no attack/save, just a slot spend and a journal/chat line.
      if (spell.combat?.journalOnly) {
        if (combatState.get(cid)) {
          const sid = playerSocketIds.get(casterId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: `${spell.name} can't be cast in combat` });
          return;
        }
        const char = await getCharacter(cid, casterId);
        if (!char) return;
        if (!(await trySpendSpellSlot(cid, casterId, char, slotLevel))) {
          const sid = playerSocketIds.get(casterId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
          return;
        }
        const msg = { text: `${casterName} performs the rite of ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void appendChatLog(cid, msg);
        io.to(ROOM).emit('chat:message', msg);
        return;
      }

      // Exploration-castable spells (combat.explorationCastable) skip the whole action-economy/
      // encounter gate outside combat: same spell slot spend, no action, no turn. Cast during an
      // active fight, they fall through to the normal gated path below instead. Two shapes: traps
      // (Snare, Alarm) place on the battlefield; everything else (Detect Magic, Comprehend
      // Languages, ...) has no mechanical resolution of its own — just spend the slot and
      // announce so the GM can narrate what it senses/does.
      if (spell.combat?.explorationCastable && !combatState.get(cid)) {
        const char = await getCharacter(cid, casterId);
        if (!char) return;
        if (!(await trySpendSpellSlot(cid, casterId, char, slotLevel))) {
          const sid = playerSocketIds.get(casterId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
          return;
        }
        if (spell.combat.placesTrap) {
          placeTrapSpell(cid, char, casterName, spell, originGx, originGy);
          return;
        }
        if (spell.combat.grantsItem) await grantItem(cid, casterId, spell.combat.grantsItem);
        if (spell.combat.grantsCompanion) await grantCompanion(cid, casterId, casterName, spell.combat.grantsCompanion);
        if (spell.combat.followingObject) placeFollowingObject(cid, casterId, casterName, spell.combat.followingObject);
        if (spell.combat.hooks?.length) {
          // Self-only (Disguise Self) — nothing in this exploration-cast branch targets anyone
          // else, unlike the combat-gated paths below.
          const abilityMod = statMod(char.stats[CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int']);
          await registerSpellHooks(getStateEngine(cid), spell.combat.hooks, spell.name, {
            ownerId: casterId, casterId, casterLevel: char.level ?? 1, slotLevel,
            currentRound: 1,
            dc: 8 + (char.proficiencyBonus ?? 2) + abilityMod,
            currentWorldTimeSecs: await getWorldTimeSecs(cid),
          });
        }
        const msg = { text: `${casterName} casts ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void appendChatLog(cid, msg);
        io.to(ROOM).emit('chat:message', msg);
        return;
      }

      if (!combatState.get(cid)) return;
      const encounter = encounters.get(cid);
      if (!encounter) return;

      const char = await getCharacter(cid, casterId);
      if (!char) return;

      const castCost = spell.combat?.actionCostOverride ?? actionCostFromCastingTime(spell.castingTime);
      if (castCost && castCost !== 'reaction' && !trySpendAction(cid, casterId, castCost)) return;

      // Redirecting an already-sustained spell (Hunter's Mark, Witch Bolt) is free — no slot, per RAW.
      const free = await isConcentratingOn(cid, casterId, spell.name);
      if (!free && !(await trySpendSpellSlot(cid, casterId, char, slotLevel))) {
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
      if (parseRangeFeet(spell.range) === 0 && targetIds.length === 1 && targetIds[0] === casterId) {
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
            io.to(ROOM).emit('combat:effect:aura:start', { casterId, casterName, color: combat.auraColor, style: combat.auraStyle });
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
          if (combat?.grantsCompanion) await grantCompanion(cid, casterId, casterName, combat.grantsCompanion);
          if (combat?.followingObject) placeFollowingObject(cid, casterId, casterName, combat.followingObject);
          const msg = { text: `${casterName} casts ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
          void appendChatLog(cid, msg);
          io.to(ROOM).emit('chat:message', msg);
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
        placeHazardCells(cid, originGx, originGy, combat.area?.size ?? 20, { obscures: true, durationRounds: combat.obscuresArea.durationRounds }, encounter.currentRound?.number ?? 1, combat.hazardVisual);
        const msg = { text: `${casterName} casts ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void appendChatLog(cid, msg);
        io.to(ROOM).emit('chat:message', msg);
      }

      if (combat?.placesIllusion && originGx !== undefined && originGy !== undefined) {
        placeIllusionMarker(cid, casterName, spell, originGx, originGy);
        const msg = { text: `${casterName} casts ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void appendChatLog(cid, msg);
        io.to(ROOM).emit('chat:message', msg);
      }

      if (combat?.autoHit || !combat?.save) {
        const hookOwnerIsCaster = !!combat?.autoHit;
        const healAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
        const healAbilityMod = statMod(char.stats[healAbility]);
        // Computed even for spells with no save of their own — a plain-hooks spell can still
        // carry a hook that rolls its own save later (Sanctuary's sanctuaryWard, read via ctx.dc
        // same as recurringDamage's saveToEnd), frozen at the caster's stats now same as any DC.
        const dc = 8 + (char.proficiencyBonus ?? 2) + statMod(char.stats[CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int']);
        const currentWorldTimeSecs = combat?.hooks?.length ? await getWorldTimeSecs(cid) : undefined;
        let first = true;
        for (const targetId of targetIds) {
          if (!first) await sleep(500);
          first = false;
          if (!combatState.get(cid)) return;

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
            io.to(ROOM).emit('combat:effect:impact', { targetId, targetName: participant.name, color: visual.color, style: visual.style });
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
          void appendChatLog(cid, msg);
          io.to(ROOM).emit('chat:message', msg);
        }

        if (requiresConcentration(spell)) {
          await startConcentrating(cid, casterId, spell.name, hookOwnerIsCaster ? [casterId] : targetIds);
        }
        return;
      }

      await engine.trigger('beforeSpellCast', {
        casterId, casterName, spellName: spell.name,
        spellLevel: spell.level, slotLevel, targetIds,
      });

      const casterSpellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      const casterAbilityMod = statMod(char.stats[casterSpellAbility]);
      const charProf = char.proficiencyBonus ?? 2;
      const dc = 8 + charProf + casterAbilityMod;

      const saveAbility = combat?.save?.ability ?? casterSpellAbility;
      const halfOnSave = combat?.save?.halfOnSave ?? false;
      // Command's actual effect depends on which word was chosen — see commandEffectsFor.
      const command = spell.name === 'Command' ? commandEffectsFor(chosenCommand) : undefined;
      const effectiveOnHit = command?.onHit ?? combat?.onHit;
      const effectiveHooks = command?.hooks ?? combat?.hooks;

      if (combat?.difficultTerrain && originGx !== undefined && originGy !== undefined) {
        placeHazardCells(cid, originGx, originGy, combat.area?.size ?? 10, combat.difficultTerrain, encounter.currentRound?.number ?? 1, combat.hazardVisual);
      }

      const chars = await listCharacters(cid);
      const outcomes: SpellSaveOutcome[] = [];
      const hookedTargetIds: string[] = [];
      const currentWorldTimeSecs = effectiveHooks?.length ? await getWorldTimeSecs(cid) : undefined;

      let firstTarget = true;
      for (const targetId of targetIds) {
        if (!firstTarget) await sleep(500);
        firstTarget = false;
        if (!combatState.get(cid)) return;

        const participant = encounter.findParticipant(targetId);
        if (!participant || participant.isDead()) continue;

        let saveBonus: number;
        let targetChar: Character | undefined;
        if (participant.isPlayer) {
          targetChar = chars.find(c => c.id === targetId || c.name === participant.name);
          if (!targetChar) continue;
          const mod = statMod(targetChar.stats[saveAbility]);
          const classSaves: readonly string[] = CLASS_SAVING_THROWS[targetChar.class] ?? [];
          const proficient = classSaves.includes(saveAbility);
          saveBonus = mod + (proficient ? (targetChar.proficiencyBonus ?? 2) : 0);
        } else {
          saveBonus = participant.creature ? statMod(participant.creature.stats[saveAbility]) : 0;
        }

        const saveMode = rollModeFor(targetChar ?? participant.creature ?? {}, 'save', saveAbility);
        const d20 = new D20Roll({ withDisadvantage: saveMode < 0, withAdvantage: saveMode > 0 }).roll();
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
        if (!combatState.get(cid)) return;

        // Re-derived from the context, so a hook that moved the DC or the bonus is reflected
        // before afterSave (and everything downstream) reads the outcome.
        saveCtx.total = saveCtx.d20 + saveCtx.saveBonus;
        saveCtx.saved = saveCtx.total >= saveCtx.dc;
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
          void appendChatLog(cid, cmdMsg);
          io.to(ROOM).emit('chat:message', cmdMsg);
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
          const positions0 = tokenPositions.get(cid) ?? {};
          const casterPos0 = positions0[casterName] ?? positions0[casterId];
          const targetPos0 = positions0[targetId] ?? positions0[participant.name];
          if (casterPos0 && targetPos0) {
            const dungeon0 = dungeons.get(cid);
            const occupied0 = new Set(
              Object.entries(positions0).filter(([id]) => id !== targetId && id !== participant.name).map(([, p]) => `${p.gx},${p.gy}`),
            );
            const dryMove = resolveForcedMovement(
              dungeon0?.cells, occupied0, targetPos0.gx, targetPos0.gy, casterPos0.gx, casterPos0.gy,
              forcedMove.distance, forcedMove.type === 'pull' ? 'pull' : 'push',
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
          const positions = tokenPositions.get(cid) ?? {};
          const casterPos = positions[casterName] ?? positions[casterId];
          const targetKey = positions[targetId] ? targetId : participant.name;
          const targetPos = positions[targetKey];
          if (casterPos && targetPos) {
            const dungeon = dungeons.get(cid);
            const occupied = new Set(
              Object.entries(positions)
                .filter(([id]) => id !== targetKey)
                .map(([, p]) => `${p.gx},${p.gy}`),
            );
            const moved = resolveForcedMovement(
              dungeon?.cells, occupied, targetPos.gx, targetPos.gy, casterPos.gx, casterPos.gy,
              forcedMove.distance, forcedMove.type === 'pull' ? 'pull' : 'push',
            );
            if (moved.gx !== targetPos.gx || moved.gy !== targetPos.gy) {
              positions[targetKey] = moved;
              tokenPositions.set(cid, positions);
              io.to(ROOM).emit('token:moved', { tokenId: targetKey, gx: moved.gx, gy: moved.gy });
            }
          }
        }

        // Plays whenever the spell actually landed on this target — damage, or (on a failed
        // save) a lingering condition/hook/forced-move with no damage of its own (Faerie Fire).
        if (damage !== undefined || !saved) {
          const visual = impactVisualFor(spell.combat, rolledDamage?.damageType);
          io.to(ROOM).emit('combat:effect:impact', { targetId, targetName: participant.name, color: visual.color, style: visual.style });
        }

        outcomes.push({
          targetId,
          targetName: participant.name,
          isPC: participant.isPlayer,
          roll,
          saveBonus,
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
      io.to(ROOM).emit('combat:spell:save:result', result);

      if (outcomes.length) {
        void (async () => {
          try {
            const config = await getConfig();
            if (!hasFeatureProvider(config, 'combatNarration')) return;
            const flavour = await generateSpellSaveFlavour(result, getFeatureProvider(config, 'combatNarration'));
            if (!flavour) return;
            const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
            await appendChatLog(cid, msg);
            io.to(ROOM).emit('chat:message', msg);
          } catch (err) { logError('index:combatFlavour', err); }
        })();
      }
    })();
  });

  socket.on('combat:reaction:respond', ({ requestId, spellName }) => {
    resolveReaction(requestId, spellName);
  });

  socket.on('combat:turn:end', () => {
    const encounter = encounters.get(campaignId);
    const actor = encounter?.currentActor;
    console.log(`[turn] combat:turn:end received — currentActor=${actor?.name ?? 'none'} isPlayer=${actor?.isPlayer}`);
    if (actor?.isPlayer) {
      // Unused on-hit buffs (e.g. Divine Smite) expire if not spent by end of turn.
      const bonuses = pendingWeaponBonuses.get(campaignId);
      if (bonuses?.[actor.id]) {
        delete bonuses[actor.id];
        io.to(ROOM).emit('combat:effect:aura:end', { casterId: actor.id, casterName: actor.name });
      }
      advanceTurn(campaignId);
    }
  });
}
