import type { Character, EffectSpec, CreatureType, Condition as ConditionName, ActiveCondition, AbilityKey, TrapEffect, SpellSaveResult } from 'shared';
import { statMod, calcAC, spellSlotsForClass, CLASS_SAVING_THROWS, CLASS_WEAPON_PROFS, findPath, hasOriginFeat, isWeapon, SKILL_ABILITY } from 'shared';
import { getCharacter, updateCharacter, readChatLog, appendChatLog, saveEncounter, clearEncounter, clearDungeon, saveDungeon, listCharacters, loadPartyAllies, readQuests, writeQuests, readManifest, readNemeses, getConfig } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateCombatFlavour, evaluateNemesisCandidates } from '../session-processor/imagePrompts.ts';
import { toClientDungeon } from '../dungeon/index.ts';
import { Team, Participant } from '../domain/encounter.ts';
import { Creature } from '../domain/creature.ts';
import { logError, logDebug } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, campaignPlayers, playerSocketIds, enemiesReady, combatStartedAt, combatScores, dungeons, pendingWeaponBonuses, microDungeons, connected, withLivePositions, getStateEngine, stateEngines } from '../state.ts';
import { D20Roll, rollDice, fmtMod, calcMaxHp, crToXp, rollApplicableDamage } from './dice.ts';
import { rollModeFor, addCondition, removeCondition, attackModeAgainstTarget, combineModes } from './conditions/rollModeFor.ts';
import { ReactionOfferHook } from './stateEngine/hooks/ReactionOfferHook.ts';
import { RetaliationOfferHook } from './stateEngine/hooks/RetaliationOfferHook.ts';
import { offerReaction } from './stateEngine/reactionPrompt.ts';
import { DamageResistanceHook } from './stateEngine/hooks/DamageResistanceHook.ts';
import type { AttackerDisadvantageHook } from './stateEngine/hooks/AttackerDisadvantageHook.ts';
import type { SanctuaryWardHook } from './stateEngine/hooks/SanctuaryWardHook.ts';
import type { SpeedModifierHook } from './stateEngine/hooks/SpeedModifierHook.ts';
import type { ActionUnlockHook } from './stateEngine/hooks/ActionUnlockHook.ts';
import type { GameTimeExpiryHook } from './stateEngine/hooks/ExpiryHook.ts';
import { RecurringDamageHook } from './stateEngine/hooks/RecurringDamageHook.ts';
import type { ConditionImmunityHook } from './stateEngine/hooks/ConditionImmunityHook.ts';
import type { RollModifierHook } from './stateEngine/hooks/RollModifierHook.ts';
import type { IllusionTagHook } from './stateEngine/hooks/IllusionTagHook.ts';
import type { IlluminationSourceHook } from './stateEngine/hooks/IlluminationSourceHook.ts';
import { findSpell } from '../routes/spells.ts';
import { applyEffects } from '../effects.ts';
import { endSession, dispatchDMResponse } from '../session.ts';
import type { TacticalContext } from './ai/types.ts';
import { generatePlans } from './ai/planGenerator.ts';
import { evaluatePlans, actionRangeFt, findAction } from './ai/planEvaluator.ts';
import { selectPlan } from './ai/planSelector.ts';
import { executeSpecialAction } from './ai/executor.ts';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isOccupied(positions: Record<string, { gx: number; gy: number }>, gx: number, gy: number, excludeId: string): boolean {
  return Object.entries(positions).some(([id, p]) => id !== excludeId && p.gx === gx && p.gy === gy);
}

/** Pushes a participant's remaining action economy to the room so the combat dock can show it. */
export function emitResources(participant: Participant): void {
  io.to(ROOM).emit('combat:player:resources', {
    characterId: participant.id,
    actionsRemaining: participant.actionsRemaining,
    bonusActionsRemaining: participant.bonusActionsRemaining,
    reactionsRemaining: participant.reactionsRemaining,
  });
}

/**
 * Blade Ward's "-1d4 from the attacker's roll" — sums every rollModifierVsAttacker hook the
 * DEFENDER owns and rerolls each fresh, same as Bless/Bane's own-roll query (see
 * RollModifierHook), just read off the target instead of the attacker. Called at every real
 * attack-roll site (weapon, spell, enemy AI, Opportunity Attack) so Blade Ward applies no matter
 * who or what is attacking its owner.
 */
export function bladeWardPenalty(cid: string, targetId: string): number {
  const mods = getStateEngine(cid).getHooksOwnedBy(targetId, 'rollModifierVsAttacker') as RollModifierHook[];
  return mods.reduce((sum, h) => sum + h.sign * rollDice(`1d${h.dieSize}`), 0);
}

/**
 * Recomputes the loaded dungeon's live `illumination` as max(its authored baseIllumination, every
 * active illuminationSource hook's level) and re-broadcasts the dungeon if it actually changed —
 * a light spell brightens the whole dungeon rather than a local radius (no per-cell light model
 * exists), so this is a single global number, not something per-token. Called right after a spell
 * registers an illuminationSource hook (immediate feedback on cast) and once per turn-start sweep
 * (covers a Dim Light/other timed source expiring — see runTurnStart, which runs after every
 * beforeRound/beforeTurn expiry prune). Cheap no-op when nothing changed.
 */
export function recomputeIllumination(cid: string): void {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const base = dungeon.baseIllumination ?? dungeon.illumination ?? 1;
  const sources = getStateEngine(cid).getHooksByKind('illuminationSource') as IlluminationSourceHook[];
  const effective = sources.reduce((max, h) => Math.max(max, h.level), base);
  if (effective === (dungeon.illumination ?? 1)) return;
  dungeon.illumination = effective;
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
}

/**
 * Sets or clears a character's light emission (a held torch) and re-broadcasts the dungeon if it
 * actually changed — same broadcast convention as recomputeIllumination, but keyed per-character
 * rather than a single global scalar since each light source has its own position (resolved
 * client-side from the live token position; see Dungeon.lightSources and Canvas.tsx's litCells).
 * `tokenKey` must be the character's *name*, not id — tokenPositions/dungeon.positions are keyed
 * by name for player tokens (see GamePage.tsx's `tokenPositions[character.name]`), and litCells
 * looks up `tokenPositions[key]` for every entry in lightSources — an id key would never resolve.
 * Called on equip/unequip (socketHandlers/inventory.ts) — a rare user action, so unlike
 * recomputeIllumination there's no cheap-no-op guard here, it just always re-broadcasts.
 */
export function setLightSourceFor(cid: string, tokenKey: string, rangeFt: number): void {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const lightSources = { ...dungeon.lightSources };
  if (rangeFt > 0) lightSources[tokenKey] = rangeFt; else delete lightSources[tokenKey];
  dungeon.lightSources = lightSources;
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
}

/**
 * Refills the incoming actor's action economy and fires `beforeTurn`. Shared by the combat-start
 * path and every turn advance, so the very first actor of a fight gets the same treatment as
 * everyone after them.
 */
async function runTurnStart(cid: string): Promise<void> {
  const encounter = encounters.get(cid);
  const actor = encounter?.currentActor;
  if (!encounter || !actor) return;
  actor.refillResources();
  emitResources(actor);
  await getStateEngine(cid).trigger('beforeTurn', {
    participantId: actor.id,
    participantName: actor.name,
    isPlayer: actor.isPlayer,
    round: encounter.currentRound?.number ?? 1,
  });
  recomputeIllumination(cid);
}

/**
 * Starts the fight once every expected participant has rolled initiative. Previously this guard
 * plus beginCombat/emitTurn was copy-pasted into both the initiative paths (addToTurnOrder's
 * callback and the combat:initiative:roll handler); they now share this one function so the
 * beforeCombat stage cannot fire on one path and not the other.
 */
export function tryBeginCombat(cid: string): void {
  const encounter = encounters.get(cid);
  if (!encounter) return;
  const expected = encounter.expectedParticipantCount;
  if (expected <= 0 || encounter.turnOrder.length < expected || encounter.currentRound || !enemiesReady.get(cid)) return;

  encounter.beginCombat();
  void (async () => {
    await getStateEngine(cid).trigger('beforeCombat', { round: encounter.currentRound?.number ?? 1 });
    if (!combatState.get(cid)) return;
    await runTurnStart(cid);
    if (!combatState.get(cid)) return;
    emitTurn(cid);
  })();
}

export function emitTurn(cid: string) {
  if (!combatState.get(cid)) return;
  const encounter = encounters.get(cid);
  if (!encounter) return;

  if (encounter.allPlayersDown()) {
    endCombatDefeated(cid);
    return;
  }

  const actor = encounter.currentActor;
  if (!actor) return;
  console.log(`[turn] emitTurn: actor=${actor.name} idx=${encounter.turnOrder.indexOf(actor)} order=[${encounter.turnOrder.map(p => p.name).join(',')}]`);
  // Wardaway's halved speed (multiplier) / Longstrider's +10ft (bonusFt) — the client applies
  // both to its own known base speed rather than the server tracking base speed itself
  // (players/creatures store it differently): bonuses sum first, then the multiplier applies to
  // that total, so a halved-and-lengthened stride still halves the boosted number. Multiple
  // stacked modifiers of the same kind combine the same way (multiply / sum).
  const speedHooks = getStateEngine(cid).getHooksOwnedBy(actor.id, 'speedModifier') as SpeedModifierHook[];
  const speedMultiplier = speedHooks.reduce((mult, h) => mult * h.multiplier, 1);
  const speedBonusFt = speedHooks.reduce((sum, h) => sum + h.bonusFt, 0);
  // Extra HUD actions unlocked this turn (Expeditious Retreat's Dash-as-Bonus-Action, Jump) —
  // CombatDock's ACTION_UNLOCKS table turns each string into a button. Generic on purpose: a
  // future feat adds an `action` string and a table entry, nothing here changes.
  const buffs = (getStateEngine(cid).getHooksOwnedBy(actor.id, 'actionUnlock') as ActionUnlockHook[]).map(h => h.action);
  io.to(ROOM).emit('combat:turn', {
    actorName: actor.name,
    ...(speedMultiplier !== 1 ? { speedMultiplier } : {}),
    ...(speedBonusFt !== 0 ? { speedBonusFt } : {}),
    ...(buffs.length ? { buffs } : {}),
  });

  if (!actor.isPlayer) {
    setTimeout(() => void runEnemyAI(cid, actor), 800);
  } else if (actor.isDown()) {
    setTimeout(() => void runDeathSave(cid, actor), 800);
  }
}

