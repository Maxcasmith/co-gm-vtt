import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, Player, CharacterStats, TurnOrderEntry, Character, Weapon } from 'shared';
import { Weapon as WeaponClass } from 'shared';
import { configRouter } from './routes/config.ts';
import { campaignsRouter } from './routes/campaigns.ts';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getCharacter, writeCharacter, readChatLog, appendChatLog, listEntitySlugs, readEntity, getWorldMeta, getConfig, CAMPAIGNS_DIR, saveMap, appendMapIndex, listMaps, saveEncounter, loadEncounter, clearEncounter, readWorldState, writeWorldState, readCampaignFile, listCharacters } from './storage.ts';
import { getStoryProvider } from './providers/index.ts';
import { buildRecapPrompt } from './session-processor/prompts.ts';
import { processSession, getDMResponse } from './session-processor/index.ts';
import { parseLocationContext, buildBattleMapPrompt, generateEncounterEnemies, generateCombatFlavour, resolveImprovisedAction, generateWorldState, tickWorldNarrative } from './session-processor/imagePrompts.ts';
import { generateBattleMap } from './providers/openai.ts';
import { mapsRouter } from './routes/maps.ts';
import { adminRouter } from './routes/admin.ts';
import { randomUUID } from 'crypto';
import { Encounter, Team, Participant } from './domain/encounter.ts';
import { Creature } from './domain/creature.ts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use('/api/config', configRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/campaigns', mapsRouter);
app.use('/api/admin', adminRouter);

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

const ROOM = 'sandbox';
const connected = new Set<Player>();
const sessionState = new Map<string, boolean>();
const combatState = new Map<string, boolean>();
const encounters = new Map<string, Encounter>();
const tokenPositions = new Map<string, Record<string, { gx: number; gy: number }>>();
const dmQueue = new Map<string, Promise<void>>();
const campaignPlayers = new Map<string, string[]>();
const playerSocketIds = new Map<string, string>(); // playerName → socketId (for private events)

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

  if (encounter.allPlayersDead()) {
    endCombatDefeated(cid);
    return;
  }

  const actor = encounter.currentActor;
  if (!actor) return;
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

  const roll = d20();
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
  const socketId = playerSocketIds.get(actor.name);
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

  // Find nearest player by Chebyshev distance
  const players = campaignPlayers.get(cid) ?? [];
  let target: { name: string; gx: number; gy: number } | null = null;
  let minDist = Infinity;
  for (const pname of players) {
    const p = positions[pname];
    if (!p) continue;
    const d = Math.max(Math.abs(p.gx - epos.gx), Math.abs(p.gy - epos.gy));
    if (d < minDist) { minDist = d; target = { name: pname, ...p }; }
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
    if (finalDist <= 1) {
      const chars = await listCharacters(cid);
      const targetChar = chars.find(c => c.name === target!.name);
      const targetAc = targetChar ? (10 + statMod(targetChar.stats.dex)) : 10;
      const roll = d20();
      const total = roll + atk.bonus;
      const hit = total >= targetAc;
      let damage: number | undefined;
      let remainingHp: number | undefined;
      let targetDead = false;

      if (hit && targetChar) {
        damage = rollDice(atk.damage);
        const playerParticipant = encounter.players.find(p => p.id === targetChar.id);
        if (playerParticipant) {
          const wasDown = playerParticipant.isDown();
          playerParticipant.takeDamage(damage);
          remainingHp = playerParticipant.currentHp;
          targetDead = playerParticipant.currentHp <= 0;
          io.to(ROOM).emit('combat:player:damage', {
            characterId: targetChar.id,
            characterName: target!.name,
            damage,
            currentHp: playerParticipant.currentHp,
            maxHp: playerParticipant.maxHp,
          });
          console.log(`[ai] ${actor.name} attacks ${target!.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — HIT ${damage} (${playerParticipant.currentHp}/${playerParticipant.maxHp} HP)`);

          if (wasDown) {
            playerParticipant.deathSaves.failures = Math.min(3, playerParticipant.deathSaves.failures + 2);
            playerParticipant.deathSaves.stable = false;
            const nowDead = playerParticipant.deathSaves.failures >= 3;
            const socketId = playerSocketIds.get(target!.name);
            if (socketId) {
              io.to(socketId).emit('combat:death:save', {
                characterName: target!.name, roll: 0, isNatural20: false, isNatural1: false,
                success: false, successes: playerParticipant.deathSaves.successes,
                failures: playerParticipant.deathSaves.failures, stable: false, dead: nowDead,
              });
            }
            if (nowDead) {
              io.to(ROOM).emit('combat:player:dead', { characterId: targetChar.id, characterName: target!.name });
              const deadMsg = { text: `${target!.name} has perished.`, senderName: 'Combat', timestamp: Date.now() };
              io.to(ROOM).emit('chat:message', deadMsg);
              void appendChatLog(cid, deadMsg);
            }
          }
        }
      } else {
        console.log(`[ai] ${actor.name} attacks ${target!.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — MISS`);
      }

      io.to(ROOM).emit('combat:attack:result', {
        attackerName: actor.name, targetName: target!.name, targetId: targetChar?.id ?? target!.name,
        weaponName: atk.name, d20: roll, attackBonus: atk.bonus, total, ac: targetAc,
        hit, damage, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead,
      });

      const cfg = await getConfig();
      if (cfg.combat.apiKey) {
        const atkResult = {
          attackerName: actor.name, targetName: target!.name, targetId: target!.name,
          weaponName: atk.name, d20: roll, attackBonus: atk.bonus, total, ac: targetAc,
          hit, damage, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead,
        };
        const flavour = await generateCombatFlavour(atkResult, cfg.combat.apiKey, cfg.combat.model);
        if (flavour) {
          const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
          io.to(ROOM).emit('chat:message', msg);
          void appendChatLog(cid, msg);
        }
      }
    } else {
      console.log(`[ai] ${actor.name} cannot reach ${target!.name} (${finalDist} cells away)`);
    }
  }

  await delay(600);
  advanceTurn(cid);
}

