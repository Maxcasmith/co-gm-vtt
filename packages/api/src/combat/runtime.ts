import type { Character, EffectSpec, CreatureType, Condition as ConditionName, ActiveCondition } from 'shared';
import { statMod, calcAC, spellSlotsForClass, CLASS_SAVING_THROWS } from 'shared';
import { getCharacter, updateCharacter, readChatLog, appendChatLog, saveEncounter, clearEncounter, clearDungeon, saveDungeon, listCharacters, loadPartyAllies, readQuests, writeQuests, readManifest, readNemeses, getConfig } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateCombatFlavour, evaluateNemesisCandidates } from '../session-processor/imagePrompts.ts';
import { toClientDungeon } from '../dungeon/index.ts';
import { Team, Participant } from '../domain/encounter.ts';
import { Creature } from '../domain/creature.ts';
import { logError } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, campaignPlayers, playerSocketIds, enemiesReady, combatStartedAt, dungeons, pendingWeaponBonuses, microDungeons, connected, withLivePositions, getStateEngine, stateEngines } from '../state.ts';
import { D20Roll, rollDice, fmtMod, calcMaxHp, crToXp } from './dice.ts';
import { rollModeFor, addCondition, removeCondition } from './conditions/rollModeFor.ts';
import { ReactionOfferHook } from './stateEngine/hooks/ReactionOfferHook.ts';
import { findSpell } from '../routes/spells.ts';
import { applyEffects } from '../effects.ts';
import { endSession, dispatchDMResponse } from '../session.ts';

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
  io.to(ROOM).emit('combat:turn', { actorName: actor.name });

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

  // Find nearest target on a different team by Chebyshev distance
  let target: { participant: Participant; gx: number; gy: number } | null = null;
  let minDist = Infinity;
  for (const p of encounter.turnOrder) {
    if (p.teamId === actor.teamId || p.isDown()) continue;
    // Players use name as token key; non-players (allies included) use id
    const posKey = p.isPlayer ? p.name : p.id;
    const pos = positions[posKey];
    if (!pos) continue;
    const d = Math.max(Math.abs(pos.gx - epos.gx), Math.abs(pos.gy - epos.gy));
    if (d < minDist) { minDist = d; target = { participant: p, ...pos }; }
  }

  if (!target) return advanceTurn(cid);

  let { gx, gy } = epos;
  const maxSteps = Math.floor(creature.speed / 5);

  for (let step = 0; step < maxSteps; step++) {
    const dist = Math.max(Math.abs(target.gx - gx), Math.abs(target.gy - gy));
    if (dist <= 1) break;

    const dx = Math.sign(target.gx - gx);
    const dy = Math.sign(target.gy - gy);
    const pos = tokenPositions.get(cid) ?? {};
    const candidates = [
      { gx: gx + dx, gy: gy + dy },
      { gx: gx + dx, gy },
      { gx,          gy: gy + dy },
    ].filter(c => c.gx >= 0 && c.gy >= 0 && !isOccupied(pos, c.gx, c.gy, actor.id));

    const next = candidates[0];
    if (!next) break;

    gx = next.gx;
    gy = next.gy;

    await delay(220);
    if (!combatState.get(cid)) return;

    const updatedPos = tokenPositions.get(cid) ?? {};
    updatedPos[actor.id] = { gx, gy };
    tokenPositions.set(cid, updatedPos);
    io.to(ROOM).emit('token:moved', { tokenId: actor.id, gx, gy });
  }

  // Attack
  if (creature.attacks.length > 0) {
    const atk = creature.attacks[Math.floor(Math.random() * creature.attacks.length)]!;
    const finalDist = Math.max(Math.abs(target.gx - gx), Math.abs(target.gy - gy));
    const targetParticipant = target.participant;

    if (finalDist <= 1) {
      let targetAc: number;
      let targetCharForAttack: Awaited<ReturnType<typeof listCharacters>>[number] | undefined;

      if (targetParticipant.isPlayer) {
        const chars = await listCharacters(cid);
        targetCharForAttack = chars.find(c => c.name === targetParticipant.name);
        targetAc = targetCharForAttack ? calcAC(targetCharForAttack) : 10;
      } else {
        targetAc = encounter.findCreature(targetParticipant.id)?.ac ?? 10;
      }

      const mode = rollModeFor(creature, 'attack');
      const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
      const engine = getStateEngine(cid);
      const targetKeyId = targetParticipant.isPlayer
        ? (targetCharForAttack?.id ?? targetParticipant.id)
        : targetParticipant.id;

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
        attackBonus: atk.bonus,
        ac: targetAc,
        total: roll + atk.bonus,
        hit: roll + atk.bonus >= targetAc,
      }));
      if (!combatState.get(cid)) return;

      atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
      atkCtx.hit = atkCtx.total >= atkCtx.ac;

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
          await applyDamageToCreature(cid, targetParticipant.id, damage);
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
        weaponName: atk.name, d20: roll, attackBonus: atk.bonus, statBonus: atk.bonus, statName: 'Attack', weaponBonus: 0, total, ac: targetAc,
        hit, damage, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead,
      });

      const cfg = await getConfig();
      const cfgAdapter = getFeatureProvider(cfg, 'combatNarration');
      {
        const atkResult = {
          attackerName: actor.name, targetName: targetParticipant.name, targetId,
          weaponName: atk.name, d20: roll, attackBonus: atk.bonus, statBonus: atk.bonus, statName: 'Attack', weaponBonus: 0, total, ac: targetAc,
          hit, damage, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead,
        };
        const flavour = await generateCombatFlavour(atkResult, cfgAdapter);
        if (flavour) {
          const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
          io.to(ROOM).emit('chat:message', msg);
          void appendChatLog(cid, msg);
        }
      }
    } else {
      console.log(`[ai] ${actor.name} cannot reach ${targetParticipant.name} (${finalDist} cells away)`);
    }
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
async function conditionsHolder(cid: string, targetId: string): Promise<
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
  holder.write(fn(holder.conditions, name));
  return holder.label;
}