export async function runDeathSave(cid: string, actor: Participant): Promise<void> {
  if (!combatState.get(cid)) return;
  const encounter = encounters.get(cid);
  if (!encounter) return;

  const participant = encounter.findParticipant(actor.id);
  if (!participant) return;
  const saves = participant.deathSaves;

  if (saves.stable) { advanceTurn(cid); return; }

  const roll = new D20Roll().roll();
  const isNat20 = roll === 20;
  const isNat1 = roll === 1;
  let stable = false;
  let dead = false;

  if (isNat20) {
    participant.currentHp = 1;
    void updateCharacter(cid, actor.id, c => ({ ...c, currentHp: 1 }));
    io.to(ROOM).emit('combat:player:damage', {
      characterId: actor.id,
      characterName: actor.name,
      damage: -1,
      currentHp: 1,
      maxHp: participant.maxHp,
      tempHp: participant.tempHp,
    });
    saves.successes = 3;
    stable = true;
    saves.stable = true;
  } else if (isNat1) {
    saves.failures = Math.min(3, saves.failures + 2);
  } else if (roll >= 10) {
    saves.successes = Math.min(3, saves.successes + 1);
  } else {
    saves.failures = Math.min(3, saves.failures + 1);
  }

  if (!stable && saves.successes >= 3) { stable = true; saves.stable = true; }
  if (saves.failures >= 3) dead = true;

  const saveData = {
    characterName: actor.name, roll, isNatural20: isNat20, isNatural1: isNat1,
    success: roll >= 10, successes: saves.successes, failures: saves.failures, stable, dead,
  };
  const socketId = playerSocketIds.get(actor.id);
  if (socketId) io.to(socketId).emit('combat:death:save', saveData);

  if (dead) {
    await markPlayerDead(cid, participant, actor.id);
  } else if (stable && !isNat20) {
    const stableMsg = { text: `${actor.name} has stabilized.`, senderName: 'Combat', timestamp: Date.now() };
    io.to(ROOM).emit('chat:message', stableMsg);
    void appendChatLog(cid, stableMsg);
  } else if (isNat20) {
    const miracleMsg = { text: `${actor.name} surges back to life!`, senderName: 'Combat', timestamp: Date.now() };
    io.to(ROOM).emit('chat:message', miracleMsg);
    void appendChatLog(cid, miracleMsg);
  }

  await delay(1500);
  advanceTurn(cid);
}

/**
 * Spare the Dying's "the creature becomes Stable" — sets deathSaves.stable directly instead of
 * rolling, same shape runDeathSave's nat-20/3-successes branches already leave behind. Player-only:
 * creatures have no death-save tracking in this engine (they just die outright at 0 HP), so this
 * silently no-ops for a non-player target, an already-stable one, one that's still standing, or
 * one that's already truly dead (3 failures).
 */
export async function stabilizeParticipant(cid: string, participant: Participant): Promise<void> {
  if (!participant.isPlayer || !participant.isDown() || participant.isDead() || participant.deathSaves.stable) return;
  participant.deathSaves.stable = true;
  const socketId = playerSocketIds.get(participant.id);
  if (socketId) {
    io.to(socketId).emit('combat:death:save', {
      characterName: participant.name, roll: 0, isNatural20: false, isNatural1: false,
      success: true, successes: participant.deathSaves.successes, failures: participant.deathSaves.failures,
      stable: true, dead: false,
    });
  }
  const stableMsg = { text: `${participant.name} has stabilized.`, senderName: 'Combat', timestamp: Date.now() };
  io.to(ROOM).emit('chat:message', stableMsg);
  void appendChatLog(cid, stableMsg);
}

export async function runEnemyAI(cid: string, actor: Participant): Promise<void> {
  if (!combatState.get(cid)) return;
  const encounter = encounters.get(cid);
  if (!encounter) return;

  const creature = encounter.findCreature(actor.id);
  if (!creature) return advanceTurn(cid);

  const positions = tokenPositions.get(cid) ?? {};
  const epos = positions[actor.id];
  if (!epos) {
    console.log(`[ai] ${actor.name} has no position, skipping turn`);
    await delay(400);
    return advanceTurn(cid);
  }

  // Layered decision: generatePlans seeds candidates off the creature's role (roleConfig.ts),
  // evaluatePlans scores each on the shared 0-20 "party impact" currency, selectPlan picks the
  // best one the creature is smart enough to find (bounded by its INT score, capped at 20) —
  // see combat/ai/ for the full pipeline. Replaces the old "nearest enemy, random attack" loop.
  const round = encounter.currentRound?.number ?? 1;
  const tacticalCtx: TacticalContext = { cid, actor, positions, allParticipants: encounter.turnOrder, round };
  const scoredPlans = evaluatePlans(generatePlans(tacticalCtx), tacticalCtx);
  if (!scoredPlans.length) return advanceTurn(cid);
  const plan = selectPlan(scoredPlans, creature.stats.int);

  const target = encounter.turnOrder.find(p => p.id === plan.targetId);
  if (!target) return advanceTurn(cid);
  // Players use name as token key; non-players (allies included) use id.
  const targetPosKey = target.isPlayer ? target.name : target.id;
  const targetPos = positions[targetPosKey];

  let { gx, gy } = epos;
  // Restrained: speed 0, can't move — still gets its action if already in range.
  const maxSteps = creature.conditions?.some(c => c.name === 'Restrained') ? 0 : Math.floor(creature.speed / 5);
  const rangeFt = actionRangeFt(creature, plan.actionRef);

  if (plan.movement !== 'hold' && targetPos && maxSteps > 0) {
    // Retreat walks toward a point mirrored away from the target instead of toward it — same
    // path/greedy-step machinery either direction, just a different destination.
    const destination = plan.movement === 'retreat'
      ? { gx: gx + Math.sign(gx - targetPos.gx) * maxSteps, gy: gy + Math.sign(gy - targetPos.gy) * maxSteps }
      : targetPos;

    // Wall-aware route when a dungeon grid is loaded — walked one cell at a time so it can still
    // stop early (in range of target) or pull up short of an occupied cell. No grid (arena combat)
    // falls back to the old greedy step-toward-destination walk, same as before.
    const cells = dungeons.get(cid)?.cells;
    const path = cells ? findPath(cells, gx, gy, destination.gx, destination.gy) : null;

    for (let step = 0; step < maxSteps; step++) {
      if (plan.movement === 'approach') {
        const distFt = Math.max(Math.abs(targetPos.gx - gx), Math.abs(targetPos.gy - gy)) * 5;
        if (distFt <= rangeFt) break;
      }

      const pos = tokenPositions.get(cid) ?? {};
      let next: { gx: number; gy: number } | undefined;
      if (cells) {
        next = path?.[step];
        if (!next || isOccupied(pos, next.gx, next.gy, actor.id)) break;
      } else {
        const dx = Math.sign(destination.gx - gx);
        const dy = Math.sign(destination.gy - gy);
        const candidates = [
          { gx: gx + dx, gy: gy + dy },
          { gx: gx + dx, gy },
          { gx,          gy: gy + dy },
        ].filter(c => c.gx >= 0 && c.gy >= 0 && !isOccupied(pos, c.gx, c.gy, actor.id));
        next = candidates[0];
        if (!next) break;
      }

      gx = next.gx;
      gy = next.gy;

      await delay(220);
      if (!combatState.get(cid)) return;

      const updatedPos = tokenPositions.get(cid) ?? {};
      updatedPos[actor.id] = { gx, gy };
      tokenPositions.set(cid, updatedPos);
      io.to(ROOM).emit('token:moved', { tokenId: actor.id, gx, gy });
      await checkTrapAt(cid, gx, gy, actor.id, actor.name, false);
      if (!combatState.get(cid)) return;
      // maxSteps was fixed before this loop started off the pre-move speed — a trap sprung
      // mid-walk (Snare) needs its own check here, or a restrained creature just keeps stepping
      // for the rest of its already-decided move.
      if (creature.conditions?.some(c => c.name === 'Restrained')) break;
    }
  }

  const finalDistFt = targetPos ? Math.max(Math.abs(targetPos.gx - gx), Math.abs(targetPos.gy - gy)) * 5 : 0;

  if (finalDistFt <= rangeFt) {
    if (plan.actionRef.source === 'action') {
      const action = findAction(creature, plan.actionRef);
      if (action) await executeSpecialAction(cid, actor, action, target, round);
    } else {
      const atk = creature.attacks[plan.actionRef.index];
      const targetParticipant = target;

      if (atk) {
        let targetAc: number;
        let targetCharForAttack: Awaited<ReturnType<typeof listCharacters>>[number] | undefined;

        if (targetParticipant.isPlayer) {
          const chars = await listCharacters(cid);
          targetCharForAttack = chars.find(c => c.name === targetParticipant.name);
          targetAc = targetCharForAttack ? calcAC(targetCharForAttack) : 10;
        } else {
          targetAc = encounter.findCreature(targetParticipant.id)?.ac ?? 10;
        }

        const engine = getStateEngine(cid);
        const targetKeyId = targetParticipant.isPlayer
          ? (targetCharForAttack?.id ?? targetParticipant.id)
          : targetParticipant.id;
        const targetHolder = targetParticipant.isPlayer ? targetCharForAttack : encounter.findCreature(targetParticipant.id);
        // Protection from Evil and Good — disadvantage imposed on the warded target's attacker
        // when the attacker's own creature type is on the spell's list, checked pre-roll same as
        // grantAdvantage (the d20 is already picked by the time beforeAttackRoll's chain runs).
        const wardedAgainst = engine.getHooksOwnedBy(targetKeyId, 'attackerDisadvantage')
          .some(h => (h as AttackerDisadvantageHook).appliesTo(creature.creatureType ?? 'Humanoid'));
        const mode = combineModes(rollModeFor(creature, 'attack'), attackModeAgainstTarget(targetHolder ?? {}), wardedAgainst ? -1 : 0);
        const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
        const attackBonus = atk.bonus + bladeWardPenalty(cid, targetKeyId);

        // Two-phase resolution: roll, let the afterAttackRoll chain run (which may suspend here for
        // several seconds while the defender decides whether to spend a reaction), then re-derive
        // the outcome from the possibly-modified context. Nothing is broadcast until after this, so
        // the client never renders a hit that a reaction later turns into a miss.
        const atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
          attackerId: actor.id,
          attackerName: actor.name,
          targetId: targetKeyId,
          targetName: targetParticipant.name,
          targetIsPlayer: targetParticipant.isPlayer,
          sourceName: atk.name,
          d20: roll,
          attackBonus,
          ac: targetAc,
          total: roll + attackBonus,
          hit: roll + attackBonus >= targetAc,
        }));
        if (!combatState.get(cid)) return;

        atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
        atkCtx.hit = atkCtx.total >= atkCtx.ac;

        // Sanctuary — only worth checking on a roll that would otherwise land; a miss doesn't
        // need the save. ponytail: no retargeting (RAW lets the attacker pick a new target
        // instead) — a failed save just wastes the attack, same as if nothing else were in range.
        if (atkCtx.hit && !(await checkSanctuary(cid, actor.id, targetKeyId, targetParticipant.name))) {
          atkCtx.hit = false;
          console.log(`[ai] ${actor.name}'s attack on ${targetParticipant.name} fails — Sanctuary`);
        }

        const total = atkCtx.total;
        const hit = atkCtx.hit;
        targetAc = atkCtx.ac;
        let damage: number | undefined;
        let remainingHp: number | undefined;
        let targetDead = false;

        if (hit) {
          const dmgCtx = await engine.trigger('beforeDamage', {
            sourceId: actor.id,
            targetId: targetKeyId,
            targetName: targetParticipant.name,
            amount: rollDice(atk.damage),
            damageType: undefined,
            sourceName: atk.name,
          });
          damage = Math.max(0, dmgCtx.amount);

          if (targetParticipant.isPlayer && targetCharForAttack) {
            const playerParticipant = encounter.players.find(p => p.id === targetCharForAttack!.id);
            if (playerParticipant) {
              await applyDamageToPlayer(cid, playerParticipant, damage, {
                charId: targetCharForAttack.id,
                sourceId: actor.id,
              });
              remainingHp = playerParticipant.currentHp;
              targetDead = playerParticipant.currentHp <= 0;
              console.log(`[ai] ${actor.name} attacks ${targetParticipant.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — HIT ${damage} (${playerParticipant.currentHp}/${playerParticipant.maxHp} HP)`);
            }
          } else {
            // Ally or other non-player target — use creature damage path
            await applyDamageToCreature(cid, targetParticipant.id, damage, { sourceId: actor.id });
            remainingHp = encounter.findCreature(targetParticipant.id)?.currentHp;
            targetDead = encounter.findCreature(targetParticipant.id)?.isDead() ?? false;
          }

          await engine.trigger('afterDamage', dmgCtx);
        } else {
          console.log(`[ai] ${actor.name} attacks ${targetParticipant.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — MISS`);
        }

        const targetId = targetParticipant.isPlayer ? (targetCharForAttack?.id ?? targetParticipant.name) : targetParticipant.id;
        io.to(ROOM).emit('combat:attack:result', {
          attackerName: actor.name, targetName: targetParticipant.name, targetId,
          weaponName: atk.name, isMelee: true, d20: roll, attackBonus: atk.bonus, statBonus: atk.bonus, statName: 'Attack', weaponBonus: 0, total, ac: targetAc,
          hit, damage, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead,
        });

        const cfg = await getConfig();
        const cfgAdapter = getFeatureProvider(cfg, 'combatNarration');
        {
          const atkResult = {
            attackerName: actor.name, targetName: targetParticipant.name, targetId,
            // Monster attacks aren't modeled with a range yet (see EnemyStatBlock.attacks) — the client
            // only reads isMelee for player-sourced swing effects, so this is inert here regardless.
            weaponName: atk.name, isMelee: true, d20: roll, attackBonus: atk.bonus, statBonus: atk.bonus, statName: 'Attack', weaponBonus: 0, total, ac: targetAc,
            hit, damage, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead,
          };
          const flavour = await generateCombatFlavour(atkResult, cfgAdapter);
          if (flavour) {
            const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
            io.to(ROOM).emit('chat:message', msg);
            void appendChatLog(cid, msg);
          }
        }
      }
    }
  } else {
    console.log(`[ai] ${actor.name} cannot reach ${target.name} (${finalDistFt}ft away)`);
  }

  await delay(600);
  advanceTurn(cid);
}