function endSession(cid: string): void {
  if (!sessionState.get(cid)) return;
  sessionState.set(cid, false);
  io.to(ROOM).emit('session:state', false);
  void processSession(cid).then(result => {
    const names = [...(result.updated ?? []), ...(result.created ?? []), ...(result.cascaded ?? [])];
    const text = result.skipped
      ? 'Session ended — no chat to process.'
      : `Session ended — notes updated: ${names.join(', ') || 'nothing new'}`;
    io.to(ROOM).emit('chat:message', { text, senderName: 'System', timestamp: Date.now() });
  });
}

function endCombatDefeated(cid: string): void {
  if (!combatState.get(cid)) return;
  combatState.set(cid, false);
  io.to(ROOM).emit('combat:defeat');
  setTimeout(() => {
    const encounter = encounters.get(cid);
    encounter?.teardown();
    encounters.delete(cid);
    void clearEncounter(cid);
    io.to(ROOM).emit('combat:state', false);
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

  if (creature.isDead()) {
    console.log(`[combat] ${creature.name} is dead`);
    encounter.removeFromTurnOrder(targetId);

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
        chars.map(char => writeCharacter(cid, char.id, { ...char, xp: (char.xp ?? 0) + xpPerPlayer }))
      ));

      setTimeout(() => {
        combatState.set(cid, false);
        void listCharacters(cid).then(chars => Promise.all(
          chars.map(c => {
            const p = encounter.players.find(pp => pp.id === c.id);
            return p ? writeCharacter(cid, c.id, { ...c, currentHp: p.currentHp, maxHp: p.maxHp }) : Promise.resolve();
          })
        ));
        encounter.teardown();
        encounters.delete(cid);
        void clearEncounter(cid);
        io.to(ROOM).emit('combat:state', false);
      }, 7000);
    }
  }
}

function advanceTurn(cid: string) {
  if (!combatState.get(cid)) return;
  const encounter = encounters.get(cid);
  if (!encounter?.turnOrder.length) return;
  encounter.advanceTurn();
  emitTurn(cid);
}

function rollPlayerInitiatives(cid: string, chars: Character[]): void {
  const encounter = encounters.get(cid);
  if (!encounter) return;

  let playerTeam = encounter.teams.find(t => t.name === 'Players');
  if (!playerTeam) {
    playerTeam = new Team('players', 'Players');
    encounter.addTeam(playerTeam);
  }

  const players = campaignPlayers.get(cid) ?? [];
  encounter.expectedParticipantCount += players.length;

  const entries: Participant[] = players.map(name => {
    const char = chars.find(c => c.name === name);
    const mod = (char ? statMod(char.stats.dex) : 0) + (char?.initiativeBonus ?? 0);
    const maxHp = char ? calcMaxHp(char) : 0;
    const participant = new Participant({
      id: char?.id ?? name,
      name,
      initiative: d20() + mod,
      isPlayer: true,
      currentHp: char?.currentHp ?? maxHp,
      maxHp,
    });
    playerTeam!.addParticipant(participant);
    return participant;
  });

  addToTurnOrder(cid, entries);
}

