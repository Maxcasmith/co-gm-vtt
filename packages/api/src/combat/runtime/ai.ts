import type { Character, Weapon } from 'shared';
import { calcAC, hasOriginFeat, isWeapon, isArmor, trySpendResource, resourceCurrent, unarmedStrikeFor } from 'shared';
import { getCharacter, updateCharacter, listCharacters, getConfig, getHouseRules } from '../../storage.ts';
import { getFeatureProvider } from '../../providers/index.ts';
import { generateCombatFlavour } from '../../session-processor/imagePrompts.ts';
import { Participant } from '../../domain/encounter.ts';
import { io, campaignRoom, fightOf, toFight, tokenPositions, getStateEngine } from '../../state.ts';
import { D20Roll, rollDice, fmtMod, resolveHit, maxDiceValue } from '../dice.ts';
import { rollModeFor, attackModeAgainstTarget, combineModes } from '../conditions/rollModeFor.ts';
import { offerReaction } from '../stateEngine/reactionPrompt.ts';
import type { AttackerDisadvantageHook } from '../stateEngine/hooks/AttackerDisadvantageHook.ts';
import type { TacticalContext } from '../ai/types.ts';
import { generatePlans } from '../ai/planGenerator.ts';
import { evaluatePlans, actionRangeFt, findAction } from '../ai/planEvaluator.ts';
import { selectPlan } from '../ai/planSelector.ts';
import { executeSpecialAction } from '../ai/executor.ts';
import { runManoeuvres } from '../tactics/executionLoop.ts';
import { applyDamageToCreature, applyDamageToPlayer, bladeWardPenalty } from './damage.ts';
import { advanceTurn } from './lifecycle.ts';
import { walkParticipant } from './movement.ts';
import { delay, emitResources } from './shared.ts';
import { checkSanctuary } from './statusEffects.ts';
import { postChat } from '../../partyGroups.ts';

/**
 * Protection Fighting Style: before an attack roll against targetKeyId is made, offers the
 * reaction to any player-controlled ally within 5ft of the target who has the style, a shield
 * equipped, and a reaction available. Has to run pre-roll — the same reason "Protection from Evil
 * and Good"'s disadvantage check runs pre-roll in runEnemyAI below — but the source here is a
 * reaction someone chooses rather than a standing hook, so it can't reuse ReactionOfferHook's
 * afterAttackRoll timing (that one only reacts to seeing the outcome, too late for this).
 * Only the first eligible protector is offered; declining or timing out means the attack rolls normally.
 */
async function offerProtectionReaction(
  cid: string,
  participants: Participant[],
  positions: Record<string, { gx: number; gy: number }>,
  targetKeyId: string,
  targetPos: { gx: number; gy: number } | undefined,
  targetName: string,
  attackerName: string,
): Promise<boolean> {
  if (!targetPos) return false;
  for (const p of participants) {
    if (!p.isPlayer || p.id === targetKeyId || !p.hasResource('reaction')) continue;
    const ppos = positions[p.name];
    if (!ppos) continue;
    if (Math.max(Math.abs(ppos.gx - targetPos.gx), Math.abs(ppos.gy - targetPos.gy)) > 1) continue; // 5ft
    const char = await getCharacter(cid, p.id);
    if (!char || char.fightingStyle !== 'Protection') continue;
    const hasShield = [char.equipment?.mainHand, char.equipment?.offHand]
      .some(id => { const item = char.inventory?.find(i => i.id === id); return item && isArmor(item) && item.isShield; });
    if (!hasShield) continue;

    const picked = await offerReaction(cid, p.id, [{
      spellName: 'Protection', kind: 'protect',
      attackerName, sourceName: 'Fighting Style: Protection', targetName,
    }]);
    if (!picked) continue;
    if (!fightOf(cid, p.id) || !p.hasResource('reaction')) continue; // re-check after await
    p.trySpend('reaction');
    emitResources(cid, p);
    console.log(`[protection] ${p.name} imposes Disadvantage on ${attackerName}'s attack against ${targetName}`);
    return true;
  }
  return false;
}

/**
 * Origin feat Lucky, defensive half: offers the target a Luck Point spend to impose Disadvantage
 * on an incoming attack, pre-roll — same timing as offerProtectionReaction above, just
 * self-targeted and spending a Luck Point instead of a reaction.
 */