/**
 * Single place a player character is declared dead. Both routes here (failing a third death save,
 * and being hit while already at 0 HP) used to inline these same three emits, which meant an
 * `onKill` hook wired into one would silently miss the other.
 */
export async function markPlayerDead(cid: string, participant: Participant, charId: string, sourceId?: string): Promise<void> {
  io.to(ROOM).emit('combat:player:dead', { characterId: charId, characterName: participant.name });
  const deadMsg = { text: `${participant.name} has perished.`, senderName: 'Combat', timestamp: Date.now() };
  io.to(ROOM).emit('chat:message', deadMsg);
  void appendChatLog(cid, deadMsg);
  await getStateEngine(cid).trigger('onKill', {
    participantId: charId, participantName: participant.name, isPlayer: true, sourceId,
  });
}

/**
 * Resolves targetId to whoever holds its live conditions array — a creature or player mid-combat
 * (checked via the live encounter first), or a plain character lookup so conditions still work
 * outside combat — e.g. poisoned by a trap between fights. Every condition mutator (add/remove,
 * concentration) goes through this so there's one place that knows how to find + persist either kind.
 */
export async function conditionsHolder(cid: string, targetId: string): Promise<
  | { label: string; conditions: ActiveCondition[] | undefined; write: (c: ActiveCondition[]) => void }
  | undefined
> {
  const encounter = encounters.get(cid);
  const participant = encounter?.findParticipant(targetId);

  if (participant?.creature) {
    const creature = participant.creature;
    return {
      label: participant.name,
      conditions: creature.conditions,
      write: c => { creature.conditions = c; if (encounter) void saveEncounter(cid, encounter); },
    };
  }

  const charId = participant?.id ?? targetId;
  const char = await getCharacter(cid, charId);
  if (!char) return undefined;
  return {
    label: char.name,
    conditions: char.conditions,
    write: c => { void updateCharacter(cid, charId, cur => ({ ...cur, conditions: c })); },
  };
}

async function setCondition(
  cid: string, targetId: string, name: ConditionName, fn: typeof addCondition,
): Promise<string | undefined> {
  const holder = await conditionsHolder(cid, targetId);
  if (!holder) return undefined;
  const conditions = fn(holder.conditions, name);
  holder.write(conditions);
  io.to(ROOM).emit('character:condition:update', { targetId, conditions });
  return holder.label;
}

export async function applyCondition(cid: string, targetId: string, name: ConditionName): Promise<void> {
  const immune = (getStateEngine(cid).getHooksOwnedBy(targetId, 'conditionImmunity') as ConditionImmunityHook[])
    .some(h => h.immuneConditions.includes(name));
  if (immune) return;

  const label = await setCondition(cid, targetId, name, addCondition);
  if (!label) return;
  console.log(`[condition] ${label} gains ${name}`);
  const msg = { text: `${label} is now ${name}.`, senderName: 'System', timestamp: Date.now() };
  void appendChatLog(cid, msg);
  io.to(ROOM).emit('chat:message', msg);
  // 5e: incapacitated ends concentration outright, no save.
  if (name === 'Incapacitated') await breakConcentration(cid, targetId);
}

export async function clearCondition(cid: string, targetId: string, name: ConditionName): Promise<void> {
  // Concentrating carries linked hooks that need tearing down, not just the marker removed.
  if (name === 'Concentrating') return breakConcentration(cid, targetId);

  const label = await setCondition(cid, targetId, name, removeCondition);
  if (!label) return;
  console.log(`[condition] ${label} loses ${name}`);
  const msg = { text: `${label} is no longer ${name}.`, senderName: 'System', timestamp: Date.now() };
  void appendChatLog(cid, msg);
  io.to(ROOM).emit('chat:message', msg);
}

/**
 * Server-side movement authority — previously absent entirely (see the ponytail note on
 * Participant's action-economy fields: the client owns movementRemaining, nothing server-side
 * enforced it). Restrained's "speed 0" is the first thing that actually needs blocking. Resolves
 * tokenId either as a live participant id (enemies/allies) or, for players, the character name
 * token-position convention uses (see checkTrapAt for the same dual-path lookup).
 */
export async function canMove(cid: string, tokenId: string): Promise<boolean> {
  let holder = await conditionsHolder(cid, tokenId);
  if (!holder) {
    const char = (await listCharacters(cid)).find(c => c.name === tokenId);
    if (char) holder = await conditionsHolder(cid, char.id);
  }
  return !holder?.conditions?.some(c => c.name === 'Restrained');
}

// ── Movement triggers & Opportunity Attacks ─────────────────────────────────

const DEFAULT_REACH_FT = 5;

/** Chebyshev distance in feet between two grid cells — same convention as every other range check in this codebase. */
function cellDistFt(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) * 5;
}

/**
 * The movement counterpart to advanceTurn's beforeTurn/afterTurn firing — called once from
 * token:move whenever a tracked participant's token actually lands somewhere new. Drives two
 * independent things: spell-registered `onMove` hooks (Booming Blade) via the normal
 * StateEngine.trigger(), and the innate Opportunity Attack check, which isn't hook-registered at
 * all since every creature with a reaction has it, not just ones a spell touched.
 */
