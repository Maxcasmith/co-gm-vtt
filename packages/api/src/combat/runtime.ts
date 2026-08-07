import type { Character, EffectSpec, CreatureType } from 'shared';
import { statMod, calcAC, spellSlotsForClass } from 'shared';
import { updateCharacter, readChatLog, appendChatLog, saveEncounter, clearEncounter, clearDungeon, saveDungeon, listCharacters, loadPartyAllies, readQuests, writeQuests, readManifest, readNemeses, getConfig } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateCombatFlavour, evaluateNemesisCandidates } from '../session-processor/imagePrompts.ts';
import { toClientDungeon } from '../dungeon/index.ts';
import { Team, Participant } from '../domain/encounter.ts';
import { Creature } from '../domain/creature.ts';
import { logError } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, campaignPlayers, playerSocketIds, enemiesReady, combatStartedAt, dungeons, pendingWeaponBonuses, microDungeons, connected, withLivePositions } from '../state.ts';
import { D20Roll, rollDice, fmtMod, calcMaxHp, crToXp } from './dice.ts';
import { applyEffects } from '../effects.ts';
import { endSession, dispatchDMResponse } from '../session.ts';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isOccupied(positions: Record<string, { gx: number; gy: number }>, gx: number, gy: number, excludeId: string): boolean {
  return Object.entries(positions).some(([id, p]) => id !== excludeId && p.gx === gx && p.gy === gy);
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
    const deadMsg = { text: `${actor.name} has perished.`, senderName: 'Combat', timestamp: Date.now() };
    io.to(ROOM).emit('combat:player:dead', { characterId: actor.id, characterName: actor.name });
    io.to(ROOM).emit('chat:message', deadMsg);
    void appendChatLog(cid, deadMsg);
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

      const roll = new D20Roll().roll();
      const total = roll + atk.bonus;
      const hit = total >= targetAc;
      let damage: number | undefined;
      let remainingHp: number | undefined;
      let targetDead = false;

      if (hit) {
        damage = rollDice(atk.damage);

        if (targetParticipant.isPlayer && targetCharForAttack) {
          const playerParticipant = encounter.players.find(p => p.id === targetCharForAttack!.id);
          if (playerParticipant) {
            const wasDown = playerParticipant.isDown();
            playerParticipant.takeDamage(damage);
            void updateCharacter(cid, targetCharForAttack.id, c => ({ ...c, currentHp: playerParticipant.currentHp }));
            remainingHp = playerParticipant.currentHp;
            targetDead = playerParticipant.currentHp <= 0;
            io.to(ROOM).emit('combat:player:damage', {
              characterId: targetCharForAttack.id,
              characterName: targetParticipant.name,
              damage,
              currentHp: playerParticipant.currentHp,
              maxHp: playerParticipant.maxHp,
            });
            console.log(`[ai] ${actor.name} attacks ${targetParticipant.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — HIT ${damage} (${playerParticipant.currentHp}/${playerParticipant.maxHp} HP)`);

            if (wasDown) {
              playerParticipant.deathSaves.failures = Math.min(3, playerParticipant.deathSaves.failures + 2);
              playerParticipant.deathSaves.stable = false;
              const nowDead = playerParticipant.deathSaves.failures >= 3;
              const socketId = playerSocketIds.get(targetParticipant.id);
              if (socketId) {
                io.to(socketId).emit('combat:death:save', {
                  characterName: targetParticipant.name, roll: 0, isNatural20: false, isNatural1: false,
                  success: false, successes: playerParticipant.deathSaves.successes,
                  failures: playerParticipant.deathSaves.failures, stable: false, dead: nowDead,
                });
              }
              if (nowDead) {
                io.to(ROOM).emit('combat:player:dead', { characterId: targetCharForAttack.id, characterName: targetParticipant.name });
                const deadMsg = { text: `${targetParticipant.name} has perished.`, senderName: 'Combat', timestamp: Date.now() };
                io.to(ROOM).emit('chat:message', deadMsg);
                void appendChatLog(cid, deadMsg);
              }
            }
          }
        } else {
          // Ally or other non-player target — use creature damage path
          void applyDamageToCreature(cid, targetParticipant.id, damage);
          remainingHp = encounter.findCreature(targetParticipant.id)?.currentHp;
          targetDead = encounter.findCreature(targetParticipant.id)?.isDead() ?? false;
        }
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

export function endCombat(cid: string): void {
  void evaluateNemesisAfterCombat(cid);
  const encounter = encounters.get(cid);
  encounter?.teardown();
  encounters.delete(cid);
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
    endCombat(cid);
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
  void saveEncounter(cid, encounter);

  if (creature.isDead()) {
    console.log(`[combat] ${creature.name} is dead`);
    encounter.removeFromTurnOrder(targetId);
    void saveEncounter(cid, encounter);

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
          endCombat(cid);
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
  }
}

export function advanceTurn(cid: string) {
  if (!combatState.get(cid)) return;
  const encounter = encounters.get(cid);
  if (!encounter?.turnOrder.length) return;
  const before = encounter.currentActor?.name ?? '?';
  encounter.advanceTurn();
  const after = encounter.currentActor?.name ?? '?';
  console.log(`[turn] advanceTurn: ${before} → ${after} (order=[${encounter.turnOrder.map(p => p.name).join(',')}])`);
  emitTurn(cid);
  void saveEncounter(cid, encounter);
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

      const expected = encounter.expectedParticipantCount;
      if (encounter.turnOrder.length >= expected && expected > 0 && !encounter.currentRound && enemiesReady.get(cid)) {
        encounter.beginCombat();
        emitTurn(cid);
      }
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