function rollEnemyInitiatives(cid: string): void {
  const encounter = encounters.get(cid);
  if (!encounter) return;
  const existing = encounter.turnOrder.length;
  const entries = encounter.enemies.map(p => {
    p.initiative = d20() + statMod(p.creature?.stats.dex ?? 10);
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
      if (encounter.turnOrder.length >= expected && expected > 0 && !encounter.currentRound) {
        encounter.beginCombat();
        emitTurn(cid);
      }
    }, baseDelay + i * 500);
  });
}

function queueDMResponse(campaignId: string, fn: () => Promise<void>): void {
  const prev = dmQueue.get(campaignId) ?? Promise.resolve();
  dmQueue.set(campaignId, prev.then(fn).catch(err => console.error('[dm] queue error:', err)));
}

async function generateAndBroadcastMap(campaignId: string): Promise<void> {
  try {
    const stubMapId = process.env.STUB_MAP_ID;
    if (stubMapId) {
      console.log('[map] STUB_MAP_ID set, skipping generation — loading:', stubMapId);
      io.to(ROOM).emit('map:generated', stubMapId);
      return;
    }

    const config = await getConfig();
    const { apiKey, model } = config.image;
    if (!apiKey) { console.warn('[map] no image API key configured, skipping map generation'); return; }

    io.to(ROOM).emit('map:generating');
    const messages = await readChatLog(campaignId);
    const ctx = await parseLocationContext(messages, apiKey);
    const prompt = buildBattleMapPrompt(ctx);

    console.log('[map] generating battle map for:', ctx.location);
    const buffer = await generateBattleMap(prompt, apiKey, model);

    const mapId = randomUUID();
    await saveMap(campaignId, mapId, buffer);
    await appendMapIndex(campaignId, { id: mapId, createdAt: new Date().toISOString(), locationName: ctx.location });

    io.to(ROOM).emit('map:generated', mapId);
    console.log('[map] battle map ready:', mapId);
  } catch (err) {
    console.error('[map] generation failed:', err);
  }
}

async function generateAndBroadcastEnemies(campaignId: string): Promise<void> {
  try {
    io.to(ROOM).emit('encounter:generating');
    const config = await getConfig();
    const { model, apiKey } = config.combat;
    if (!apiKey) console.warn('[encounter] no combat API key, using fallback');

    const [messages, characters] = await Promise.all([
      readChatLog(campaignId),
      listCharacters(campaignId),
    ]);

    const statBlocks = await generateEncounterEnemies(messages, characters, apiKey, model);

    const encounter = encounters.get(campaignId);
    if (!encounter) return;

    let enemyTeam = encounter.teams.find(t => t.name === 'Enemies');
    if (!enemyTeam) {
      enemyTeam = new Team('enemies', 'Enemies');
      encounter.addTeam(enemyTeam);
    }

    for (const sb of statBlocks) {
      const creature = Creature.from(sb);
      enemyTeam.addParticipant(new Participant({
        id: creature.id,
        name: creature.name,
        initiative: 0,
        isPlayer: false,
        creature,
      }));
    }

    encounter.expectedParticipantCount += statBlocks.length;
    await saveEncounter(campaignId, encounter);
    io.to(ROOM).emit('encounter:ready', statBlocks);
    console.log('[encounter] ready:', statBlocks.map(e => `${e.name} (CR ${e.cr})`).join(', '));

    if (combatState.get(campaignId)) rollEnemyInitiatives(campaignId);
  } catch (err) {
    console.error('[encounter] generation failed:', err);
  }
}