export async function checkMovementTriggers(
  cid: string, moverId: string, fromGx: number, fromGy: number, toGx: number, toGy: number,
): Promise<void> {
  const encounter = encounters.get(cid);
  const mover = encounter?.findParticipant(moverId);
  if (!mover) return;
  const distanceFt = cellDistFt(fromGx, fromGy, toGx, toGy);
  if (distanceFt === 0) return;

  await getStateEngine(cid).trigger('onMove', {
    participantId: moverId, participantName: mover.name, fromGx, fromGy, toGx, toGy, distanceFt,
  });

  if (combatState.get(cid)) await checkOpportunityAttacks(cid, mover, fromGx, fromGy, toGx, toGy);
}

/** Conditions that already strip reactions outright per RAW — the first place any of these four actually block one, rather than just being a narrated marker. */
const REACTION_LOCKING_CONDITIONS = new Set(['Incapacitated', 'Stunned', 'Paralyzed', 'Unconscious']);

/**
 * 2024 PHB: "You can make an Opportunity Attack when a creature that you can see leaves your
 * reach. To make the Opportunity Attack, you use your Reaction to make one melee attack against
 * the provoking creature." Checked against every hostile participant for the mover's team,
 * reach being that participant's equipped/first melee weapon's range (5ft default, 10ft for a
 * reach weapon). A player reactor is offered the choice (same reaction-prompt flow as Shield);
 * an NPC reactor auto-resolves, matching how enemy actions already auto-resolve with no
 * human decision layer behind them.
 *
 * Skipped for a mover who Disengaged this turn (Participant.disengaging) and for a reactor with
 * no reaction available, a reactionLock (Shocking Grasp), or one of the conditions that already
 * strip reactions outright (REACTION_LOCKING_CONDITIONS).
 *
 * ponytail: only checks the two endpoints, not the path between them — a mover who steps into
 * and back out of the same reach zone within one drag won't provoke, and one who passes through
 * a second reach zone mid-move without ending outside it won't either. Real path-stepping would
 * need the client to send intermediate cells (it only ever sends the final destination); upgrade
 * if "walk past two attackers in one drag" turns out to matter more than "walk straight away
 * from one." Also doesn't check line of sight/obscurement (Fog Cloud) — that check lives in
 * combat.ts, not here, and reach is close enough that it rarely matters.
 */
async function checkOpportunityAttacks(
  cid: string, mover: Participant, fromGx: number, fromGy: number, toGx: number, toGy: number,
): Promise<void> {
  if (mover.disengaging || mover.isDead()) return;
  const encounter = encounters.get(cid);
  if (!encounter) return;
  const reactors = mover.teamId === 'players' ? encounter.enemies : encounter.players;
  const positions = tokenPositions.get(cid) ?? {};

  for (const reactor of reactors) {
    if (reactor.isDead() || !reactor.hasResource('reaction')) continue;
    const engine = getStateEngine(cid);
    if (engine.hasHookOwnedBy(reactor.id, 'reactionLock') || engine.hasHookOwnedBy(reactor.id, 'opportunityAttackLock')) continue;
    const holder = await conditionsHolder(cid, reactor.id);
    if (holder?.conditions?.some(c => REACTION_LOCKING_CONDITIONS.has(c.name))) continue;

    const reactorPos = positions[reactor.id] ?? positions[reactor.name];
    if (!reactorPos) continue;

    const reach = await reactorReachFt(cid, reactor);
    const wasInReach = cellDistFt(reactorPos.gx, reactorPos.gy, fromGx, fromGy) <= reach;
    const stillInReach = cellDistFt(reactorPos.gx, reactorPos.gy, toGx, toGy) <= reach;
    if (!wasInReach || stillInReach) continue;

    if (reactor.isPlayer) {
      const picked = await offerReaction(reactor.id, [{
        spellName: 'Attack of Opportunity', attackerName: reactor.name, sourceName: mover.name, kind: 'opportunity',
      }]);
      if (!picked || !combatState.get(cid) || !reactor.hasResource('reaction')) continue;
    }

    reactor.trySpend('reaction');
    emitResources(reactor);
    await resolveOpportunityAttack(cid, reactor, mover);
  }
}

/** Players: their equipped weapon's reach if it's a reach weapon (10ft), else the unarmed-strike default. Creatures: EnemyStatBlock.attacks carries no range/type data at all, so every creature is treated as 5ft reach regardless of what its attacks actually are — a real simplification, upgrade if a ranged-only creature ever needs to NOT get one. */
async function reactorReachFt(cid: string, reactor: Participant): Promise<number> {
  if (!reactor.isPlayer) return DEFAULT_REACH_FT;
  const char = await getCharacter(cid, reactor.id);
  const mainHandId = char?.equipment?.mainHand;
  const item = mainHandId ? char?.inventory?.find(i => i.id === mainHandId) : undefined;
  return item && isWeapon(item) && item.range === 10 ? 10 : DEFAULT_REACH_FT;
}

/**
 * The actual weapon swing an Opportunity Attack resolves into — one melee attack, no ammo spend,
 * no Savage Attacker reroll, no bundled smite (none of those apply to a reflexive reaction swing).
 * Broadcasts the same `combat:attack:result` shape a normal weapon attack does, so it renders
 * identically (hit flash, floating damage) with no client changes needed.
 */
async function resolveOpportunityAttack(cid: string, reactor: Participant, target: Participant): Promise<void> {
  const engine = getStateEngine(cid);
  const encounter = encounters.get(cid);
  if (!encounter) return;

  let weaponName = 'Unarmed Strike';
  let damageFormula = '1';
  let damageType: string | undefined = 'Bludgeoning';
  let attackBonus = 0;
  let statBonus = 0;
  let statName = 'Strength';
  let reactorChar: Character | undefined;

  if (reactor.isPlayer) {
    const char = await getCharacter(cid, reactor.id);
    if (!char) return;
    reactorChar = char;
    const mainHandId = char.equipment?.mainHand;
    const item = mainHandId ? char.inventory?.find(i => i.id === mainHandId) : undefined;
    const weapon = item && isWeapon(item) ? item : undefined;
    const strMod = statMod(char.stats.str);
    const dexMod = statMod(char.stats.dex);
    const isMeleeReach = !weapon || weapon.range <= 10;
    const useDex = isMeleeReach && weapon?.isFinesse && dexMod > strMod;
    statBonus = useDex ? dexMod : strMod;
    statName = useDex ? 'Dexterity' : 'Strength';
    const charProf = char.proficiencyBonus ?? 2;
    const classWeaponProfs = CLASS_WEAPON_PROFS[char.class] ?? [];
    const isProficient = !weapon || weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
    const weaponBonus = (weapon?.attackBonus ?? 0) + (isProficient ? charProf : 0);
    attackBonus = statBonus + weaponBonus;
    weaponName = weapon?.name ?? 'Unarmed Strike';
    damageFormula = weapon?.damage ?? '1';
    damageType = weapon?.damageType ?? 'Bludgeoning';
  } else if (reactor.creature) {
    const atk = reactor.creature.attacks[0];
    if (!atk) return;
    weaponName = atk.name;
    damageFormula = atk.damage;
    damageType = undefined;
    attackBonus = atk.bonus;
    statBonus = atk.bonus;
    statName = 'Attack';
  } else {
    return;
  }

  let targetAc: number;
  let targetChar: Character | undefined;
  if (target.isPlayer) {
    targetChar = (await listCharacters(cid)).find(c => c.id === target.id || c.name === target.name);
    targetAc = targetChar ? calcAC(targetChar) : 10;
  } else {
    targetAc = target.creature?.ac ?? 10;
  }
  const targetKeyId = target.isPlayer ? (targetChar?.id ?? target.id) : target.id;

  const mode = combineModes(
    rollModeFor(reactorChar ?? reactor.creature ?? {}, 'attack'),
    attackModeAgainstTarget(targetChar ?? target.creature ?? {}),
  );
  const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
  attackBonus += bladeWardPenalty(cid, targetKeyId);
  const atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
    attackerId: reactor.id, attackerName: reactor.name,
    targetId: targetKeyId, targetName: target.name, targetIsPlayer: target.isPlayer,
    sourceName: weaponName, d20: roll, attackBonus, ac: targetAc,
    total: roll + attackBonus, hit: roll + attackBonus >= targetAc,
  }));
  if (!combatState.get(cid)) return;
  atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
  atkCtx.hit = atkCtx.total >= atkCtx.ac;

  let damage: number | undefined;
  let remainingHp: number | undefined;
  let targetDead = false;
  if (atkCtx.hit) {
    const dmgCtx = await engine.trigger('beforeDamage', {
      sourceId: reactor.id, targetId: targetKeyId, targetName: target.name,
      amount: rollDice(damageFormula) + (reactor.isPlayer ? statBonus : 0),
      damageType, sourceName: weaponName,
    });
    damage = Math.max(0, dmgCtx.amount);
    if (target.isPlayer && targetChar) {
      await applyDamageToPlayer(cid, target, damage, { charId: targetChar.id, sourceId: reactor.id });
      remainingHp = target.currentHp;
      targetDead = target.currentHp <= 0;
    } else {
      await applyDamageToCreature(cid, target.id, damage, { sourceId: reactor.id });
      remainingHp = encounter.findCreature(target.id)?.currentHp;
      targetDead = encounter.findCreature(target.id)?.isDead() ?? false;
    }
    await engine.trigger('afterDamage', dmgCtx);
  }

  console.log(`[aoo] ${reactor.name} makes an Opportunity Attack on ${target.name}: ${roll}${fmtMod(attackBonus)}=${atkCtx.total} vs AC ${targetAc} — ${atkCtx.hit ? `HIT ${damage}` : 'MISS'}`);
  io.to(ROOM).emit('combat:attack:result', {
    attackerName: reactor.name, targetName: target.name, targetId: targetKeyId,
    weaponName, isMelee: true, d20: roll, attackBonus, statBonus, statName, weaponBonus: attackBonus - statBonus,
    total: atkCtx.total, ac: targetAc, hit: atkCtx.hit, damage, damageFormula: atkCtx.hit ? damageFormula : undefined,
    remainingHp, targetDead,
  });
  const msg = { text: `${reactor.name} makes an Opportunity Attack on ${target.name}${atkCtx.hit ? ` — hit for ${damage}!` : ' — misses.'}`, senderName: 'System', timestamp: Date.now() };
  void appendChatLog(cid, msg);
  io.to(ROOM).emit('chat:message', msg);
}