export async function offerLuckDisadvantage(cid: string, targetId: string, targetName: string, attackerName: string): Promise<boolean> {
  const char = await getCharacter(cid, targetId);
  if (!char || !hasOriginFeat(char, 'Lucky') || resourceCurrent(char, 'luckPoints') <= 0) return false;

  const picked = await offerReaction(cid, targetId, [{
    spellName: 'Lucky', kind: 'luck', attackerName, sourceName: 'Feat: Lucky',
  }]);
  if (!picked) return false;

  // Re-check after the await — the point may already be gone (another attack spent it).
  const fresh = await getCharacter(cid, targetId);
  if (!fightOf(cid, targetId) || !fresh) return false;
  const nextResourceUses = trySpendResource(fresh, 'luckPoints');
  if (!nextResourceUses) return false;
  await updateCharacter(cid, targetId, c => ({ ...c, resourceUses: nextResourceUses }));
  io.to(campaignRoom(cid)).emit('combat:player:featureResources', { characterId: targetId, resourceUses: nextResourceUses });
  console.log(`[lucky] ${targetName} spends a Luck Point to impose Disadvantage on ${attackerName}'s attack`);
  return true;
}

export async function runEnemyAI(cid: string, actor: Participant): Promise<void> {
  const encounter = fightOf(cid, actor.id);
  if (!encounter) return;

  const creature = encounter.findCreature(actor.id);
  if (!creature) return advanceTurn(cid, encounter);

  const positions = tokenPositions.get(cid) ?? {};
  const epos = positions[actor.id];
  if (!epos) {
    console.log(`[ai] ${actor.name} has no position, skipping turn`);
    await delay(400);
    return advanceTurn(cid, encounter);
  }

  // Layered decision: generatePlans seeds candidates off the creature's role (roleConfig.ts),
  // evaluatePlans scores each on the shared 0-20 "party impact" currency, selectPlan picks the
  // best one the creature is smart enough to find (bounded by its INT score, capped at 20) —
  // see combat/ai/ for the full pipeline. Replaces the old "nearest enemy, random attack" loop.
  const round = encounter.currentRound?.number ?? 1;
  const tacticalCtx: TacticalContext = { cid, actor, positions, allParticipants: encounter.turnOrder, round };
  const scoredPlans = evaluatePlans(generatePlans(tacticalCtx), tacticalCtx);
  if (!scoredPlans.length) return advanceTurn(cid, encounter);
  const plan = selectPlan(scoredPlans, creature.stats.int);

  const target = encounter.turnOrder.find(p => p.id === plan.targetId);
  if (!target) return advanceTurn(cid, encounter);
  // Players use name as token key; non-players (allies included) use id.
  const targetPosKey = target.isPlayer ? target.name : target.id;
  const targetPos = positions[targetPosKey];

  // Restrained: speed 0, can't move — still gets its action if already in range.
  const maxFt = creature.conditions?.some(c => c.name === 'Restrained') ? 0 : creature.speed;
  const rangeFt = actionRangeFt(creature, plan.actionRef);

  const { gx, gy } = plan.movement !== 'hold' && targetPos && maxFt > 0
    ? await walkParticipant(cid, actor, epos, plan.movement === 'retreat' ? 'retreat' : 'approach', targetPos, maxFt, rangeFt, creature.conditions)
    : epos;
  if (encounter.ended) return;

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
        // Protection Fighting Style — offered only when the target is a player (protectors are
        // always player-controlled too); suspends here while the protector decides.
        const protectedAgainst = targetParticipant.isPlayer && await offerProtectionReaction(
          cid, encounter.turnOrder, positions, targetKeyId, targetPos, targetParticipant.name, actor.name,
        );
        if (encounter.ended) return;
        // Lucky — offered after Protection, so a player doesn't burn a Luck Point on an attack an
        // ally already turned to Disadvantage for free.
        const luckDisadvantage = targetParticipant.isPlayer && !protectedAgainst && await offerLuckDisadvantage(
          cid, targetKeyId, targetParticipant.name, actor.name,
        );
        if (encounter.ended) return;
        const mode = combineModes(rollModeFor(creature, 'attack'), attackModeAgainstTarget(targetHolder ?? {}), wardedAgainst || protectedAgainst || luckDisadvantage ? -1 : 0);
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
          hit: resolveHit(roll, attackBonus, targetAc),
        }));
        if (encounter.ended) return;

        atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
        atkCtx.hit = resolveHit(atkCtx.d20, atkCtx.attackBonus, atkCtx.ac);
        const isCrit = atkCtx.d20 === 20;
        const houseRules = await getHouseRules(cid);

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
        let damageRoll: number | undefined;
        let remainingHp: number | undefined;
        let targetDead = false;

        if (hit) {
          damageRoll = isCrit
            ? rollDice(atk.damage) + (houseRules.perkinsCrit ? maxDiceValue(atk.damage) : rollDice(atk.damage))
            : rollDice(atk.damage);
          const dmgCtx = await engine.trigger('beforeDamage', {
            sourceId: actor.id,
            targetId: targetKeyId,
            targetName: targetParticipant.name,
            amount: damageRoll,
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
                isCrit,
              });
              remainingHp = playerParticipant.currentHp;
              targetDead = playerParticipant.currentHp <= 0;
              console.log(`[ai] ${actor.name} attacks ${targetParticipant.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — HIT ${damage} (${playerParticipant.currentHp}/${playerParticipant.maxHp} HP)`);
            }
          } else {
            // Ally or other non-player target — use creature damage path
            await applyDamageToCreature(cid, targetParticipant.id, damage, { sourceId: actor.id, isCrit });
            remainingHp = encounter.findCreature(targetParticipant.id)?.currentHp;
            targetDead = encounter.findCreature(targetParticipant.id)?.isDead() ?? false;
          }

          await engine.trigger('afterDamage', dmgCtx);
        } else {
          console.log(`[ai] ${actor.name} attacks ${targetParticipant.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — MISS`);
        }

        const targetId = targetParticipant.isPlayer ? (targetCharForAttack?.id ?? targetParticipant.name) : targetParticipant.id;
        toFight(encounter).emit('combat:attack:result', {
          attackerName: actor.name, targetName: targetParticipant.name, targetId,
          weaponName: atk.name, isMelee: true, d20: roll, attackBonus: atk.bonus, statBonus: atk.bonus, statName: 'Attack', weaponBonus: 0, total, ac: targetAc,
          hit, isCrit, damage, damageRoll, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead,
        });

        const cfg = await getConfig();
        const cfgAdapter = getFeatureProvider(cfg, 'combatNarration');
        {
          const atkResult = {
            attackerName: actor.name, targetName: targetParticipant.name, targetId,
            // Monster attacks aren't modeled with a range yet (see EnemyStatBlock.attacks) — the client
            // only reads isMelee for player-sourced swing effects, so this is inert here regardless.
            weaponName: atk.name, isMelee: true, d20: roll, attackBonus: atk.bonus, statBonus: atk.bonus, statName: 'Attack', weaponBonus: 0, total, ac: targetAc,
            hit, isCrit, damage, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead,
          };
          const flavour = await generateCombatFlavour(atkResult, cfgAdapter);
          if (flavour) {
            const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
            void postChat(cid, msg, [actor.id]);
          }
        }
      }
    }
  } else {
    console.log(`[ai] ${actor.name} cannot reach ${target.name} (${finalDistFt}ft away)`);
  }

  await delay(600);
  advanceTurn(cid, encounter);
}