export async function applyCondition(cid: string, targetId: string, name: ConditionName): Promise<void> {
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
}

const CONCENTRATION_MIN_DC = 10;

/**
 * Called after damage lands on targetId — if they're concentrating, rolls the Constitution save
 * 5e requires (DC 10 or half the damage taken, whichever is higher) and breaks concentration on a fail.
 */
export async function checkConcentration(cid: string, targetId: string, damage: number): Promise<void> {
  const holder = await conditionsHolder(cid, targetId);
  const link = holder?.conditions?.find(c => c.name === 'Concentrating')?.concentration;
  if (!holder || !link) return;

  const encounter = encounters.get(cid);
  const participant = encounter?.findParticipant(targetId);
  const creature = participant?.creature;
  const char = creature ? undefined : await getCharacter(cid, participant?.id ?? targetId);
  const stats = creature?.stats ?? char?.stats;
  if (!stats) return;

  const classSaves: readonly string[] = char ? (CLASS_SAVING_THROWS[char.class] ?? []) : [];
  const proficient = classSaves.includes('con');
  const bonus = statMod(stats.con) + (proficient ? (char?.proficiencyBonus ?? 2) : 0);

  const dc = Math.max(CONCENTRATION_MIN_DC, Math.floor(damage / 2));
  const mode = rollModeFor(creature ?? char ?? {}, 'save', 'con');
  const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
  const total = roll + bonus;
  const saved = total >= dc;
  console.log(`[concentration] ${holder.label} save vs DC${dc}: d20=${roll}${fmtMod(bonus)}=${total} — ${saved ? 'MAINTAINED' : 'BROKEN'}`);
  if (!saved) await breakConcentration(cid, targetId);
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
  void updateCharacter(cid, charId, c => ({ ...c, currentHp: participant.currentHp }));
  io.to(ROOM).emit('combat:player:damage', {
    characterId: charId,
    characterName: participant.name,
    damage,
    currentHp: participant.currentHp,
    maxHp: participant.maxHp,
  });
  // One event drives the damage float/flash for every source — weapon hit, spell hit, spell-save
  // damage, recurring ticks — since they all funnel through this function to apply HP loss.
  if (damage > 0) io.to(ROOM).emit('combat:damage:dealt', { targetId: charId, targetName: participant.name, damage });

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

export async function applyDamageToCreature(cid: string, targetId: string, damage: number): Promise<void> {
  const encounter = encounters.get(cid);
  if (!encounter) return;

  const creature = encounter.findCreature(targetId);
  if (!creature || creature.isDead()) return;

  creature.takeDamage(damage);
  io.to(ROOM).emit('creature:update', {
    id: targetId,
    currentHp: creature.currentHp,
    maxHp: creature.hp,
    effects: creature.effects,
  });
  if (damage > 0) io.to(ROOM).emit('combat:damage:dealt', { targetId, targetName: creature.name, damage });
  void saveEncounter(cid, encounter);

  if (creature.isDead()) {
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

          if (microDungeons.has(cid)) {
            // Combat-arena dungeon served its purpose — discard it and return to the world map
            microDungeons.delete(cid);
            dungeons.delete(cid);
            void clearDungeon(cid);
            io.to(ROOM).emit('dungeon:cleared');
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
function registerReactionOffers(cid: string, char: Character): void {
  const engine = getStateEngine(cid);
  for (const name of char.spells ?? []) {
    const spell = findSpell(name);
    if (!spell?.combat?.reactionTrigger) continue;
    engine.register(new ReactionOfferHook({
      // Deterministic so the two paths that roll player initiative (dungeon entry and the
      // combat_init effect) cannot register the same offer twice and double-prompt.
      id: `reaction-offer:${char.id}:${spell.name}`,
      ownerId: char.id,
      source: `Reaction: ${spell.name}`,
      spell,
    }));
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
    const mod = (char ? statMod(char.stats.dex) : 0) + (char?.initiativeBonus ?? 0);
    const maxHp = char ? calcMaxHp(char) : 0;
    const participant = new Participant({
      id: char?.id ?? name,
      name,
      initiative: new D20Roll().roll() + mod,
      isPlayer: true,
      teamId: 'players',
      currentHp: char?.currentHp ?? maxHp,
      maxHp,
    });
    playerTeam!.addParticipant(participant);
    if (char) registerReactionOffers(cid, char);
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
      });
      playerTeam!.addParticipant(p);
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