/**
 * Sanctuary — gate checked directly before an attack roll happens (mirrors canMove), not through
 * the normal Hook trigger chain: RAW cancels the attack outright on a failed save, which has to
 * be decided before the d20 is rolled. No ward on targetId = true (attack proceeds normally).
 */
export async function checkSanctuary(cid: string, attackerId: string, targetId: string, targetName: string): Promise<boolean> {
  const engine = getStateEngine(cid);
  const ward = engine.getHooksOwnedBy(targetId, 'sanctuaryWard')[0] as SanctuaryWardHook | undefined;
  if (!ward) return true;
  const { saved, roll, bonus, total } = await rollSavingThrow(cid, attackerId, 'wis', ward.dc);
  logDebug(`[sanctuary] attack on ${targetName} — attacker save vs DC${ward.dc}: d20=${roll}+${bonus}=${total} — ${saved ? 'SAVE, attack proceeds' : 'FAIL, attack blocked'}`);
  return saved;
}

/**
 * Animal Friendship/Charm Person's "ends if you [the caster] damage it" — checked at the one
 * choke point all damage already funnels through (applyDamageToPlayer/applyDamageToCreature),
 * against every recurringDamage hook targetId owns that opted into `endsIfCasterDamages` and
 * whose casterId matches whoever just hit them. Allies dealing the damage don't break it (RAW
 * says "you or an ally" — not tracked here, see the spell's own todo).
 */
function checkEndsIfCasterDamages(cid: string, targetId: string, sourceId: string | undefined): void {
  if (!sourceId) return;
  const engine = stateEngines.get(cid);
  if (!engine) return;
  for (const hook of engine.getHooksOwnedBy(targetId, 'recurringDamage')) {
    if (hook instanceof RecurringDamageHook && hook.endsIfCasterDamages && hook.casterId === sourceId) {
      void hook.forceEnd(engine);
    }
  }
}

/**
 * Sanctuary "ends if the warded creature makes an attack roll, casts a spell, or deals damage" —
 * called once at the top of the warded creature's own attack/spell-cast, after resource spend
 * succeeds (a blocked action shouldn't cost the ward) but before anything resolves. No ward on
 * actorId = no-op, same as checkSanctuary's "nothing registered" shape.
 */
export async function breakSanctuaryOn(cid: string, actorId: string): Promise<void> {
  const engine = getStateEngine(cid);
  const ward = engine.getHooksOwnedBy(actorId, 'sanctuaryWard')[0];
  if (!ward) return;
  engine.unregister(ward.id);
  const label = encounters.get(cid)?.findParticipant(actorId)?.name ?? actorId;
  console.log(`[sanctuary] ${label}'s Sanctuary ends — they acted`);
  const msg = { text: `${label}'s Sanctuary ends.`, senderName: 'System', timestamp: Date.now() };
  void appendChatLog(cid, msg);
  io.to(ROOM).emit('chat:message', msg);
}

/**
 * The other half of HookDuration's 'gameTime' — round/turn expiries fire off the combat turn
 * loop (ExpiryHook/RoundExpiryHook), but game-time ones have no turn loop to ride during
 * exploration, so nothing fires them automatically. Call this wherever worldTimeSecs actually
 * advances (today: effects.ts's 'advanceTime' narration effect) and it sweeps every campaign
 * with a live StateEngine for GameTimeExpiryHooks whose timestamp has passed. Reusable by any
 * future gameTime spell — it doesn't know or care which one registered a given hook.
 */
export function sweepGameTimeExpiries(cid: string, currentSecs: number): void {
  const engine = stateEngines.get(cid);
  if (!engine) return;
  const due = engine.getHooksByKind('gameTimeExpiry') as GameTimeExpiryHook[];
  for (const hook of due) {
    if (hook.expiresAtSecs > currentSecs) continue;
    void hook.apply({ round: 0 }, engine);
  }
  if (due.length) recomputeIllumination(cid);
}

/** Current worldTimeSecs for a campaign — the anchor a `gameTime` duration's relative `gameSecs` is added to at cast time. */
export async function getWorldTimeSecs(cid: string): Promise<number> {
  const manifest = await readManifest(cid);
  return manifest?.worldTimeSecs ?? 43200;
}

/**
 * Sets targetId's height off the ground. Dropping it 10ft or more (climbing/being lifted down
 * doesn't call this at all — only an actual fall does) rolls 1d6 Bludgeoning per 10ft fallen,
 * capped at 20d6 (RAW), no save, routed through the normal beforeDamage/afterDamage chain so any
 * hook gets a say — specifically DamageResistanceHook keyed to `spellName: 'Falling'`, which is
 * exactly the shape Feather Fall registers (same mechanism Shield already uses against Magic
 * Missile, reused rather than building a fall-specific negation path).
 */
export async function applyElevationChange(cid: string, targetId: string, elevationFt: number): Promise<void> {
  const encounter = encounters.get(cid);
  const participant = encounter?.findParticipant(targetId);
  if (!participant) return;

  const clamped = Math.max(0, elevationFt);
  const fellFt = participant.elevationFt - clamped;
  participant.elevationFt = clamped;
  io.to(ROOM).emit('combat:elevation:update', { targetId, elevationFt: clamped });
  if (fellFt < 10) return;

  // Flying is a controlled descent, not a fall — no damage regardless of how far it drops.
  const holder = await conditionsHolder(cid, targetId);
  if (holder?.conditions?.some(c => c.name === 'Flying')) return;

  const dice = Math.min(20, Math.floor(fellFt / 10));
  const engine = getStateEngine(cid);
  const dmgCtx = await engine.trigger('beforeDamage', {
    sourceId: targetId, targetId, targetName: participant.name,
    amount: rollDice(`${dice}d6`), damageType: 'Bludgeoning', sourceName: 'Falling',
  });
  const damage = Math.max(0, dmgCtx.amount);
  if (damage > 0) {
    if (participant.isPlayer) await applyDamageToPlayer(cid, participant, damage, { sourceId: targetId });
    else await applyDamageToCreature(cid, targetId, damage);
  }
  await engine.trigger('afterDamage', dmgCtx);
  console.log(`[elevation] ${participant.name} falls ${fellFt}ft — ${damage} damage`);
}

/** Drops any Dungeon.hazardCells (Difficult Terrain) whose expiresOnRound has passed — called every time a new round starts (see advanceTurn). */
function pruneExpiredHazardCells(cid: string, round: number): void {
  const dungeon = dungeons.get(cid);
  if (!dungeon?.hazardCells?.length) return;
  const kept = dungeon.hazardCells.filter(h => h.expiresOnRound === undefined || h.expiresOnRound > round);
  if (kept.length === dungeon.hazardCells.length) return;
  dungeon.hazardCells = kept;
  void saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
}

/** Ends whatever targetId is concentrating on — tears down its linked hooks. No-op if not concentrating. */
export async function breakConcentration(cid: string, targetId: string): Promise<void> {
  const holder = await conditionsHolder(cid, targetId);
  const link = holder?.conditions?.find(c => c.name === 'Concentrating')?.concentration;
  if (!holder || !link) return;

  const engine = getStateEngine(cid);
  for (const ownerId of link.targetIds) engine.unregisterBySource(ownerId, link.spellName);
  holder.write(removeCondition(holder.conditions, 'Concentrating'));

  console.log(`[concentration] ${holder.label} loses concentration on ${link.spellName}`);
  const msg = { text: `${holder.label} loses concentration on ${link.spellName}.`, senderName: 'System', timestamp: Date.now() };
  void appendChatLog(cid, msg);
  io.to(ROOM).emit('chat:message', msg);
  io.to(ROOM).emit('combat:concentration', { targetId, targetName: holder.label, spellName: null });
}

/** True when casterId is currently concentrating on exactly spellName — gates free recasts (Hunter's Mark, Witch Bolt). */
export async function isConcentratingOn(cid: string, casterId: string, spellName: string): Promise<boolean> {
  const holder = await conditionsHolder(cid, casterId);
  return holder?.conditions?.find(c => c.name === 'Concentrating')?.concentration?.spellName === spellName;
}

/**
 * Starts casterId concentrating on spellName, sustained via hooks registered on hookedTargetIds.
 * 2024 rules: casting another concentration spell ends the previous one automatically, no choice
 * — so any existing concentration is broken first rather than stacking or being rejected.
 */
export async function startConcentrating(
  cid: string, casterId: string, spellName: string, hookedTargetIds: string[],
): Promise<void> {
  await breakConcentration(cid, casterId);
  const holder = await conditionsHolder(cid, casterId);
  if (!holder) return;
  const withoutOld = removeCondition(holder.conditions, 'Concentrating');
  holder.write([...withoutOld, { name: 'Concentrating', concentration: { spellName, targetIds: hookedTargetIds } }]);
  console.log(`[concentration] ${holder.label} begins concentrating on ${spellName}`);
  io.to(ROOM).emit('combat:concentration', { targetId: casterId, targetName: holder.label, spellName });
}

const CONCENTRATION_MIN_DC = 10;

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
  const modBonus = rollMods.reduce((sum, h) => sum + h.sign * rollDice(`1d${h.dieSize}`), 0);
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

/**
 * Called after damage lands on targetId — if they're concentrating, rolls the Constitution save
 * 5e requires (DC 10 or half the damage taken, whichever is higher) and breaks concentration on a fail.
 */
