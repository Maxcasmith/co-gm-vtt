import { updateCharacter, appendChatLog, saveEncounter, clearDungeon, saveDungeon, listCharacters, getConfig } from '../../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../../providers/index.ts';
import { generateCombatAftermath } from '../../session-processor/imagePrompts.ts';
import { toClientDungeon } from '../../dungeon/index.ts';
import { checkQuestChainTriggers } from '../../dungeon/questChain.ts';
import { Participant } from '../../domain/encounter.ts';
import { io, ROOM, combatState, encounters, tokenPositions, campaignPlayers, playerSocketIds, combatScores, dungeons, microDungeons, withLivePositions, getStateEngine, stateEngines } from '../../state.ts';
import { rollDice, crToXp } from '../dice.ts';
import { RecurringDamageHook } from '../stateEngine/hooks/RecurringDamageHook.ts';
import type { RollModifierHook } from '../stateEngine/hooks/RollModifierHook.ts';
import { dispatchDMResponse } from '../../session.ts';
import { breakConcentration, checkConcentration } from './concentration.ts';
import { markPlayerDead, runDeathSave } from './deathSaves.ts';
import { advanceTurn, emitTurn, endCombat, endCombatDefeated } from './lifecycle.ts';

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
  opts?: { charId?: string; sourceId?: string; isCrit?: boolean },
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
  if (damage > 0) io.to(ROOM).emit('combat:damage:dealt', { targetId: charId, targetName: participant.name, damage, isCrit: !!opts?.isCrit });
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
  } else if (participant.isDown()) {
    // 5e: being incapacitated ends concentration outright, no save.
    await breakConcentration(cid, charId);
    await getStateEngine(cid).trigger('onDown', {
      participantId: charId, participantName: participant.name, isPlayer: true, sourceId: opts?.sourceId,
    });
  } else if (damage > 0) {
    await checkConcentration(cid, charId, damage);
  }

  // Every player-damage source funnels through this one function, so it's the single right place
  // to catch a wipe regardless of what caused it or whose turn it happened on.
  if (combatState.get(cid)) {
    const encounter = encounters.get(cid);
    if (encounter?.allPlayersDown()) {
      // Any damage that drops the last standing player is a TPK, full stop — don't wait for the
      // turn cycle to notice (emitTurn's own allPlayersDown() check only runs on the *next* turn
      // transition, which may never come: see the mid-turn case below).
      endCombatDefeated(cid);
    } else if (participant.isDown() && encounter?.currentActor?.id === participant.id) {
      // 5e: falling unconscious immediately ends your turn. Matters when the blow lands mid-turn —
      // an Opportunity Attack provoked by their own movement, a reaction, AoE damage mid-cast —
      // rather than at the start of it: CombatDock drops the End Turn button the instant HP hits 0
      // (see its isDown branch), and emitTurn's isDown()→runDeathSave dispatch only fires at
      // turn-start, which already ran earlier this same turn while they were still up. Without
      // this, nothing ever advances the encounter again — it just stalls here (not a TPK, since
      // the branch above already caught that case; just this one player, party otherwise fine).
      advanceTurn(cid);
    }
  } else if (participant.isDown()) {
    // Exploration has no turn-cycle equivalent of emitTurn's allPlayersDown() check, so this is
    // also the right spot to catch a wipe that happens outside combat entirely (a trap, ...).
    const chars = await listCharacters(cid);
    if (chars.length && chars.every(c => (c.currentHp ?? 0) <= 0)) endCombatDefeated(cid);
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

export async function applyDamageToCreature(cid: string, targetId: string, damage: number, opts?: { sourceId?: string; isCrit?: boolean }): Promise<void> {
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
  if (damage > 0) io.to(ROOM).emit('combat:damage:dealt', { targetId, targetName: creature.name, damage, isCrit: !!opts?.isCrit });
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
    // so check the dungeon entity itself rather than the live creature/encounter — it's the one
    // place the flag survives the manifest -> entity -> Creature hop unmodified.
    if (dungeons.get(cid)?.entities.find(e => e.id === targetId)?.statBlock?.isBoss) {
      void checkQuestChainTriggers(cid, { kind: 'defeat_boss' });
    }

    if (encounter.allEnemiesDead()) {
      const enemyStatBlocks = encounter.enemies
        .filter(p => p.creature)
        .map(p => p.creature!.toStatBlock());
      // Where the fight actually happened, not wherever the player's own token last sat — for
      // dungeon-crawl aggro combat especially, the player may never have walked fully into the
      // room a ranged fight was triggered in. See startDungeonCombat: this id is the same one
      // tokenPositions was seeded with when the creature entered combat.
      const enemyPositions = enemyStatBlocks
        .map(e => tokenPositions.get(cid)?.[e.id])
        .filter((p): p is { gx: number; gy: number } => !!p);
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

      // combatState is already false above, so checkDungeonProximity treats any move in the 7s
      // display window below as exploration and re-aggros whatever's still sitting in
      // dungeon.entities — strip the kills now, not in the delayed cleanup, so a corpse can never
      // restart combat. (The delayed block below re-filters the same ids; harmless no-op there.)
      const liveDungeon = dungeons.get(cid);
      if (liveDungeon) {
        const killedIds = new Set(enemyStatBlocks.map(e => e.id));
        liveDungeon.entities = liveDungeon.entities.filter(e => !(e.type === 'creature' && killedIds.has(e.id)));
      }

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

        const kills = enemyStatBlocks.map(e => e.name);
        void (async () => {
          const config = await getConfig();
          const aftermath = hasFeatureProvider(config, 'combatNarration')
            ? await generateCombatAftermath(kills, getFeatureProvider(config, 'combatNarration'))
            : null;
          if (aftermath) {
            await appendChatLog(cid, { text: aftermath, senderName: 'Virtual DM', timestamp: Date.now() });
            io.to(ROOM).emit('session:recap', { text: aftermath, senderName: 'Virtual DM' });
          } else {
            // No combatNarration provider configured — fall back to the general narrator rather
            // than leaving the aftermath beat silent.
            const summary = `[Combat over — party victorious. Defeated: ${kills.join(', ')}. ${xpPerPlayer} XP awarded per player. Describe the immediate aftermath and give the party something to act on.]`;
            await appendChatLog(cid, { text: summary, senderName: 'System', timestamp: Date.now() });
            dispatchDMResponse(cid, enemyPositions);
          }
        })();
      }, 7000);
    }
  } else if (damage > 0) {
    await checkConcentration(cid, targetId, damage);
  }
}

