import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, Player, CharacterStats, TurnOrderEntry, Character, Weapon, SpellAttackResult, SpellSaveResult, SpellSaveOutcome, EnemyStatBlock, NemesisRecord, Dungeon, DungeonEntity } from 'shared';
import { hasLineOfSight } from 'shared';
import { Weapon as WeaponClass, CLASS_WEAPON_PROFS, CLASS_SPELLCASTING_ABILITY, CLASS_SAVING_THROWS, resolveSpellDamageDice, calcAC } from 'shared';
import { configRouter } from './routes/config.ts';
import { campaignsRouter } from './routes/campaigns.ts';
import { compendiumRouter } from './routes/compendium.ts';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getCharacter, updateCharacter, readChatLog, appendChatLog, listEntitySlugs, readEntity, writeEntity, getWorldMeta, getConfig, CAMPAIGNS_DIR, saveEncounter, loadEncounter, clearEncounter, readWorldState, writeWorldState, readCampaignFile, listCharacters, loadPartyAllies, savePartyAllies, saveDungeon, loadDungeon, clearDungeon, readManifest, writeManifest, emptyManifest, parseEntityLinks, readQuests, writeQuests, readNemeses, writeNemeses } from './storage.ts';
import { generateDungeon, generateEncounterDungeon, describeDungeonState, toClientDungeon } from './dungeon/index.ts';
import { getStoryProvider, getCombatProvider } from './providers/index.ts';
import { buildRecapPrompt } from './session-processor/prompts.ts';
import { processSession, getDMResponse, ensureSessionQuests } from './session-processor/index.ts';
import { generateEncounterEnemies, generateCombatFlavour, resolveImprovisedAction, generateWorldState, tickWorldNarrative, evaluateNemesisCandidates } from './session-processor/imagePrompts.ts';
import { mapsRouter } from './routes/maps.ts';
import { adminRouter } from './routes/admin.ts';
import { spellsRouter } from './routes/spells.ts';
import { randomUUID } from 'crypto';
import { Encounter, Team, Participant } from './domain/encounter.ts';
import { Creature } from './domain/creature.ts';
import { processVdmResponse, type TagEffect, type AcquiredItem } from './tag-processor.ts';
import { logError, logDebug } from './logger.ts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use('/api/config', configRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/campaigns', mapsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/compendium', compendiumRouter);
app.use('/api/spells', spellsRouter);

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

const ROOM = 'sandbox';

// ponytail: intercept console.log to broadcast logs to connected clients for the combat log overlay
const _origLog = console.log;
console.log = (...args: unknown[]) => {
  _origLog(...args);
  try {
    const text = args.map(a => { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch (err) { logError('index:consoleLogOverride:stringify', err); return String(a); } }).join(' ');
    io.to(ROOM).emit('combat:log', { text, timestamp: Date.now() });
  } catch (err) { logError('index:consoleLogOverride', err); }
};

const connected = new Set<Player>();
const sessionState = new Map<string, boolean>();
const combatState = new Map<string, boolean>();
const encounters = new Map<string, Encounter>();
const tokenPositions = new Map<string, Record<string, { gx: number; gy: number }>>();
const dmQueue = new Map<string, Promise<void>>();
const campaignPlayers = new Map<string, string[]>();
const playerSocketIds = new Map<string, string>(); // charId → socketId (for private events)
const enemiesReady   = new Map<string, boolean>();  // true once rollEnemyInitiatives has fired
const combatStartedAt = new Map<string, number>();  // timestamp when combat_init fired, for nemesis transcript slicing
const dungeons = new Map<string, Dungeon>(); // in-memory mirror of saveDungeon/loadDungeon, mutated on reveal
const microDungeons = new Set<string>(); // cids whose current dungeon is an ephemeral combat arena — discarded on victory instead of continued

const PLAYER_SIGHT_RADIUS = 20; // square (Chebyshev) radius, in cells
const ENEMY_AGGRO_RADIUS  = 12;

const NEMESIS_COOLDOWN_SESSIONS = 2;
const NEMESIS_CAP_PER_TARGET = 3;
const NEMESIS_MAX_DEATHS = 3;
const ALLY_XP_PER_LEVEL = 100;
const CR_STEPS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 8];

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escalateCr(cr: number): number {
  const next = CR_STEPS.find(c => c > cr);
  return next ?? cr + 1;
}

const HIT_DICE: Record<string, number> = {
  Artificer: 8, Barbarian: 12, Bard: 8, Cleric: 8, Druid: 8,
  Fighter: 10, Monk: 8, Paladin: 10, Ranger: 10, Rogue: 8,
  Sorcerer: 6, Warlock: 8, Wizard: 6,
};
function calcMaxHp(char: Character): number {
  return (char.maxHp ?? ((HIT_DICE[char.class] ?? 8) + statMod(char.stats.con)));
}

const CR_XP: [number, number][] = [
  [0, 10], [0.125, 25], [0.25, 50], [0.5, 100],
  [1, 200], [2, 450], [3, 700], [4, 1100], [5, 1800],
  [6, 2300], [7, 2900], [8, 3900], [9, 5000], [10, 5900],
];
function crToXp(cr: number): number { return CR_XP.find(([c]) => c === cr)?.[1] ?? Math.round(cr * 200); }

function rollDice(formula: string): number {
  const m = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!m) return 1;
  let total = parseInt(m[3] ?? '0');
  for (let i = 0; i < parseInt(m[1]!); i++) total += Math.floor(Math.random() * parseInt(m[2]!)) + 1;
  return Math.max(1, total);
}