export async function checkConcentration(cid: string, targetId: string, damage: number): Promise<void> {
  const holder = await conditionsHolder(cid, targetId);
  const link = holder?.conditions?.find(c => c.name === 'Concentrating')?.concentration;
  if (!holder || !link) return;

  const dc = Math.max(CONCENTRATION_MIN_DC, Math.floor(damage / 2));
  const { saved, roll, bonus, total } = await rollSavingThrow(cid, targetId, 'con', dc);
  console.log(`[concentration] ${holder.label} save vs DC${dc}: d20=${roll}${fmtMod(bonus)}=${total} — ${saved ? 'MAINTAINED' : 'BROKEN'}`);
  if (!saved) await breakConcentration(cid, targetId);
}

/**
 * Adds to a player's running Scores tally for the current encounter (combatScores) — in-memory
 * only, not persisted per-hit. Flushed onto the character sheet once in endCombat. Gated on the
 * encounter's own participant.isPlayer (campaignPlayers is keyed by player *name*, not charId,
 * so it can't be used here) — skips allies, enemies, and self-inflicted hazards with no attacker.
 */
function bumpScore(cid: string, charId: string | undefined, field: 'enemiesKilled' | 'damageDealt' | 'damageReceived', amount: number): void {
  if (!charId || !encounters.get(cid)?.findParticipant(charId)?.isPlayer) return;
  let scores = combatScores.get(cid);
  if (!scores) { scores = new Map(); combatScores.set(cid, scores); }
  const entry = scores.get(charId) ?? { enemiesKilled: 0, damageDealt: 0, damageReceived: 0 };
  entry[field] += amount;
  scores.set(charId, entry);
}

/**
 * Applies damage to a player participant and runs everything that follows from it — HP persistence,
 * the damage broadcast, death-save failures for damage taken while down, and the onDown/onKill
 * stages. Shared by enemy attacks, save-based spell damage, and start-of-turn recurring damage.
 */
export async function applyDamageToPlayer(
  cid: string,
  participant: Participant,
  damage: number,
  opts?: { charId?: string; sourceId?: string },
): Promise<void> {
  const charId = opts?.charId ?? participant.id;
  const wasDown = participant.isDown();

  participant.takeDamage(damage);
  void updateCharacter(cid, charId, c => ({ ...c, currentHp: participant.currentHp, tempHp: participant.tempHp }));
  io.to(ROOM).emit('combat:player:damage', {
    characterId: charId,
    characterName: participant.name,
    damage,
    currentHp: participant.currentHp,
    maxHp: participant.maxHp,
    tempHp: participant.tempHp,
  });
  // One event drives the damage float/flash for every source — weapon hit, spell hit, spell-save
  // damage, recurring ticks — since they all funnel through this function to apply HP loss.
  if (damage > 0) io.to(ROOM).emit('combat:damage:dealt', { targetId: charId, targetName: participant.name, damage });
  if (damage > 0) bumpScore(cid, charId, 'damageReceived', damage);
  if (damage > 0) checkEndsIfCasterDamages(cid, charId, opts?.sourceId);

  if (wasDown) {
    // Damage while already at 0 HP burns two death saves (5e: a hit on a downed creature).
    participant.deathSaves.failures = Math.min(3, participant.deathSaves.failures + 2);
    participant.deathSaves.stable = false;
    const nowDead = participant.deathSaves.failures >= 3;
    const socketId = playerSocketIds.get(charId);
    if (socketId) {
      io.to(socketId).emit('combat:death:save', {
        characterName: participant.name, roll: 0, isNatural20: false, isNatural1: false,
        success: false, successes: participant.deathSaves.successes,
        failures: participant.deathSaves.failures, stable: false, dead: nowDead,
      });
    }
    if (nowDead) await markPlayerDead(cid, participant, charId, opts?.sourceId);
    return;
  }

  if (participant.isDown()) {
    // 5e: being incapacitated ends concentration outright, no save.
    await breakConcentration(cid, charId);
    await getStateEngine(cid).trigger('onDown', {
      participantId: charId, participantName: participant.name, isPlayer: true, sourceId: opts?.sourceId,
    });
  } else if (damage > 0) {
    await checkConcentration(cid, charId, damage);
  }
}

/** Applies spell/effect healing to a player and persists/broadcasts the result (Cure Wounds, Healing Word). */
export function applyHealingToPlayer(cid: string, participant: Participant, charId: string, amount: number, sourceName: string): void {
  participant.heal(amount);
  void updateCharacter(cid, charId, c => ({ ...c, currentHp: participant.currentHp }));
  io.to(ROOM).emit('combat:player:heal', {
    characterId: charId,
    characterName: participant.name,
    healAmount: amount,
    currentHp: participant.currentHp,
    maxHp: participant.maxHp,
    sourceName,
  });
}

/** Same as applyHealingToPlayer but for an NPC/ally creature target. */
export function applyHealingToCreature(cid: string, targetId: string, amount: number): void {
  const creature = encounters.get(cid)?.findCreature(targetId);
  if (!creature) return;
  creature.heal(amount);
  io.to(ROOM).emit('creature:update', {
    id: targetId,
    currentHp: creature.currentHp,
    maxHp: creature.hp,
    effects: creature.effects,
  });
}

/**
 * Grants temp HP to a player and persists/broadcasts the result — the one place spell effects
 * (Armor of Agathys, False Life, ...) and consumables should call rather than writing
 * `participant.tempHp = amount` inline. Set semantics (not additive) live in Participant.grantTempHp.
 */
export function grantTempHpToPlayer(cid: string, participant: Participant, amount: number): void {
  participant.grantTempHp(amount);
  void updateCharacter(cid, participant.id, c => ({ ...c, tempHp: participant.tempHp }));
  io.to(ROOM).emit('combat:player:tempHp', {
    characterId: participant.id,
    characterName: participant.name,
    tempHp: participant.tempHp,
  });
}

export async function evaluateNemesisAfterCombat(cid: string): Promise<void> {
  try {
    // Captured synchronously, before any await — endCombat() calls encounter.teardown()
    // right after this function's first await suspends it, which wipes encounter.teams.
    const encounter = encounters.get(cid);
    const enemyParticipants = encounter?.enemies.filter(p => p.creature) ?? [];
    const roster = enemyParticipants.map(p => p.creature!.toStatBlock());
    if (!roster.length) return;
    const statusLines = enemyParticipants.map(p =>
      `${p.name}: ${p.creature!.isDead() ? 'dead' : `${p.creature!.currentHp}/${p.creature!.hp} HP, alive`}`
    );

    const startedAt = combatStartedAt.get(cid) ?? 0;
    const fullLog = await readChatLog(cid);
    const transcript = fullLog.filter(m => m.timestamp >= startedAt);
    if (!transcript.length) return;

    const config = await getConfig();
    if (!hasFeatureProvider(config, 'nemesisGeneration')) return;
    const adapter = getFeatureProvider(config, 'nemesisGeneration');

    const [nemeses, characters] = await Promise.all([readNemeses(cid), listCharacters(cid)]);

    const { candidates } = await evaluateNemesisCandidates(transcript, roster, statusLines, nemeses, characters.map(c => c.name), adapter);
    if (!candidates.length) return;

    // Applied one at a time (not batched) — each does a read-modify-write of the
    // shared nemeses.json, and concurrent candidates would clobber each other's writes.
    for (const c of candidates) {
      const baseline = roster.find(e => e.name.toLowerCase() === c.name.toLowerCase());
      await applyEffects(cid, [{
        type: 'nemesis_create',
        boundTo: c.boundTo,
        name: c.name,
        detail: c.detail,
        ...(baseline ? { statBlock: baseline } : {}),
      }]);
    }
  } catch (err) {
    logError('index:evaluateNemesisAfterCombat', err);
  }
}

export async function endCombat(cid: string): Promise<void> {
  const encounter = encounters.get(cid);
  // Awaited before teardown so afterCombat hooks still see a live encounter.
  const engine = stateEngines.get(cid);
  if (engine) await engine.trigger('afterCombat', { round: encounter?.currentRound?.number ?? 0 });

  void evaluateNemesisAfterCombat(cid);

  // One process: every kill/damage tallied during the fight lands on each character sheet
  // in a single read-modify-write, rather than a write per hit.
  const scores = combatScores.get(cid);
  if (scores) {
    void Promise.all([...scores].map(([charId, s]) =>
      updateCharacter(cid, charId, c => ({
        ...c,
        enemiesKilled: (c.enemiesKilled ?? 0) + s.enemiesKilled,
        damageDealt: (c.damageDealt ?? 0) + s.damageDealt,
        damageReceived: (c.damageReceived ?? 0) + s.damageReceived,
      }))
    ));
  }
  combatScores.delete(cid);

  encounter?.teardown();
  encounters.delete(cid);
  stateEngines.delete(cid);
  combatStartedAt.delete(cid);
  pendingWeaponBonuses.delete(cid);
  void clearEncounter(cid);
}

export function endCombatDefeated(cid: string): void {
  if (!combatState.get(cid)) return;
  combatState.set(cid, false);
  enemiesReady.delete(cid);
  io.to(ROOM).emit('combat:defeat');
  setTimeout(() => {
    void endCombat(cid);
    io.to(ROOM).emit('combat:state', false);
    microDungeons.delete(cid);
    endSession(cid);
  }, 8000);
}

// Resolves a quest by id if it exists and isn't already resolved — shared by every mechanical
// auto-resolve hook (boss death, dungeon exit) so none of them have to remember to emit quest:update.
export async function resolveQuest(cid: string, questId: string): Promise<void> {
  const quests = await readQuests(cid);
  const quest = quests.find(q => q.id === questId);
  if (!quest || quest.status === 'resolved') return;
  quest.status = 'resolved';
  await writeQuests(cid, quests);
  const manifest = await readManifest(cid);
  io.to(ROOM).emit('quest:update', { quests, act: manifest?.act ?? 1 });
}