/** The character's equipped main-hand weapon, or the universal unarmed strike — same shape client's CombatDock builds for the attack picker. */
export function weaponFor(char: Character): Weapon {
  const mainHandId = char.equipment?.mainHand;
  const item = mainHandId ? char.inventory?.find(i => i.id === mainHandId) : undefined;
  if (item && isWeapon(item)) return item;
  return unarmedStrikeFor(char);
}

/**
 * Offline-party-member counterpart to runEnemyAI: a player-controlled character marked
 * `aiControlled` plays its own turn via its authored `tactics` (competing manoeuvre chains,
 * scored step-by-step — see combat/tactics/executionLoop.ts) instead of waiting on its client.
 * Reuses the exact same attack/spell-attack/item resolution the client normally triggers, so the
 * outcome is indistinguishable from a human playing that turn.
 */
export async function runPlayerTactics(cid: string, actor: Participant): Promise<void> {
  const encounter = fightOf(cid, actor.id);
  if (!encounter) return;

  const char = await getCharacter(cid, actor.id);
  if (!char) return advanceTurn(cid, encounter);

  const positions = tokenPositions.get(cid) ?? {};
  const round = encounter.currentRound?.number ?? 1;
  const tacticalCtx: TacticalContext = { cid, actor, positions, allParticipants: encounter.turnOrder, round };

  await runManoeuvres(cid, actor, char, tacticalCtx);

  await delay(600);
  advanceTurn(cid, encounter);
}