function emitTurn(cid: string) {
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isOccupied(positions: Record<string, { gx: number; gy: number }>, gx: number, gy: number, excludeId: string): boolean {
  return Object.entries(positions).some(([id, p]) => id !== excludeId && p.gx === gx && p.gy === gy);
}

async function runDeathSave(cid: string, actor: Participant): Promise<void> {
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

async function runEnemyAI(cid: string, actor: Participant): Promise<void> {
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
      const cfgAdapter = getCombatProvider(cfg);
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

async function evaluateNemesisAfterCombat(cid: string): Promise<void> {
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
    if (!config.tiers[config.tasks.combat].length) return;
    const adapter = getCombatProvider(config);

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

function endCombat(cid: string): void {
  void evaluateNemesisAfterCombat(cid);
  const encounter = encounters.get(cid);
  encounter?.teardown();
  encounters.delete(cid);
  combatStartedAt.delete(cid);
  void clearEncounter(cid);
}

function endSession(cid: string): void {
  if (!sessionState.get(cid)) return;
  sessionState.set(cid, false);
  io.to(ROOM).emit('session:state', false);
  const dungeon = dungeons.get(cid);
  if (dungeon) {
    dungeon.positions = tokenPositions.get(cid) ?? {};
    void saveDungeon(cid, dungeon);
  }
  void readManifest(cid).then(manifest => {
    const m = manifest ?? emptyManifest();
    m.sessionsPlayed = (m.sessionsPlayed ?? 0) + 1;
    void writeManifest(cid, m);
  });
  void processSession(cid).then(async result => {
    const names = [...(result.updated ?? []), ...(result.created ?? []), ...(result.cascaded ?? [])];
    const text = result.skipped
      ? 'Session ended — no chat to process.'
      : `Session ended — notes updated: ${names.join(', ') || 'nothing new'}`;
    io.to(ROOM).emit('chat:message', { text, senderName: 'System', timestamp: Date.now() });
    const [quests, manifest] = await Promise.all([readQuests(cid), readManifest(cid)]);
    io.to(ROOM).emit('quest:update', { quests, act: manifest?.act ?? 1 });
  });
}

function endCombatDefeated(cid: string): void {
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

async function applyDamageToCreature(cid: string, targetId: string, damage: number): Promise<void> {
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
              io.to(ROOM).emit('dungeon:loaded', toClientDungeon(dungeon));
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
            io.to(ROOM).emit('dungeon:loaded', toClientDungeon(dungeon));
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

function advanceTurn(cid: string) {
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

async function rollPlayerInitiatives(cid: string, chars: Character[]): Promise<void> {
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

function rollEnemyInitiatives(cid: string): void {
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

function addToTurnOrder(cid: string, entries: Participant[], baseDelay = 0): void {
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

function queueDMResponse(campaignId: string, fn: () => Promise<void>): void {
  const prev = dmQueue.get(campaignId) ?? Promise.resolve();
  dmQueue.set(campaignId, prev.then(fn).catch(err => logError('index:queueDMResponse', err)));
}

async function generateAndBroadcastEnemies(campaignId: string): Promise<void> {
  try {
    io.to(ROOM).emit('encounter:generating');
    const config = await getConfig();
    const adapter = getCombatProvider(config);
    if (!config.tiers[config.tasks.combat].length) console.warn('[encounter] no combat models configured, using fallback');

    const [messages, characters, nemeses, manifest] = await Promise.all([
      readChatLog(campaignId),
      listCharacters(campaignId),
      readNemeses(campaignId),
      readManifest(campaignId),
    ]);

    const sessionsPlayed = manifest?.sessionsPlayed ?? 0;
    const characterNames = characters.map(c => c.name);
    const availableNemeses = nemeses.filter(n =>
      n.status === 'active' &&
      n.cooldownUntilSession <= sessionsPlayed &&
      (n.boundTo === 'party' || characterNames.includes(n.boundTo))
    );

    const statBlocks = await generateEncounterEnemies(messages, characters, adapter, availableNemeses);

    const encounter = encounters.get(campaignId);
    if (!encounter) return;

    let enemyTeam = encounter.teams.find(t => t.name === 'Enemies');
    if (!enemyTeam) {
      enemyTeam = new Team('enemies', 'Enemies');
      encounter.addTeam(enemyTeam);
    }

    // Assign a fresh UUID per combat slot so duplicate-name enemies have unique IDs
    const uniqueStatBlocks = statBlocks.map(sb => ({ ...sb, id: randomUUID() }));

    for (const sb of uniqueStatBlocks) {
      const creature = Creature.from(sb);
      enemyTeam.addParticipant(new Participant({
        id: creature.id,
        name: creature.name,
        initiative: 0,
        isPlayer: false,
        teamId: 'enemies',
        creature,
      }));
    }

    encounter.expectedParticipantCount += uniqueStatBlocks.length;
    await saveEncounter(campaignId, encounter);
    io.to(ROOM).emit('encounter:ready', uniqueStatBlocks);
    console.log('[encounter] ready:', statBlocks.map(e => `${e.name} (CR ${e.cr})`).join(', '));

    // World-map combat (no dungeon already loaded — the only case that reaches this function at
    // all now that combat_init is hard-blocked while a real dungeon exists): spawn a bare
    // combat-arena dungeon instead of an AI backdrop image — same rendering/fog/movement path as
    // any other dungeon, discarded on victory.
    if (!dungeons.has(campaignId)) {
      const dungeon = generateEncounterDungeon(uniqueStatBlocks);
      dungeon.arena = true;
      dungeons.set(campaignId, dungeon);
      microDungeons.add(campaignId);
      await saveDungeon(campaignId, dungeon);
      io.to(ROOM).emit('dungeon:loaded', toClientDungeon(dungeon));

      const positions = tokenPositions.get(campaignId) ?? {};
      for (const entity of dungeon.entities) {
        positions[entity.id] = { gx: entity.x, gy: entity.y };
        io.to(ROOM).emit('token:moved', { tokenId: entity.id, gx: entity.x, gy: entity.y });
      }
      tokenPositions.set(campaignId, positions);
    }

    if (combatState.get(campaignId)) rollEnemyInitiatives(campaignId);
  } catch (err) {
    logError('index:generateAndBroadcastEnemies', err);
  }
}

// Starts combat straight from dungeon-placed creatures (their stat blocks were already generated
// at dungeon-gen time) — same shape as combat_init/generateAndBroadcastEnemies, minus the LLM calls
// and map regeneration, since the dungeon map stays as-is.
async function startDungeonCombat(cid: string, triggerEntities: DungeonEntity[]): Promise<void> {
  if (combatState.get(cid)) return;
  combatState.set(cid, true);
  enemiesReady.set(cid, false);
  combatStartedAt.set(cid, Date.now());
  encounters.set(cid, Encounter.empty(cid));
  io.to(ROOM).emit('combat:state', true);

  void listCharacters(cid).then(chars => rollPlayerInitiatives(cid, chars));

  const encounter = encounters.get(cid)!;
  const enemyTeam = new Team('enemies', 'Enemies');
  encounter.addTeam(enemyTeam);

  // id = the originating DungeonEntity's id, not a fresh one — keeps the combat participant and the
  // dungeon entity as the same row, so a post-combat victory can trace kills back to remove them.
  const triggered = triggerEntities.filter((e): e is DungeonEntity & { statBlock: EnemyStatBlock } => !!e.statBlock);
  const uniqueStatBlocks = triggered.map(e => ({ ...e.statBlock, id: e.id }));

  for (const sb of uniqueStatBlocks) {
    const creature = Creature.from(sb);
    enemyTeam.addParticipant(new Participant({
      id: creature.id,
      name: creature.name,
      initiative: 0,
      isPlayer: false,
      teamId: 'enemies',
      creature,
    }));
  }

  encounter.expectedParticipantCount += uniqueStatBlocks.length;
  await saveEncounter(cid, encounter);
  io.to(ROOM).emit('encounter:ready', uniqueStatBlocks);
  console.log('[dungeon] combat triggered:', uniqueStatBlocks.map(e => `${e.name} (CR ${e.cr})`).join(', '));

  const positions = tokenPositions.get(cid) ?? {};
  for (const e of triggered) {
    positions[e.id] = { gx: e.x, gy: e.y };
    io.to(ROOM).emit('token:moved', { tokenId: e.id, gx: e.x, gy: e.y });
  }
  tokenPositions.set(cid, positions);

  rollEnemyInitiatives(cid);
}

// Runs on every player token move while a dungeon is loaded: reveals creatures within sight, and
// either starts combat (not already fighting) or pulls newly-aggro'd creatures into the running
// fight (already fighting) when one comes within its own aggro radius.
async function checkDungeonProximity(cid: string, gx: number, gy: number): Promise<void> {
  const dungeon = dungeons.get(cid);
  if (!dungeon) return;
  const inCombat = combatState.get(cid);
  const encounter = inCombat ? encounters.get(cid) : undefined;

  let changed = false;
  const aggro: DungeonEntity[] = [];

  for (const entity of dungeon.entities) {
    if (entity.type !== 'creature') continue;
    if (encounter?.findParticipant(entity.id)) continue; // already in this fight
    const dist = Math.max(Math.abs(gx - entity.x), Math.abs(gy - entity.y));
    const seen = dist <= PLAYER_SIGHT_RADIUS && hasLineOfSight(dungeon.cells, gx, gy, entity.x, entity.y);
    if (!entity.discovered && seen) { entity.discovered = true; changed = true; }
    if (dist <= ENEMY_AGGRO_RADIUS && seen) aggro.push(entity);
  }

  if (changed) {
    void saveDungeon(cid, dungeon);
    io.to(ROOM).emit('dungeon:loaded', toClientDungeon(dungeon));
  }
  if (!aggro.length) return;
  if (inCombat) joinReinforcements(cid, aggro);
  else await startDungeonCombat(cid, aggro);
}

// Mid-fight version of startDungeonCombat: splices newly-aggro'd creatures into the running
// encounter — rolls initiative, doesn't touch whose turn it currently is (addToTurnOrder re-anchors
// the current actor), and re-broadcasts the full enemy list so their tokens render.
function joinReinforcements(cid: string, triggerEntities: DungeonEntity[]): void {
  const encounter = encounters.get(cid);
  if (!encounter) { logDebug('joinReinforcements BLOCKED — no live encounter'); return; }

  let enemyTeam = encounter.teams.find(t => t.name === 'Enemies');
  if (!enemyTeam) {
    enemyTeam = new Team('enemies', 'Enemies');
    encounter.addTeam(enemyTeam);
  }

  const joined = triggerEntities.filter((e): e is DungeonEntity & { statBlock: EnemyStatBlock } => !!e.statBlock);
  const entries = joined.map(e => {
    const creature = Creature.from({ ...e.statBlock, id: e.id });
    const p = new Participant({
      id: creature.id,
      name: creature.name,
      initiative: new D20Roll().roll() + statMod(creature.stats.dex),
      isPlayer: false,
      teamId: 'enemies',
      creature,
    });
    enemyTeam!.addParticipant(p);
    return p;
  });

  encounter.expectedParticipantCount += entries.length;
  addToTurnOrder(cid, entries);

  io.to(ROOM).emit('encounter:ready', encounter.enemies.filter(p => p.creature).map(p => p.creature!.toStatBlock()));

  const positions = tokenPositions.get(cid) ?? {};
  for (const e of joined) {
    positions[e.id] = { gx: e.x, gy: e.y };
    io.to(ROOM).emit('token:moved', { tokenId: e.id, gx: e.x, gy: e.y });
  }
  tokenPositions.set(cid, positions);

  for (const name of joined.map(e => e.name)) {
    const joinMsg = { text: `${name} joins the fight!`, senderName: 'Combat', timestamp: Date.now() };
    io.to(ROOM).emit('chat:message', joinMsg);
    void appendChatLog(cid, joinMsg);
  }
}

// Perception/Investigation checks compare against hideDC for undiscovered loot/traps within sight
// Returns a grounded note for the DM's next response: what this roll found (or that it found
// nothing conclusive), so the narration matches the map instead of improvising blind. Returns
// null when there's nothing dungeon-related to say at all (no dungeon, or nothing nearby).
async function checkDungeonHiddenReveal(cid: string, characterName: string, total: number): Promise<string | null> {
  const dungeon = dungeons.get(cid);
  const pos = tokenPositions.get(cid)?.[characterName];
  if (!dungeon || !pos) return null;

  let changed = false;
  const found: string[] = [];
  let nearbyUncleared = false;
  for (const entity of dungeon.entities) {
    if (entity.type === 'creature' || entity.discovered || entity.hideDC === undefined) continue;
    if (Math.max(Math.abs(pos.gx - entity.x), Math.abs(pos.gy - entity.y)) > PLAYER_SIGHT_RADIUS) continue;
    if (!hasLineOfSight(dungeon.cells, pos.gx, pos.gy, entity.x, entity.y)) continue;
    if (total < entity.hideDC) { nearbyUncleared = true; continue; }
    entity.discovered = true;
    changed = true;
    found.push(entity.name);
    console.log(`[dungeon] ${characterName} notices ${entity.name}`);
  }

  if (changed) {
    void saveDungeon(cid, dungeon);
    io.to(ROOM).emit('dungeon:loaded', toClientDungeon(dungeon));
    return `${characterName}'s check finds: ${found.join(', ')}.`;
  }
  if (nearbyUncleared) return `${characterName}'s check finds nothing conclusive — whatever's here stays hidden for now.`;
  return null;
}

async function buildEntitySummaries(campaignId: string): Promise<string> {
  const lines: string[] = [];

  // World bible — generated campaigns; absent for modules, that's fine
  for (const filename of ['world.md', 'factions.md']) {
    try {
      const content = await readFile(path.join(CAMPAIGNS_DIR, campaignId, filename), 'utf-8');
      lines.push(`### ${filename}\n${content.slice(0, 1000)}`);
    } catch (err) { logError('index:buildEntitySummaries', err); }
  }

  // Characters — always load (the active party)
  const charSlugs = await listEntitySlugs(campaignId, 'character');
  for (const slug of charSlugs) {
    const content = await readEntity(campaignId, 'character', slug);
    if (content) lines.push(`### character/${slug}\n${content.slice(0, 500)}`);
  }

  const manifest = await readManifest(campaignId);
  if (!manifest) return lines.join('\n\n') || '(no entity notes yet)';

  // Current location — full content (scene text + DM notes)
  if (manifest.currentLocation) {
    const content = await readEntity(campaignId, 'location', manifest.currentLocation);
    if (content) lines.push(`### location/${manifest.currentLocation} [CURRENT]\n${content}`);
  }

  // NPCs and factions in current scene
  for (const slug of manifest.npcs) {
    const content = await readEntity(campaignId, 'npc', slug);
    if (content) lines.push(`### npc/${slug}\n${content.slice(0, 800)}`);
  }
  for (const slug of manifest.factions) {
    const content = await readEntity(campaignId, 'faction', slug);
    if (content) lines.push(`### faction/${slug}\n${content.slice(0, 600)}`);
  }

  // Adjacent zones — names only so DM can narrate transitions
  if (manifest.connectedZones.length) {
    lines.push(`### Connected zones\n${manifest.connectedZones.join(', ')}`);
  }

  return lines.join('\n\n') || '(no entity notes yet)';
}

async function runRecap(campaignId: string): Promise<{ text: string; isFirstSession: boolean }> {
  const sessionsDir = path.join(CAMPAIGNS_DIR, campaignId, 'sessions');
  const isFirstSession = !existsSync(sessionsDir) || (await readdir(sessionsDir)).length === 0;

  let lastSessionText: string | null = null;
  if (!isFirstSession) {
    const files = (await readdir(sessionsDir)).sort();
    const last = files[files.length - 1];
    if (last) {
      try {
        const raw = await readFile(path.join(sessionsDir, last), 'utf-8');
        const msgs = JSON.parse(raw) as Array<{ senderName: string; text: string }>;
        lastSessionText = msgs.map(m => `[${m.senderName}]: ${m.text}`).join('\n');
      } catch (err) { logError('index:runRecap', err); }
    }
  }

  const entitySummaries = await buildEntitySummaries(campaignId);
  const meta = await getWorldMeta(campaignId);
  const config = await getConfig();
  const provider = getStoryProvider(config);
  const text = await provider.complete(buildRecapPrompt(lastSessionText, entitySummaries, meta?.name ?? 'Unknown World', isFirstSession));
  return { text, isFirstSession };
}

const STAT_FULL: Record<string, string> = {
  STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution',
  INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma',
};

const BG_SKILLS: Record<string, string[]> = {
  Acolyte:       ['Insight', 'Religion'],
  Charlatan:     ['Deception', 'Sleight of Hand'],
  Criminal:      ['Deception', 'Stealth'],
  Entertainer:   ['Acrobatics', 'Performance'],
  'Folk Hero':   ['Animal Handling', 'Survival'],
  Gladiator:     ['Acrobatics', 'Performance'],
  'Guild Artisan':['Insight', 'Persuasion'],
  Hermit:        ['Medicine', 'Religion'],
  Noble:         ['History', 'Persuasion'],
  Outlander:     ['Athletics', 'Survival'],
  Sage:          ['Arcana', 'History'],
  Sailor:        ['Athletics', 'Perception'],
  Soldier:       ['Athletics', 'Intimidation'],
  Urchin:        ['Sleight of Hand', 'Stealth'],
};

const SAVE_PROFS: Record<string, string[]> = {
  Barbarian: ['STR', 'CON'], Bard:    ['DEX', 'CHA'], Cleric:   ['WIS', 'CHA'],
  Druid:     ['INT', 'WIS'], Fighter: ['STR', 'CON'], Monk:     ['STR', 'DEX'],
  Paladin:   ['WIS', 'CHA'], Ranger:  ['STR', 'DEX'], Rogue:    ['DEX', 'INT'],
  Sorcerer:  ['CON', 'CHA'], Warlock: ['WIS', 'CHA'], Wizard:   ['INT', 'WIS'],
};

class D20Roll {
  withAdvantage: boolean;
  withDisadvantage: boolean;

  constructor(opts?: { withAdvantage?: boolean; withDisadvantage?: boolean }) {
    this.withAdvantage = opts?.withAdvantage ?? false;
    this.withDisadvantage = opts?.withDisadvantage ?? false;
  }

  roll(): number {
    const raw = () => Math.floor(Math.random() * 20) + 1;
    const adv = this.withAdvantage && !this.withDisadvantage;
    const dis = this.withDisadvantage && !this.withAdvantage;
    const r1 = raw();
    if (!adv && !dis) return r1;
    const r2 = raw();
    return adv ? Math.max(r1, r2) : Math.min(r1, r2);
  }
}
function statMod(score: number) { return Math.floor((score - 10) / 2); }
function fmtMod(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

async function applyEffects(cid: string, effects: TagEffect[]): Promise<void> {
  await Promise.all(consolidateEffects(effects).map(async effect => {
    if (effect.type === 'combat_init' && !combatState.get(cid)) {
      // Hard guard, not just a prompt instruction: while a real dungeon is loaded, combat must
      // only ever start through the dungeon's own aggro system (checkDungeonProximity /
      // startDungeonCombat), which spawns creatures already placed in dungeon.entities. The DM
      // is told not to emit COMBAT_INIT here, but that's advisory — a model can still slip and
      // emit it (e.g. right after a combat-flavoured victory narration), and if unguarded this
      // routes into the world-map path (generateAndBroadcastEnemies, a fresh LLM call unrelated
      // to any dungeon entity) — a second, parallel combat system running alongside the real one.
      if (dungeons.has(cid)) {
        logDebug(`combat_init ignored — real dungeon already loaded for ${cid}, DM should not have emitted this tag`);
        return;
      }
      combatState.set(cid, true);
      enemiesReady.set(cid, false);
      combatStartedAt.set(cid, Date.now());
      encounters.set(cid, Encounter.empty(cid));
      io.to(ROOM).emit('combat:state', true);
      void listCharacters(cid).then(chars => rollPlayerInitiatives(cid, chars));
      void generateAndBroadcastEnemies(cid);
    } else if (effect.type === 'inventory_add') {
      const chars = await listCharacters(cid);
      const char = chars.find(c => c.name === effect.player);
      if (!char) return;
      await updateCharacter(cid, char.id, c => ({ ...c, inventory: [...(c.inventory ?? []), ...effect.items] }));
      const sid = playerSocketIds.get(char.id);
      if (sid) io.to(sid).emit('character:inventory:add', effect.items);
    } else if (effect.type === 'scene_build') {
      const locationSlug = effect.locationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = await readEntity(cid, 'location', locationSlug);
      const updated = existing
        ? `${existing.trimEnd()}\n- ${effect.detail}`
        : `# ${effect.locationName}\n\n## Scene Notes\n- ${effect.detail}`;
      await writeEntity(cid, 'location', locationSlug, updated);
      console.log(`[scene] updated location notes: ${locationSlug}`);

      // Update manifest: new current location, parse linked entities from the file
      const links = parseEntityLinks(updated);
      const manifest = await readManifest(cid) ?? emptyManifest();
      manifest.currentLocation = locationSlug;
      manifest.connectedZones = links.locations;
      for (const npc of links.npcs) { if (!manifest.npcs.includes(npc)) manifest.npcs.push(npc); }
      for (const faction of links.factions) { if (!manifest.factions.includes(faction)) manifest.factions.push(faction); }
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(cid, manifest);
      console.log(`[manifest] location → ${locationSlug}, zones: [${links.locations.join(', ')}]`);
    } else if (effect.type === 'npc_build') {
      const npcSlug = effect.npcName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = await readEntity(cid, 'npc', npcSlug);
      const updated = existing
        ? `${existing.trimEnd()}\n- ${effect.detail}`
        : `# ${effect.npcName}\n\n## Observed\n- ${effect.detail}`;
      await writeEntity(cid, 'npc', npcSlug, updated);
      console.log(`[npc] updated npc notes: ${npcSlug}`);

      // Add to manifest so this NPC loads in future prompts
      const manifest = await readManifest(cid) ?? emptyManifest();
      if (!manifest.npcs.includes(npcSlug)) {
        manifest.npcs.push(npcSlug);
        manifest.updatedAt = new Date().toISOString();
        await writeManifest(cid, manifest);
      }
    } else if (effect.type === 'dungeon_gen') {
      const config = await getConfig();
      if (!config.tiers[config.tasks.combat].length) { console.warn('[dungeon] no models configured — skipping dungeon generation'); return; }
      console.log(`[dungeon] generating: ${effect.name}`);
      io.to(ROOM).emit('dungeon:generating');
      const recentChat = await readChatLog(cid);
      const storyContext = recentChat.slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');
      const dungeon = await generateDungeon(effect.name, effect.dungeonType, getCombatProvider(config), storyContext);
      dungeons.set(cid, dungeon);
      await saveDungeon(cid, dungeon);
      io.to(ROOM).emit('dungeon:loaded', toClientDungeon(dungeon));
      console.log(`[dungeon] generated and broadcast: ${dungeon.name} (${dungeon.rooms.length} rooms, ${dungeon.entities.length} entities)`);
    } else if (effect.type === 'dungeon_exit') {
      if (combatState.get(cid) || !dungeons.has(cid)) return; // don't rip the map out from under an active fight, or if there's nothing loaded
      dungeons.delete(cid);
      microDungeons.delete(cid);
      await clearDungeon(cid);
      io.to(ROOM).emit('dungeon:cleared');
      console.log('[dungeon] party left — cleared');
    } else if (effect.type === 'party_join') {
      const currentAllies = await loadPartyAllies(cid);
      const alreadyPresent = currentAllies.some(a => a.name === effect.ally.name);
      if (alreadyPresent) return;
      await savePartyAllies(cid, [...currentAllies, effect.ally]);

      const encounter = encounters.get(cid);
      if (encounter && combatState.get(cid)) {
        const playerTeam = encounter.teams.find(t => t.name === 'Players');
        if (!playerTeam) return;
        const creature = Creature.from(effect.ally);
        const p = new Participant({
          id: creature.id,
          name: creature.name,
          initiative: new D20Roll().roll() + statMod(creature.stats.dex),
          isPlayer: false,
          teamId: 'players',
          creature,
        });
        playerTeam.addParticipant(p);
        encounter.expectedParticipantCount += 1;
        addToTurnOrder(cid, [p]);
        const joinMsg = { text: `${creature.name} joins the fight!`, senderName: 'Combat', timestamp: Date.now() };
        io.to(ROOM).emit('chat:message', joinMsg);
        void appendChatLog(cid, joinMsg);
      }
    } else if (effect.type === 'quest_add' || effect.type === 'quest_update' || effect.type === 'quest_resolve') {
      const quests = await readQuests(cid);
      const today = new Date().toISOString().slice(0, 10);

      if (effect.type === 'quest_add') {
        const existing = quests.find(q => q.id === effect.id);
        if (existing) {
          existing.status = 'open';
        } else {
          quests.push({ id: effect.id, name: effect.name, description: effect.description, status: 'open', log: [], addedAt: today });
        }
      } else if (effect.type === 'quest_update') {
        const q = quests.find(q => q.id === effect.id);
        if (q) q.log.push({ date: today, text: effect.entry });
      } else if (effect.type === 'quest_resolve') {
        const q = quests.find(q => q.id === effect.id);
        if (q) q.status = 'resolved';
      }

      await writeQuests(cid, quests);
      const manifest = await readManifest(cid);
      io.to(ROOM).emit('quest:update', { quests, act: manifest?.act ?? 1 });
    } else if (effect.type === 'clock') {
      const manifest = await readManifest(cid) ?? emptyManifest();
      manifest.worldTimeSecs = (manifest.worldTimeSecs ?? 43200) + effect.secs;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(cid, manifest);
      io.to(ROOM).emit('clock:update', { worldTimeSecs: manifest.worldTimeSecs });
    } else if (effect.type === 'nemesis_create') {
      const slug = toSlug(effect.name);
      const manifest = await readManifest(cid) ?? emptyManifest();
      const records = await readNemeses(cid);
      const existingIdx = records.findIndex(r => r.id === slug);

      if (existingIdx >= 0) {
        const record = records[existingIdx]!;
        if (record.status === 'retired') return;
        record.deathCount += 1;
        record.statBlock = {
          ...record.statBlock,
          hp: Math.round(record.statBlock.hp * 1.3),
          ac: record.statBlock.ac + 1,
          cr: escalateCr(record.statBlock.cr),
        };
        record.cooldownUntilSession = manifest.sessionsPlayed + NEMESIS_COOLDOWN_SESSIONS;
        record.status = record.deathCount >= NEMESIS_MAX_DEATHS ? 'retired' : 'active';
        records[existingIdx] = record;
        console.log(`[nemesis] ${effect.name} returns — death #${record.deathCount}${record.status === 'retired' ? ', retired' : ''}`);
      } else {
        const activeForTarget = records.filter(r => r.boundTo === effect.boundTo && r.status === 'active').length;
        if (activeForTarget >= NEMESIS_CAP_PER_TARGET) {
          console.log(`[nemesis] cap reached for ${effect.boundTo}, skipping ${effect.name}`);
          return;
        }
        const statBlock: EnemyStatBlock = effect.statBlock
          ? { ...effect.statBlock, id: randomUUID(), name: effect.name }
          : { id: randomUUID(), name: effect.name, cr: 0.25, hp: 11, ac: 12, speed: 30, stats: { str: 11, dex: 11, con: 11, int: 8, wis: 8, cha: 8 }, attacks: [{ name: 'Attack', bonus: 3, damage: '1d6+1' }] };

        records.push({
          id: slug,
          name: effect.name,
          boundTo: effect.boundTo,
          status: 'active',
          deathCount: 0,
          cooldownUntilSession: manifest.sessionsPlayed + NEMESIS_COOLDOWN_SESSIONS,
          statBlock,
          createdAtSession: manifest.sessionsPlayed,
        });

        const today = new Date().toISOString().slice(0, 10);
        const stub = `---\ntype: nemesis\nname: ${effect.name}\nboundTo: ${effect.boundTo}\nstatus: active\ndeathCount: 0\nlast_updated: ${today}\n---\n\n${effect.detail}\n\n## Session Notes\n- ${today}: ${effect.detail}`;
        await writeEntity(cid, 'nemesis', slug, stub);
        console.log(`[nemesis] created: ${effect.name} (bound to ${effect.boundTo})`);
      }
      await writeNemeses(cid, records);
    } else if (effect.type === 'nemesis_retire') {
      const records = await readNemeses(cid);
      const record = records.find(r => r.id === toSlug(effect.name));
      if (!record) return;
      record.status = 'retired';
      await writeNemeses(cid, records);
      console.log(`[nemesis] retired: ${effect.name}`);
    } else if (effect.type === 'ally_xp') {
      const allies = await loadPartyAllies(cid);
      const idx = allies.findIndex(a => a.name.toLowerCase() === effect.allyName.toLowerCase());
      if (idx === -1) return;
      const ally = allies[idx]!;
      const xp = (ally.xp ?? 0) + effect.amount;
      const level = ally.level ?? 1;
      if (xp >= ALLY_XP_PER_LEVEL) {
        allies[idx] = { ...ally, xp: xp - ALLY_XP_PER_LEVEL, level: level + 1, hp: ally.hp + 5, ac: ally.ac + 1 };
        console.log(`[ally] ${ally.name} leveled up to ${level + 1}`);
      } else {
        allies[idx] = { ...ally, xp };
      }
      await savePartyAllies(cid, allies);
    } else if (effect.type === 'ally_learn') {
      const allies = await loadPartyAllies(cid);
      const idx = allies.findIndex(a => a.name.toLowerCase() === effect.allyName.toLowerCase());
      if (idx === -1) return;
      const ally = allies[idx]!;
      allies[idx] = { ...ally, attacks: [...ally.attacks, { name: effect.attackName, bonus: effect.bonus, damage: effect.damageFormula }] };
      await savePartyAllies(cid, allies);
      console.log(`[ally] ${ally.name} learned ${effect.attackName}`);
    }
  }));
}

function buildAdminEffect(tagType: string, name: string, detail: string, player: string): TagEffect | null {
  const id = randomUUID();
  switch (tagType) {
    case 'ADD_INVENTORY_CONSUMABLE':
      return { type: 'inventory_add', player, items: [{ id, type: 'consumable', name, description: detail, quantity: 1, effect: detail, actionCost: 'action' } as AcquiredItem] };
    case 'ADD_INVENTORY_ITEM':
      return { type: 'inventory_add', player, items: [{ id, type: 'item', name, description: detail, quantity: 1 } as AcquiredItem] };
    case 'ADD_INVENTORY_WEAPON':
      return { type: 'inventory_add', player, items: [{ id, type: 'weapon', name, description: detail, quantity: 1, damage: '1d4', damageType: 'bludgeoning', attackBonus: 0, range: 5, properties: [], isFinesse: false } as AcquiredItem] };
    case 'ADD_INVENTORY_AMMO':
      return { type: 'inventory_add', player, items: [{ id, type: 'ammunition', name, description: detail, quantity: parseInt(detail) || 20 } as AcquiredItem] };
    default:
      return null;
  }
}

const ADMIN_HELP = `Admin commands:
• /admin help — show this list
• /admin say "text" — force the Virtual DM to say exactly that text
• /admin [[ADD_INVENTORY_CONSUMABLE:name|description]] — add a consumable to your inventory
• /admin [[ADD_INVENTORY_ITEM:name|description]] — add a generic item to your inventory
• /admin [[ADD_INVENTORY_WEAPON:name|description]] — add a weapon (1d4 bludgeoning, range 5) to your inventory
• /admin [[ADD_INVENTORY_AMMO:name|quantity]] — add ammunition to your inventory

World-building (written to entity files, injected into future DM context):
• [[SCENE_BUILD:Location Name:physical details]] — add spatial facts to a location
• [[NPC_BUILD:NPC Name:observed detail]] — add observed facts to an NPC`;

async function handleAdminCommand(cid: string, senderId: string, senderName: string, command: string): Promise<void> {
  if (command === 'help') {
    const sid = playerSocketIds.get(senderId);
    if (sid) io.to(sid).emit('chat:message', { text: ADMIN_HELP, senderName: 'System', timestamp: Date.now() });
    return;
  }

  const sayMatch = command.match(/^say\s+"([^"]+)"/);
  if (sayMatch) {
    const payload = { text: sayMatch[1]!, senderName: 'Virtual DM', timestamp: Date.now() };
    await appendChatLog(cid, payload);
    io.to(ROOM).emit('chat:message', payload);
    console.log(`[admin] say: "${sayMatch[1]}"`);
    return;
  }

  const ADMIN_TAG_RE = /\[\[([A-Z_]+):([^|[\]]+)\|([^\]]*)\]\]/g;
  const matches = [...command.matchAll(ADMIN_TAG_RE)];
  if (!matches.length) {
    console.log(`[admin] unrecognised command from ${senderName}: ${command}`);
    return;
  }

  const effects: TagEffect[] = [];
  for (const match of matches) {
    const tagType = match[1]!;
    const name = match[2]!.trim();
    const detail = match[3]!.trim();
    const effect = buildAdminEffect(tagType, name, detail, senderName);
    if (effect) effects.push(effect);
    else console.log(`[admin] unknown tag type: ${tagType}`);
  }

  if (effects.length) {
    await applyEffects(cid, effects);
    console.log(`[admin] applied ${effects.length} effect(s) for ${senderName}`);
  }
}

function consolidateEffects(effects: TagEffect[]): TagEffect[] {
  const result: TagEffect[] = [];
  const inventoryByPlayer = new Map<string, AcquiredItem[]>();
  const sceneByLocation = new Map<string, string[]>();
  const npcByName = new Map<string, string[]>();
  let hasCombatInit = false;

  for (const effect of effects) {
    if (effect.type === 'combat_init') {
      hasCombatInit = true;
    } else if (effect.type === 'inventory_add') {
      const existing = inventoryByPlayer.get(effect.player) ?? [];
      inventoryByPlayer.set(effect.player, [...existing, ...effect.items]);
    } else if (effect.type === 'scene_build') {
      const existing = sceneByLocation.get(effect.locationName) ?? [];
      sceneByLocation.set(effect.locationName, [...existing, effect.detail]);
    } else if (effect.type === 'npc_build') {
      const existing = npcByName.get(effect.npcName) ?? [];
      npcByName.set(effect.npcName, [...existing, effect.detail]);
    } else {
      result.push(effect);
    }
  }

  if (hasCombatInit) result.unshift({ type: 'combat_init' });
  for (const [player, items] of inventoryByPlayer) result.push({ type: 'inventory_add', player, items });
  for (const [locationName, details] of sceneByLocation) result.push({ type: 'scene_build', locationName, detail: details.join('\n- ') });
  for (const [npcName, details] of npcByName) result.push({ type: 'npc_build', npcName, detail: details.join('\n- ') });

  return result;
}

function dispatchDMResponse(cid: string): void {
  if (!sessionState.get(cid)) return;
  io.to(ROOM).emit('dm:thinking', true);
  queueDMResponse(cid, async () => {
    try {
      const dungeon = dungeons.get(cid);
      const playerPositions = Object.fromEntries(
        Object.entries(tokenPositions.get(cid) ?? {}).filter(([name]) => connected.has(name))
      );
      const dungeonState = dungeon ? describeDungeonState(dungeon, playerPositions) : '';
      const response = await getDMResponse(cid, dungeonState);
      if (!response) return;

      if (response.includes('[COMBAT END]') && combatState.get(cid)) {
        combatState.set(cid, false);
        endCombat(cid);
        io.to(ROOM).emit('combat:state', false);
      }

      const rawResponse = response.replace(/\[COMBAT END\]/g, '').trim();
      const config = await getConfig();
      const { text: cleanResponse, effects, speakingAs, checkRequests } = config.tiers[config.tasks.combat].length
        ? await processVdmResponse(rawResponse, getCombatProvider(config))
        : { text: rawResponse, effects: [], speakingAs: undefined, checkRequests: [] };

      await applyEffects(cid, effects);

      const senderName = speakingAs ? `${speakingAs} (Virtual DM)` : 'Virtual DM';
      await appendChatLog(cid, { text: cleanResponse, senderName, timestamp: Date.now() });
      io.to(ROOM).emit('session:recap', { text: cleanResponse, senderName, checkRequests });
    } catch (err) {
      logError('index:dmResponse', err);
      io.to(ROOM).emit('chat:message', { text: `[DM error: ${(err as Error).message}]`, senderName: 'System', timestamp: Date.now() });
    } finally {
      io.to(ROOM).emit('dm:thinking', false);
    }
  });
}

io.on('connection', (socket) => {
  socket.on('player:join', ({ name: player, id: charId, campaignId }) => {
    connected.add(player);
    playerSocketIds.set(charId, socket.id);
    void socket.join(ROOM);
    io.to(ROOM).emit('players:update', [...connected]);
    const cpl = campaignPlayers.get(campaignId) ?? [];
    if (!cpl.includes(player)) { cpl.push(player); campaignPlayers.set(campaignId, cpl); }

    void readChatLog(campaignId).then(history => socket.emit('chat:history', history));
    socket.emit('session:state', sessionState.get(campaignId) ?? false);
    socket.emit('combat:state', combatState.get(campaignId) ?? false);
    void Promise.all([readQuests(campaignId), readManifest(campaignId)]).then(([quests, manifest]) => {
      socket.emit('quest:update', { quests, act: manifest?.act ?? 1 });
      socket.emit('clock:update', { worldTimeSecs: manifest?.worldTimeSecs ?? 43200 });
    });

    void listCharacters(campaignId).then(chars => {
      const map: Record<string, string> = {};
      for (const c of chars) map[c.name] = c.id;
      io.to(ROOM).emit('players:characters', map);
    });

    // Restores dungeon + combat state for a reconnecting player. Prefers in-memory state (may
    // have reveals/moves not yet flushed to disk) but falls back to disk — needed because a
    // server restart (e.g. resuming a session a week later) wipes combatState/encounters/dungeons,
    // even though everything relevant was persisted via saveEncounter/saveDungeon as it happened.
    void (async () => {
      let dungeon = dungeons.get(campaignId);
      if (!dungeon) {
        const loaded = await loadDungeon(campaignId);
        if (loaded) { dungeons.set(campaignId, loaded); dungeon = loaded; }
      }
      if (dungeon) {
        if (dungeon.arena) microDungeons.add(campaignId);
        socket.emit('dungeon:loaded', toClientDungeon(dungeon));
        if (!tokenPositions.has(campaignId) && dungeon.positions) tokenPositions.set(campaignId, dungeon.positions);
        Object.entries(tokenPositions.get(campaignId) ?? {}).forEach(([tokenId, pos]) => socket.emit('token:moved', { tokenId, ...pos }));
      }

      let encounter = encounters.get(campaignId);
      let active = combatState.get(campaignId) ?? false;
      if (!active) {
        const saved = encounter ?? await loadEncounter(campaignId);
        if (saved && saved.enemies.length > 0 && !saved.allEnemiesDead()) {
          encounters.set(campaignId, saved);
          encounter = saved;
          combatState.set(campaignId, true);
          enemiesReady.set(campaignId, true);
          active = true;
          socket.emit('combat:state', true); // corrects the optimistic `false` sent above
        }
      }

      if (active && encounter) {
        socket.emit('encounter:ready', encounter.enemies
          .filter(p => p.creature)
          .map(p => p.creature!.toStatBlock()));

        const positions = tokenPositions.get(campaignId) ?? {};
        Object.entries(positions).forEach(([tokenId, pos]) => socket.emit('token:moved', { tokenId, ...pos }));

        if (encounter.turnOrder.length) {
          socket.emit('combat:turn:order', encounter.turnOrder.map(p => p.toTurnOrderEntry()));
          const actor = encounter.currentActor;
          if (actor) socket.emit('combat:turn', { actorName: actor.name });
        }
      }
    })();

    socket.on('session:start', ({ campaignId: cid }) => {
      sessionState.set(cid, true);
      io.to(ROOM).emit('session:state', true);
      io.to(ROOM).emit('dm:thinking', true);
      void (async () => {
        try {
          await ensureSessionQuests(cid);
          const [quests, manifest] = await Promise.all([readQuests(cid), readManifest(cid)]);
          io.to(ROOM).emit('quest:update', { quests, act: manifest?.act ?? 1 });

          const { text } = await runRecap(cid);
          await appendChatLog(cid, { text, senderName: 'Virtual DM', timestamp: Date.now() });
          io.to(ROOM).emit('session:recap', { text, senderName: 'Virtual DM' });
        } catch (err) {
          logError('index:sessionStartRecap', err);
          io.to(ROOM).emit('session:recap', { text: 'The story begins...', senderName: 'Virtual DM' });
        } finally {
          io.to(ROOM).emit('dm:thinking', false);
        }
      })();
    });

    socket.on('session:end', ({ campaignId: cid }) => { endSession(cid); });

    socket.on('roll:check', ({ campaignId, characterId, stat, skill }) => {
      void (async () => {
        const char = await getCharacter(campaignId, characterId);
        if (!char) return;
        const statKey = stat as keyof CharacterStats;
        const base = statMod(char.stats[statKey]);
        const proficient = skill ? (
          (char.skillProficiencies ?? []).includes(skill) ||
          (BG_SKILLS[char.background] ?? []).includes(skill)
        ) : false;
        const modifier = base + (proficient ? 2 : 0);
        const roll = new D20Roll().roll();
        const total = roll + modifier;
        const label = skill ?? (STAT_FULL[stat.toUpperCase()] ?? stat.toUpperCase());
        console.log(`[roll] ${char.name} rolls ${label}: ${total} | proficient=${proficient}`);
        const checkResult = { characterName: char.name, rollType: 'check' as const, stat: stat.toUpperCase(), d20: roll, modifier, total, description: `${char.name} rolls ${label}: ${total}` };
        await appendChatLog(campaignId, { text: checkResult.description, senderName: 'System', timestamp: Date.now() });
        io.to(ROOM).emit('roll:result', checkResult);
        if (skill && /^(perception|investigation)$/i.test(skill)) {
          const note = await checkDungeonHiddenReveal(campaignId, char.name, total);
          if (note) await appendChatLog(campaignId, { text: note, senderName: 'System', timestamp: Date.now() });
        }
        dispatchDMResponse(campaignId);
      })();
    });

    socket.on('roll:save', ({ campaignId, characterId, stat }) => {
      void (async () => {
        const char = await getCharacter(campaignId, characterId);
        if (!char) return;
        const statKey = stat as keyof CharacterStats;
        const statUpper = stat.toUpperCase();
        const base = statMod(char.stats[statKey]);
        const proficient = (SAVE_PROFS[char.class] ?? []).includes(statUpper);
        const modifier = base + (proficient ? 2 : 0);
        const roll = new D20Roll().roll();
        const total = roll + modifier;
        const statLabel = STAT_FULL[statUpper] ?? statUpper;
        console.log(`[roll] ${char.name} rolls ${statLabel} Save: ${total}`);
        const saveResult = { characterName: char.name, rollType: 'save' as const, stat: statUpper, d20: roll, modifier, total, description: `${char.name} rolls ${statLabel} Save: ${total}` };
        await appendChatLog(campaignId, { text: saveResult.description, senderName: 'System', timestamp: Date.now() });
        io.to(ROOM).emit('roll:result', saveResult);
        dispatchDMResponse(campaignId);
      })();
    });

    socket.on('chat:message', ({ text, senderName }) => {
      if (text.startsWith('/admin ')) {
        void handleAdminCommand(campaignId, charId, senderName, text.slice(7).trim());
        return;
      }

      void (async () => {
        const payload = { text, senderName, timestamp: Date.now() };
        await appendChatLog(campaignId, payload);
        io.to(ROOM).emit('chat:message', payload);

        if (combatState.get(campaignId)) {
          const encounter = encounters.get(campaignId);
          const currentActor = encounter?.currentActor;
          if (currentActor?.name === senderName && currentActor.isPlayer) {
            void (async () => {
              try {
                const config = await getConfig();
                if (!config.tiers[config.tasks.combat].length) return;
                const adapter = getCombatProvider(config);
                const recent = (await readChatLog(campaignId)).slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');
                const char = await listCharacters(campaignId).then(cs => cs.find(c => c.name === senderName));
                const enemies = encounter!.enemies
                  .filter(p => p.creature && !p.creature.isDead())
                  .map(p => p.creature!.toStatBlock());

                const result = await resolveImprovisedAction({
                  playerName: senderName,
                  playerClass: char?.class ?? 'Adventurer',
                  message: text,
                  enemies,
                  recentChat: recent,
                }, adapter);
                if (!result) return;

                const dmMsg = { text: result.answer, senderName: 'Virtual DM', timestamp: Date.now() };
                await appendChatLog(campaignId, dmMsg);
                io.to(ROOM).emit('chat:message', dmMsg);

                if (result.type === 'attack' && result.dc && result.damageFormula && result.targetId && char) {
                  const statKey = (result.stat ?? 'str') as keyof CharacterStats;
                  const roll = new D20Roll().roll();
                  const mod = statMod(char.stats[statKey]);
                  const total = roll + mod;
                  const hit = total >= result.dc;
                  const dmgRoll = hit ? rollDice(result.damageFormula) : undefined;

                  const rollMsg = { text: `${senderName} rolls ${result.stat?.toUpperCase() ?? 'STR'}: ${roll}${fmtMod(mod)} = ${total} vs DC ${result.dc} — ${hit ? `HIT! ${dmgRoll} ${result.damageType ?? ''} damage` : 'MISS'}.`, senderName: 'System', timestamp: Date.now() };
                  await appendChatLog(campaignId, rollMsg);
                  io.to(ROOM).emit('chat:message', rollMsg);

                  if (hit && dmgRoll) {
                    void applyDamageToCreature(campaignId, result.targetId, dmgRoll);
                  }

                  const weapon = new WeaponClass({
                    id: 'improvised',
                    name: 'improvised action',
                    description: '',
                    quantity: 1,
                    damage: result.damageFormula ?? '',
                    damageType: result.damageType ?? '',
                    attackBonus: 0,
                    range: 5,
                    properties: [],
                  });
                  const atkResult = {
                    attackerName: senderName,
                    targetName: enemies.find(e => e.id === result.targetId)?.name ?? 'target',
                    targetId: result.targetId,
                    weaponName: weapon.name,
                    d20: roll,
                    attackBonus: mod,
                    statBonus: mod,
                    statName: 'Attack',
                    weaponBonus: 0,
                    total,
                    ac: result.dc,
                    hit,
                    damage: dmgRoll,
                    damageFormula: result.damageFormula,
                    remainingHp: encounter!.findCreature(result.targetId)?.currentHp,
                    targetDead: encounter!.findCreature(result.targetId)?.isDead() ?? false,
                  };
                  const flavour = await generateCombatFlavour(atkResult, adapter);
                  if (flavour) {
                    const flavourMsg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
                    await appendChatLog(campaignId, flavourMsg);
                    io.to(ROOM).emit('chat:message', flavourMsg);
                  }
                }
              } catch (err) { logError('index:improvisedAction', err); }
            })();
            return;
          }
        }

        dispatchDMResponse(campaignId);
      })();
    });

    socket.on('token:move', ({ tokenId, gx, gy }) => {
      const positions = tokenPositions.get(campaignId) ?? {};
      positions[tokenId] = { gx, gy };
      tokenPositions.set(campaignId, positions);
      socket.to(ROOM).emit('token:moved', { tokenId, gx, gy });

      if (connected.has(tokenId)) void checkDungeonProximity(campaignId, gx, gy);
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

      const expected = encounter.expectedParticipantCount;
      if (encounter.turnOrder.length >= expected && expected > 0 && !encounter.currentRound && enemiesReady.get(cid)) {
        encounter.beginCombat();
        emitTurn(cid);
      }
      void saveEncounter(cid, encounter);
    });

    socket.on('combat:attack', ({ attackerId, attackerName, targetId, weapon }: { attackerId: string; attackerName: string; targetId: string; weapon: Weapon }) => {
      void (async () => {
        const cid = campaignId;
        if (!combatState.get(cid)) return;
        const encounter = encounters.get(cid);
        if (!encounter) return;

        const char = await getCharacter(cid, attackerId);
        const creature = encounter.findCreature(targetId);
        if (!char || !creature || creature.isDead()) return;

        const strMod = statMod(char.stats.str);
        const dexMod = statMod(char.stats.dex);
        const isMelee = weapon.range <= 5;
        const useDex = !isMelee || (weapon.isFinesse && dexMod > strMod);
        const statBonus = useDex ? dexMod : strMod;
        const statName = useDex ? 'Dexterity' : 'Strength';
        const charProf = char.proficiencyBonus ?? 2;
        const classWeaponProfs = CLASS_WEAPON_PROFS[char.class] ?? [];
        const isProficient = weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
        const weaponBonus = (weapon.attackBonus ?? 0) + (isProficient ? charProf : 0);
        const attackBonus = statBonus + weaponBonus;

        const positions = tokenPositions.get(cid) ?? {};
        const attackerPos = positions[attackerName];
        const targetPos = positions[targetId];
        const inExtendedRange = !!(weapon.extendedRange && attackerPos && targetPos &&
          Math.max(Math.abs(targetPos.gx - attackerPos.gx), Math.abs(targetPos.gy - attackerPos.gy)) > Math.floor(weapon.range / 5));

        const roll = new D20Roll({ withDisadvantage: inExtendedRange }).roll();
        const total = roll + attackBonus;
        const hit = total >= creature.ac;

        let damage: number | undefined;
        let damageRoll: number | undefined;
        if (hit) {
          damageRoll = rollDice(weapon.damage);
          damage = damageRoll + statBonus;
          await applyDamageToCreature(cid, targetId, damage);
        }

        const atkResult = {
          attackerName,
          targetName: creature.name,
          targetId,
          weaponName: weapon.name,
          d20: roll,
          attackBonus,
          statBonus,
          statName,
          weaponBonus,
          total,
          ac: creature.ac,
          hit,
          damage,
          damageRoll,
          damageType: weapon.damageType,
          damageFormula: weapon.damage,
          remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
          targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
        };
        io.to(ROOM).emit('combat:attack:result', atkResult);

        void (async () => {
          try {
            const config = await getConfig();
            if (!config.tiers[config.tasks.combat].length) return;
            const flavour = await generateCombatFlavour(atkResult, getCombatProvider(config));
            if (!flavour) return;
            const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
            await appendChatLog(cid, msg);
            io.to(ROOM).emit('chat:message', msg);
          } catch (err) { logError('index:combatFlavour', err); }
        })();
      })();
    });

    // Single-target spell attack (e.g. Fire Bolt) — mirrors combat:attack but uses the
    // caster's spellcasting modifier for the attack roll and adds no stat mod to damage.
    socket.on('combat:spell:attack', ({ casterId, casterName, targetId, spell }) => {
      void (async () => {
        const cid = campaignId;
        if (!combatState.get(cid)) return;
        const encounter = encounters.get(cid);
        if (!encounter) return;

        const char = await getCharacter(cid, casterId);
        const creature = encounter.findCreature(targetId);
        if (!char || !creature || creature.isDead()) return;

        const spellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
        const abilityMod = statMod(char.stats[spellAbility]);
        const charProf = char.proficiencyBonus ?? 2;
        const attackBonus = abilityMod + charProf;

        const roll = new D20Roll().roll();
        const total = roll + attackBonus;
        const hit = total >= creature.ac;

        const damageEffect = spell.combat?.onHit?.find(e => e.type === 'damage');
        const dice = resolveSpellDamageDice(damageEffect?.scaling, char.level ?? 1) ?? damageEffect?.scaling?.base;

        let damage: number | undefined;
        let damageRoll: number | undefined;
        if (hit && dice) {
          damageRoll = rollDice(dice);
          damage = damageRoll; // no spellcasting-mod bonus on spell damage, per 5e rules
          await applyDamageToCreature(cid, targetId, damage);
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
          ac: creature.ac,
          hit,
          damage,
          damageRoll,
          damageType: damageEffect?.damageType,
          damageFormula: dice,
          remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
          targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
        };
        io.to(ROOM).emit('combat:spell:attack:result', atkResult);
      })();
    });

    // Save-based spell (single-target or AoE) — computes the DC once, then rolls each
    // affected target's save mechanically and applies damage/conditions behind the curtain.
    // Full per-target rolls are server-logged only; clients only ever see pass/fail + outcome.
    socket.on('combat:spell:cast', ({ casterId, casterName, spell, targetIds }) => {
      void (async () => {
        const cid = campaignId;
        if (!combatState.get(cid)) return;
        const encounter = encounters.get(cid);
        if (!encounter) return;

        const char = await getCharacter(cid, casterId);
        if (!char) return;

        const combat = spell.combat;
        const casterSpellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
        const casterAbilityMod = statMod(char.stats[casterSpellAbility]);
        const charProf = char.proficiencyBonus ?? 2;
        const dc = 8 + charProf + casterAbilityMod;

        const saveAbility = combat?.save?.ability ?? casterSpellAbility;
        const halfOnSave = combat?.save?.halfOnSave ?? false;
        const damageEffect = combat?.onHit?.find(e => e.type === 'damage');
        const conditionEffects = combat?.onHit?.filter(e => e.type === 'condition') ?? [];
        const dice = resolveSpellDamageDice(damageEffect?.scaling, char.level ?? 1) ?? damageEffect?.scaling?.base;

        const chars = await listCharacters(cid);
        const outcomes: SpellSaveOutcome[] = [];

        for (const targetId of targetIds) {
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

          const roll = new D20Roll().roll();
          const total = roll + saveBonus;
          const saved = total >= dc;
          console.log(`[spell-save] ${participant.name} vs ${spell.name} DC${dc}: d20=${roll}${fmtMod(saveBonus)}=${total} — ${saved ? 'SAVE' : 'FAIL'}`);

          let damage: number | undefined;
          if (dice && (!saved || halfOnSave)) {
            const rolled = rollDice(dice);
            damage = saved ? Math.floor(rolled / 2) : rolled;
            participant.takeDamage(damage);
            if (participant.isPlayer && targetChar) {
              io.to(ROOM).emit('combat:player:damage', {
                characterId: targetChar.id, characterName: participant.name,
                damage, currentHp: participant.currentHp, maxHp: participant.maxHp,
              });
            } else if (participant.creature) {
              io.to(ROOM).emit('creature:update', {
                id: targetId, currentHp: participant.creature.currentHp, maxHp: participant.creature.hp, effects: participant.creature.effects,
              });
            }
          }

          const conditionsApplied = !saved
            ? conditionEffects.map(e => e.condition).filter((c): c is NonNullable<typeof c> => !!c)
            : undefined;

          outcomes.push({
            targetId,
            targetName: participant.name,
            isPC: participant.isPlayer,
            saveBonus,
            dc,
            saved,
            damage,
            conditionsApplied,
            remainingHp: participant.isPlayer ? participant.currentHp : participant.creature?.currentHp,
            targetDead: participant.isDead(),
          });
        }

        const result: SpellSaveResult = { casterName, spellName: spell.name, dc, saveAbility, slotLevel: spell.level, outcomes };
        io.to(ROOM).emit('combat:spell:save:result', result);
      })();
    });

    socket.on('combat:turn:end', () => {
      const encounter = encounters.get(campaignId);
      const actor = encounter?.currentActor;
      console.log(`[turn] combat:turn:end received — currentActor=${actor?.name ?? 'none'} isPlayer=${actor?.isPlayer}`);
      if (actor?.isPlayer) advanceTurn(campaignId);
    });

    socket.on('disconnect', () => {
      connected.delete(player);
      playerSocketIds.delete(charId);
      io.to(ROOM).emit('players:update', [...connected]);
    });
  });
});

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`api listening on :${PORT}`);
});