export async function applyDamageToCreature(cid: string, targetId: string, damage: number, opts?: { sourceId?: string }): Promise<void> {
  const encounter = encounters.get(cid);
  if (!encounter) return;

  const creature = encounter.findCreature(targetId);
  if (!creature || creature.isDead()) return;

  creature.takeDamage(damage);
  // Conjurer's summon action reads this — "unchallenged for N rounds" means rounds since the
  // creature was last actually hit, not since combat started.
  if (damage > 0) creature.lastDamagedRound = encounter.currentRound?.number ?? creature.lastDamagedRound;
  io.to(ROOM).emit('creature:update', {
    id: targetId,
    currentHp: creature.currentHp,
    maxHp: creature.hp,
    effects: creature.effects,
  });
  if (damage > 0) io.to(ROOM).emit('combat:damage:dealt', { targetId, targetName: creature.name, damage });
  if (damage > 0) bumpScore(cid, opts?.sourceId, 'damageDealt', damage);
  if (damage > 0) checkEndsIfCasterDamages(cid, targetId, opts?.sourceId);
  void saveEncounter(cid, encounter);

  if (creature.isDead()) {
    bumpScore(cid, opts?.sourceId, 'enemiesKilled', 1);
    console.log(`[combat] ${creature.name} is dead`);
    encounter.removeFromTurnOrder(targetId);
    void saveEncounter(cid, encounter);
    // 5e: death ends concentration outright, no save — monsters have no death-save stage to
    // route this through, so it's checked directly rather than via a wasDown-style branch.
    await breakConcentration(cid, targetId);

    const engine = getStateEngine(cid);
    await engine.trigger('onKill', {
      participantId: targetId, participantName: creature.name, isPlayer: false,
    });
    // A dead participant's lingering effects go with it — nothing should tick for a corpse.
    engine.unregisterByOwner(targetId);

    // Creature.from() doesn't carry isBoss (combat participants only need combat-relevant fields),
    // so check the dungeon entity itself rather than the live creature/encounter — it's the
    // one place the flag survives the manifest -> entity -> Creature hop unmodified.
    if (dungeons.get(cid)?.entities.find(e => e.id === targetId)?.statBlock?.isBoss) {
      void resolveQuest(cid, `boss-${targetId}`);
    }

    if (encounter.allEnemiesDead()) {
      const enemyStatBlocks = encounter.enemies
        .filter(p => p.creature)
        .map(p => p.creature!.toStatBlock());
      const totalXp = enemyStatBlocks.reduce((sum, e) => sum + crToXp(e.cr), 0);
      const playerCount = campaignPlayers.get(cid)?.length ?? 1;
      const xpPerPlayer = Math.floor(totalXp / playerCount);
      io.to(ROOM).emit('combat:victory', { xpPerPlayer, totalXp, kills: enemyStatBlocks.map(e => e.name) });
      console.log(`[combat] victory! ${totalXp} XP total, ${xpPerPlayer} per player`);

      void listCharacters(cid).then(chars => Promise.all(
        chars.map(char => updateCharacter(cid, char.id, c => ({ ...c, xp: (c.xp ?? 0) + xpPerPlayer })))
      ));

      // combatState flips false right away so a player still moving on their last turn can't
      // trigger checkDungeonProximity/joinReinforcements against this encounter mid-teardown —
      // but the client-facing combat:state emit (which VictoryScreen clears itself on) stays on
      // the narrative delay below, so the victory screen still gets its full display window.
      combatState.set(cid, false);

      // Captured so the delayed cleanup below can check it's still tearing down THIS fight — if
      // the party found another encounter within the delay window, encounters.get(cid) is by then
      // a brand new Encounter for that fight, and blindly tearing it down (endCombat deletes
      // whatever's currently in the map) would silently kill the next fight mid-combat.
      const wonEncounter = encounter;

      setTimeout(() => {
        const superseded = encounters.get(cid) !== wonEncounter;
        if (!superseded) {
          void endCombat(cid);
          io.to(ROOM).emit('combat:state', false);

          const arenaDungeon = dungeons.get(cid);
          const arenaHasTraps = arenaDungeon?.entities.some(e => e.type === 'trap');
          if (microDungeons.has(cid) && !arenaHasTraps) {
            // Combat-arena dungeon served its purpose — discard it and return to the world map
            microDungeons.delete(cid);
            dungeons.delete(cid);
            void clearDungeon(cid);
            io.to(ROOM).emit('dungeon:cleared');
          } else if (microDungeons.has(cid)) {
            // A trap (Snare, ...) is still armed on this arena — keep the map loaded instead of
            // discarding it, so the trap survives past this fight to be triggered later.
            const killedIds = new Set(enemyStatBlocks.map(e => e.id));
            arenaDungeon!.entities = arenaDungeon!.entities.filter(e => !(e.type === 'creature' && killedIds.has(e.id)));
            void saveDungeon(cid, arenaDungeon!);
            io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, arenaDungeon!)));
          } else {
            const dungeon = dungeons.get(cid);
            if (dungeon) {
              const killedIds = new Set(enemyStatBlocks.map(e => e.id));
              dungeon.entities = dungeon.entities.filter(e => !(e.type === 'creature' && killedIds.has(e.id)));
              void saveDungeon(cid, dungeon);
              io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
            }
          }
        } else {
          // A new encounter already replaced this one — still strip the dead entities from the
          // dungeon (that part doesn't touch live combat state) so they don't linger forever.
          const dungeon = dungeons.get(cid);
          if (dungeon && !microDungeons.has(cid)) {
            const killedIds = new Set(enemyStatBlocks.map(e => e.id));
            dungeon.entities = dungeon.entities.filter(e => !(e.type === 'creature' && killedIds.has(e.id)));
            void saveDungeon(cid, dungeon);
            io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
          }
        }

        const kills = enemyStatBlocks.map(e => e.name).join(', ');
        const summary = `[Combat over — party victorious. Defeated: ${kills}. ${xpPerPlayer} XP awarded per player. Describe the immediate aftermath and give the party something to act on.]`;
        void appendChatLog(cid, { text: summary, senderName: 'System', timestamp: Date.now() }).then(() => {
          dispatchDMResponse(cid);
        });
      }, 7000);
    }
  } else if (damage > 0) {
    await checkConcentration(cid, targetId, damage);
  }
}

// Generic fallback for dungeon-authored traps that don't carry their own effect data yet
// (manifest.ts traps are just {name, hideDC} today) — a plain "ouch" rather than nothing.
const DEFAULT_TRAP_EFFECT: TrapEffect = {
  save: { ability: 'dex', dc: 13, halfOnSave: true },
  effects: [{ type: 'damage', damageType: 'Piercing', scaling: { mode: 'spell-slot', base: '2d10', tiers: [] } }],
};

/**
 * The one trap-trigger listener, called from every place a token can step onto a trap's cell:
 * checkDungeonProximity (dungeon exploration and in-combat player movement both flow through
 * player token:move) and the AI movement loop below (enemy steps). Single-use — the trap is
 * removed from the dungeon the instant it springs, matching Snare and the "trap springs" trope.
 */
export async function checkTrapAt(cid: string, gx: number, gy: number, triggerId: string, triggerName: string, isPlayer: boolean): Promise<void> {
  const dungeon = dungeons.get(cid);
  const entity = dungeon?.entities.find(e => {
    if (e.type !== 'trap') return false;
    const radius = e.trap?.radiusFt ?? 0;
    return Math.max(Math.abs(e.x - gx), Math.abs(e.y - gy)) * 5 <= radius;
  });
  if (!dungeon || !entity) return;

  const trapDef = entity.trap ?? DEFAULT_TRAP_EFFECT;
  dungeon.entities = dungeon.entities.filter(e => e.id !== entity.id);
  void saveDungeon(cid, dungeon);
  io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));

  // Alert-only trap (Alarm) — no save, no effects, nothing to resolve. Notify just the caster
  // who set it rather than broadcasting a "triggers!" line to the whole table.
  if (!trapDef.save && trapDef.effects.length === 0) {
    const caster = entity.placedBy ? (await listCharacters(cid)).find(c => c.name === entity.placedBy) : undefined;
    const sid = caster ? playerSocketIds.get(caster.id) : undefined;
    if (sid) {
      io.to(sid).emit('chat:message', { text: `Your ${entity.name} alerts you — ${triggerName} passed through it.`, senderName: 'System', timestamp: Date.now() });
    }
    logDebug(`[trap] ${entity.name} (alert-only) triggered by ${triggerName} at (${gx},${gy}), notified ${entity.placedBy ?? 'nobody (unplaced)'}`);
    return;
  }

  const encounter = encounters.get(cid);
  let participant: Participant | undefined;
  let targetId = triggerId;

  if (isPlayer) {
    const char = (await listCharacters(cid)).find(c => c.name === triggerName);
    if (!char) return;
    targetId = char.id;
    participant = encounter?.findParticipant(char.id) ?? new Participant({
      id: char.id, name: char.name, initiative: 0, isPlayer: true,
      currentHp: char.currentHp ?? calcMaxHp(char), maxHp: calcMaxHp(char), tempHp: char.tempHp ?? 0,
    });
  } else {
    participant = encounter?.findParticipant(triggerId);
    if (!participant) return;
  }

  logDebug(`[trap] ${triggerName} (isPlayer=${isPlayer}) steps on ${entity.name} at (${gx},${gy})`);
  let saved = false;
  let saveRoll: { roll: number; bonus: number; total: number } | undefined;
  if (trapDef.save) {
    const result = await rollSavingThrow(cid, targetId, trapDef.save.ability, trapDef.save.dc);
    saved = result.saved;
    saveRoll = result;
    console.log(`[trap] ${triggerName} triggers ${entity.name} — save vs DC${trapDef.save.dc}: ${saved ? 'SAVE' : 'FAIL'}`);
    logDebug(`[trap] ${triggerName} triggers ${entity.name} — save vs DC${trapDef.save.dc}: ${saved ? 'SAVE' : 'FAIL'}`);
  }

  const targetType: CreatureType = isPlayer ? 'Humanoid' : (participant.creature?.creatureType ?? 'Humanoid');
  const rolledDamage = rollApplicableDamage(trapDef.effects, targetType, 1, 1);
  let damage: number | undefined;
  if (rolledDamage && (!saved || trapDef.save?.halfOnSave)) {
    damage = saved ? Math.floor(rolledDamage.total / 2) : rolledDamage.total;
    if (isPlayer) await applyDamageToPlayer(cid, participant, damage, { charId: targetId });
    else await applyDamageToCreature(cid, targetId, damage);
  }

  const conditionsApplied: string[] = [];
  if (!saved) {
    for (const effect of trapDef.effects) {
      if (effect.type === 'condition' && effect.condition) {
        await applyCondition(cid, targetId, effect.condition);
        conditionsApplied.push(effect.condition);
      }
    }
  }

  const msg = { text: `${triggerName} triggers ${entity.name}!`, senderName: 'System', timestamp: Date.now() };
  io.to(ROOM).emit('chat:message', msg);
  void appendChatLog(cid, msg);

  // Reuses the same SpellSaveResult broadcast every other save-based spell renders through the
  // combat log — a trap's save roll should be just as visible as Snare's DC was when it was cast.
  if (saveRoll && trapDef.save) {
    const result: SpellSaveResult = {
      casterName: entity.placedBy ?? entity.name,
      spellName: entity.name,
      dc: trapDef.save.dc,
      saveAbility: trapDef.save.ability,
      slotLevel: 1,
      outcomes: [{
        targetId, targetName: triggerName, isPC: isPlayer,
        roll: saveRoll.roll, saveBonus: saveRoll.bonus, total: saveRoll.total, dc: trapDef.save.dc,
        saved, damage,
        conditionsApplied: conditionsApplied.length ? conditionsApplied : undefined,
        remainingHp: isPlayer ? participant.currentHp : participant.creature?.currentHp,
        targetDead: participant.isDead(),
      }],
    };
    io.to(ROOM).emit('combat:spell:save:result', result);
  }
}