async function buildEntitySummaries(campaignId: string): Promise<string> {
  const types = ['npc', 'faction', 'location', 'character'] as const;
  const lines: string[] = [];
  for (const filename of ['world.md', 'locations.md', 'npcs.md', 'factions.md']) {
    try {
      const content = await readFile(path.join(CAMPAIGNS_DIR, campaignId, filename), 'utf-8');
      lines.push(`### ${filename}\n${content}`);
    } catch { /* missing world file — skip */ }
  }
  for (const type of types) {
    const slugs = await listEntitySlugs(campaignId, type);
    for (const slug of slugs) {
      const content = await readEntity(campaignId, type, slug);
      if (content) lines.push(`### ${type}/${slug}\n${content.slice(0, 600)}`);
    }
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
      } catch { /* leave null */ }
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

function d20() { return Math.floor(Math.random() * 20) + 1; }
function statMod(score: number) { return Math.floor((score - 10) / 2); }
function fmtMod(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

io.on('connection', (socket) => {
  socket.on('player:join', ({ name: player, campaignId }) => {
    connected.add(player);
    playerSocketIds.set(player, socket.id);
    void socket.join(ROOM);
    io.to(ROOM).emit('players:update', [...connected]);
    const cpl = campaignPlayers.get(campaignId) ?? [];
    if (!cpl.includes(player)) { cpl.push(player); campaignPlayers.set(campaignId, cpl); }

    void readChatLog(campaignId).then(history => socket.emit('chat:history', history));
    socket.emit('session:state', sessionState.get(campaignId) ?? false);
    socket.emit('combat:state', combatState.get(campaignId) ?? false);

    if (combatState.get(campaignId)) {
      void listMaps(campaignId).then(maps => {
        const latest = maps[maps.length - 1];
        if (latest) socket.emit('map:generated', latest.id);
      });

      const encounter = encounters.get(campaignId);
      if (encounter && encounter.enemies.length > 0) {
        socket.emit('encounter:ready', encounter.enemies
          .filter(p => p.creature)
          .map(p => p.creature!.toStatBlock()));
      } else {
        void loadEncounter(campaignId).then(saved => {
          if (saved && saved.enemies.length > 0) {
            socket.emit('encounter:ready', saved.enemies
              .filter(p => p.creature)
              .map(p => p.creature!.toStatBlock()));
          }
        });
      }

      const positions = tokenPositions.get(campaignId) ?? {};
      Object.entries(positions).forEach(([tokenId, pos]) => socket.emit('token:moved', { tokenId, ...pos }));

      if (encounter?.turnOrder.length) {
        socket.emit('combat:turn:order', encounter.turnOrder.map(p => p.toTurnOrderEntry()));
        const actor = encounter.currentActor;
        if (actor) socket.emit('combat:turn', { actorName: actor.name });
      }
    }

    socket.on('session:start', ({ campaignId: cid }) => {
      sessionState.set(cid, true);
      io.to(ROOM).emit('session:state', true);
      io.to(ROOM).emit('dm:thinking', true);
      void (async () => {
        try {
          const { text, isFirstSession } = await runRecap(cid);
          await appendChatLog(cid, { text, senderName: 'Virtual DM', timestamp: Date.now() });
          io.to(ROOM).emit('session:recap', text);
        } catch (err) {
          console.error('[dm] recap error:', err);
          io.to(ROOM).emit('session:recap', 'The story begins...');
        } finally {
          io.to(ROOM).emit('dm:thinking', false);
        }
      })();
    });

    socket.on('session:end', ({ campaignId: cid }) => { endSession(cid); });

    function dispatchDMResponse(cid: string): void {
      if (!sessionState.get(cid)) return;
      io.to(ROOM).emit('dm:thinking', true);
      queueDMResponse(cid, async () => {
        try {
          const response = await getDMResponse(cid);
          if (!response) return;

          if ((response.includes('[BEGIN COMBAT]') || /roll\s+(?:for\s+)?initiative/i.test(response)) && !combatState.get(cid)) {
            combatState.set(cid, true);
            encounters.set(cid, Encounter.empty(cid));
            io.to(ROOM).emit('combat:state', true);
            void listCharacters(cid).then(chars => rollPlayerInitiatives(cid, chars));
            void generateAndBroadcastMap(cid);
            void generateAndBroadcastEnemies(cid);
          }

          if (response.includes('[COMBAT END]') && combatState.get(cid)) {
            combatState.set(cid, false);
            const enc = encounters.get(cid);
            if (enc) {
              void listCharacters(cid).then(chars => Promise.all(
                chars.map(c => {
                  const p = enc.players.find(pp => pp.id === c.id);
                  return p ? writeCharacter(cid, c.id, { ...c, currentHp: p.currentHp, maxHp: p.maxHp }) : Promise.resolve();
                })
              ));
              enc.teardown();
              encounters.delete(cid);
            }
            void clearEncounter(cid);
            io.to(ROOM).emit('combat:state', false);
          }

          const cleanResponse = response.replace(/\[BEGIN COMBAT\]/g, '').replace(/\[COMBAT END\]/g, '').trim();
          const dmPayload = { text: cleanResponse, senderName: 'Virtual DM', timestamp: Date.now() };
          await appendChatLog(cid, dmPayload);
          io.to(ROOM).emit('session:recap', cleanResponse);
        } catch (err) {
          console.error('[dm] response error:', err);
          io.to(ROOM).emit('chat:message', { text: `[DM error: ${(err as Error).message}]`, senderName: 'System', timestamp: Date.now() });
        } finally {
          io.to(ROOM).emit('dm:thinking', false);
        }
      });
    }

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
        const roll = d20();
        const total = roll + modifier;
        const label = skill ?? (STAT_FULL[stat.toUpperCase()] ?? stat.toUpperCase());
        console.log(`[roll] ${char.name} rolls ${label}: ${total} | proficient=${proficient}`);
        const checkResult = { characterName: char.name, rollType: 'check' as const, stat: stat.toUpperCase(), d20: roll, modifier, total, description: `${char.name} rolls ${label}: ${total}` };
        await appendChatLog(campaignId, { text: checkResult.description, senderName: 'System', timestamp: Date.now() });
        io.to(ROOM).emit('roll:result', checkResult);
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
        const roll = d20();
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
                const { model, apiKey } = config.combat;
                if (!apiKey) return;
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
                }, apiKey, model);
                if (!result) return;

                const dmMsg = { text: result.answer, senderName: 'Virtual DM', timestamp: Date.now() };
                await appendChatLog(campaignId, dmMsg);
                io.to(ROOM).emit('chat:message', dmMsg);

                if (result.type === 'attack' && result.dc && result.damageFormula && result.targetId && char) {
                  const statKey = (result.stat ?? 'str') as keyof CharacterStats;
                  const roll = d20();
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
                    total,
                    ac: result.dc,
                    hit,
                    damage: dmgRoll,
                    damageFormula: result.damageFormula,
                    remainingHp: encounter!.findCreature(result.targetId)?.currentHp,
                    targetDead: encounter!.findCreature(result.targetId)?.isDead() ?? false,
                  };
                  const flavour = await generateCombatFlavour(atkResult, apiKey, model);
                  if (flavour) {
                    const flavourMsg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
                    await appendChatLog(campaignId, flavourMsg);
                    io.to(ROOM).emit('chat:message', flavourMsg);
                  }
                }
              } catch (err) { console.error('[improvised]', err); }
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
      if (encounter.turnOrder.length >= expected && expected > 0 && !encounter.currentRound) {
        encounter.beginCombat();
        emitTurn(cid);
      }
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
        const attackBonus = strMod + (weapon.attackBonus ?? 0);
        const roll = d20();
        const total = roll + attackBonus;
        const hit = total >= creature.ac;

        let damage: number | undefined;
        if (hit) {
          damage = rollDice(weapon.damage);
          await applyDamageToCreature(cid, targetId, damage);
        }

        const atkResult = {
          attackerName,
          targetName: creature.name,
          targetId,
          weaponName: weapon.name,
          d20: roll,
          attackBonus,
          total,
          ac: creature.ac,
          hit,
          damage,
          damageFormula: weapon.damage,
          remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
          targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
        };
        io.to(ROOM).emit('combat:attack:result', atkResult);
        console.log(`[combat] ${attackerName} attacks ${creature.name}: ${roll}${fmtMod(attackBonus)} = ${total} vs AC ${creature.ac} — ${hit ? `HIT ${damage}` : 'MISS'}`);

        void (async () => {
          try {
            const config = await getConfig();
            const { model, apiKey } = config.combat;
            if (!apiKey) return;
            const flavour = await generateCombatFlavour(atkResult, apiKey, model);
            if (!flavour) return;
            const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
            await appendChatLog(cid, msg);
            io.to(ROOM).emit('chat:message', msg);
          } catch (err) { console.error('[flavour]', err); }
        })();
      })();
    });

    socket.on('combat:turn:end', () => {
      const encounter = encounters.get(campaignId);
      if (encounter?.currentActor?.isPlayer) advanceTurn(campaignId);
    });

    socket.on('disconnect', () => {
      connected.delete(player);
      playerSocketIds.delete(player);
      io.to(ROOM).emit('players:update', [...connected]);
    });
  });
});

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`api listening on :${PORT}`);
});