// Advancing a turn is asynchronous now that hook stages are awaited, which opens a window the old
// synchronous version did not have: a second advanceTurn arriving mid-flight (a client's
// combat:turn:end racing the enemy AI's own end-of-turn call) would fire afterTurn twice for the
// same actor and skip a participant. One advance in flight per fight.
const advancingTurn = new Set<string>();

export function advanceTurn(cid: string) {
  if (!combatState.get(cid)) return;
  const encounter = encounters.get(cid);
  if (!encounter?.turnOrder.length) return;
  if (advancingTurn.has(cid)) {
    console.log('[turn] advanceTurn ignored — an advance is already in flight');
    return;
  }
  advancingTurn.add(cid);

  void (async () => {
    try {
      const engine = getStateEngine(cid);
      const round = encounter.currentRound?.number ?? 1;

      const outgoing = encounter.currentActor;
      if (outgoing) {
        await engine.trigger('afterTurn', {
          participantId: outgoing.id, participantName: outgoing.name, isPlayer: outgoing.isPlayer, round,
        });
        // Hook chains are awaited, so combat may have ended (or been superseded) while suspended —
        // same re-guard the delay()-based paths in runEnemyAI already use.
        if (!combatState.get(cid)) return;
      }

      const before = encounter.currentActor?.name ?? '?';
      const { roundStarted } = encounter.advanceTurn();
      const after = encounter.currentActor?.name ?? '?';
      console.log(`[turn] advanceTurn: ${before} → ${after} (order=[${encounter.turnOrder.map(p => p.name).join(',')}])`);

      if (roundStarted) {
        await engine.trigger('afterRound', { round });
        await engine.trigger('beforeRound', { round: encounter.currentRound?.number ?? round + 1 });
        if (!combatState.get(cid)) return;
        pruneExpiredHazardCells(cid, encounter.currentRound?.number ?? round + 1);
      }

      // beforeTurn hooks can damage the incoming actor (a lingering acid/poison effect ticking at
      // the start of its turn). A creature killed here is spliced out of the turn order by
      // applyDamageToCreature, which leaves currentActor pointing at the next live participant —
      // so emitTurn below still lands correctly without needing to re-advance.
      await runTurnStart(cid);
      if (!combatState.get(cid)) return;

      emitTurn(cid);
      void saveEncounter(cid, encounter);
    } finally {
      advancingTurn.delete(cid);
    }
  })();
}

/**
 * Registers a ReactionOfferHook for each reaction-cast spell this character knows, so the offer
 * exists before anything attacks them. Spells are stored on the character as bare names, so they
 * are resolved against the compendium here.
 */
/** Registers a participant's innate damage-type modifiers as endOfCombat DamageResistanceHooks. */
function registerStaticDamageModifiers(
  cid: string,
  ownerId: string,
  mods: { damageResistances?: string[]; damageVulnerabilities?: string[]; damageImmunities?: string[] },
): void {
  const engine = getStateEngine(cid);
  const entries: [string[] | undefined, 'resistance' | 'vulnerability' | 'immunity'][] = [
    [mods.damageResistances, 'resistance'],
    [mods.damageVulnerabilities, 'vulnerability'],
    [mods.damageImmunities, 'immunity'],
  ];
  for (const [types, mode] of entries) {
    for (const damageType of types ?? []) {
      // Deterministic id, same reasoning as registerReactionOffers — combat can be (re)entered
      // from more than one path, and re-registering must replace rather than duplicate.
      const id = `innate-resist:${ownerId}:${damageType}:${mode}`;
      engine.register(new DamageResistanceHook({ id, ownerId, source: `innate:${damageType}`, kind: 'damageResistance', damageType, mode }));
    }
  }
}

function registerReactionOffers(cid: string, char: Character): void {
  const engine = getStateEngine(cid);
  const triggers = (char.spells ?? []).map(n => findSpell(n)?.combat?.reactionTrigger?.on);
  // One broker per kind per player — not one hook per spell — so multiple eligible reaction
  // spells surface together as a single combined offer instead of one prompt after another.
  // Deterministic ids so the two paths that roll player initiative (dungeon entry and the
  // combat_init effect) cannot register the same broker twice.
  if (triggers.includes('beingHit')) {
    engine.register(new ReactionOfferHook({ id: `reaction-broker:defend:${char.id}`, ownerId: char.id, source: 'Reaction (defend)' }));
  }
  if (triggers.includes('takingDamage')) {
    engine.register(new RetaliationOfferHook({ id: `reaction-broker:retaliate:${char.id}`, ownerId: char.id, source: 'Reaction (retaliate)' }));
  }
}

export async function rollPlayerInitiatives(cid: string, chars: Character[]): Promise<void> {
  const encounter = encounters.get(cid);
  if (!encounter) return;

  let playerTeam = encounter.teams.find(t => t.name === 'Players');
  if (!playerTeam) {
    playerTeam = new Team('players', 'Players');
    encounter.addTeam(playerTeam);
  }

  const players = (campaignPlayers.get(cid) ?? []).filter(name => connected.has(name));
  encounter.expectedParticipantCount += players.length;

  const entries: Participant[] = players.map(name => {
    const char = chars.find(c => c.name === name);
    const alertBonus = char && hasOriginFeat(char, 'Alert') ? (char.proficiencyBonus ?? 2) : 0;
    const mod = (char ? statMod(char.stats.dex) : 0) + (char?.initiativeBonus ?? 0) + alertBonus;
    const maxHp = char ? calcMaxHp(char) : 0;
    const participant = new Participant({
      id: char?.id ?? name,
      name,
      initiative: new D20Roll().roll() + mod,
      isPlayer: true,
      teamId: 'players',
      currentHp: char?.currentHp ?? maxHp,
      maxHp,
      tempHp: char?.tempHp ?? 0,
    });
    playerTeam!.addParticipant(participant);
    if (char) {
      registerReactionOffers(cid, char);
      registerStaticDamageModifiers(cid, char.id, char);
    }
    return participant;
  });

  addToTurnOrder(cid, entries);

  // Add any persistent party allies to initiative alongside players
  const allies = await loadPartyAllies(cid);
  if (allies.length) {
    const allyEntries = allies.map(sb => {
      const creature = Creature.from(sb);
      const p = new Participant({
        id: creature.id,
        name: creature.name,
        initiative: new D20Roll().roll() + statMod(creature.stats.dex),
        isPlayer: false,
        teamId: 'players',
        creature,
        ownerId: sb.ownerId,
      });
      playerTeam!.addParticipant(p);
      registerStaticDamageModifiers(cid, creature.id, creature);
      return p;
    });
    encounter.expectedParticipantCount += allyEntries.length;
    addToTurnOrder(cid, allyEntries, entries.length * 500);
  }
}

export function rollEnemyInitiatives(cid: string): void {
  const encounter = encounters.get(cid);
  if (!encounter) return;
  enemiesReady.set(cid, true);
  const existing = encounter.turnOrder.length;
  const entries = encounter.enemies.map(p => {
    p.initiative = new D20Roll().roll() + statMod(p.creature?.stats.dex ?? 10);
    if (p.creature) registerStaticDamageModifiers(cid, p.id, p.creature);
    return p;
  });
  addToTurnOrder(cid, entries, existing * 500);
}

export function addToTurnOrder(cid: string, entries: Participant[], baseDelay = 0): void {
  const encounter = encounters.get(cid);
  if (!encounter) return;

  entries.forEach((entry, i) => {
    setTimeout(() => {
      if (!combatState.get(cid)) return;
      encounter.addToTurnOrder(entry);
      io.to(ROOM).emit('combat:initiative', entry.toTurnOrderEntry());
      tryBeginCombat(cid);
      void saveEncounter(cid, encounter);
    }, baseDelay + i * 500);
  });
}

// Only level-1 slots are tracked today (no spells-known growth past level 1 exists yet
// either — see spellSlotsForClass). Cantrips (slotLevel 0) and any untracked tier are free.
export async function trySpendSpellSlot(cid: string, charId: string, char: Character, slotLevel: number): Promise<boolean> {
  if (slotLevel !== 1) return true;
  const current = char.currentSpellSlots1 ?? spellSlotsForClass(char.class);
  if (current <= 0) return false;
  const next = current - 1;
  await updateCharacter(cid, charId, c => ({ ...c, currentSpellSlots1: next }));
  io.to(ROOM).emit('combat:player:slots', { characterId: charId, currentSpellSlots1: next, maxSpellSlots1: char.maxSpellSlots1 ?? spellSlotsForClass(char.class) });
  return true;
}
