import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, Player, CharacterStats, EnemyStatBlock, TurnOrderEntry, Character, Weapon } from 'shared';
import { configRouter } from './routes/config.ts';
import { campaignsRouter } from './routes/campaigns.ts';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getCharacter, writeCharacter, readChatLog, appendChatLog, listEntitySlugs, readEntity, getWorldMeta, getConfig, CAMPAIGNS_DIR, saveMap, appendMapIndex, listMaps, listCharacters, saveEncounter, loadEncounter, clearEncounter, readWorldState, writeWorldState, readCampaignFile } from './storage.ts';
import { getStoryProvider } from './providers/index.ts';
import { buildRecapPrompt } from './session-processor/prompts.ts';
import { processSession, getDMResponse } from './session-processor/index.ts';
import { parseLocationContext, buildBattleMapPrompt, generateEncounterEnemies, generateCombatFlavour, resolveImprovisedAction, generateWorldState, tickWorldNarrative } from './session-processor/imagePrompts.ts';
import { generateBattleMap } from './providers/openai.ts';
import { mapsRouter } from './routes/maps.ts';
import { adminRouter } from './routes/admin.ts';
import { randomUUID } from 'crypto';

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
const encounterState = new Map<string, EnemyStatBlock[]>();
const tokenPositions = new Map<string, Record<string, { gx: number; gy: number }>>();
const dmQueue = new Map<string, Promise<void>>();
const campaignPlayers = new Map<string, string[]>();
const turnIndex = new Map<string, number>();
const turnOrders = new Map<string, TurnOrderEntry[]>();
const expectedTurnCount = new Map<string, number>();
const creatureState = new Map<string, Map<string, { currentHp: number; effects: string[] }>>();
const playerHp = new Map<string, Map<string, { current: number; max: number }>>();
const playerCharIdByName = new Map<string, Map<string, string>>();
const deathSaves = new Map<string, Map<string, { successes: number; failures: number; stable: boolean }>>();

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
  const order = turnOrders.get(cid) ?? [];
  if (!order.length) return;
  const idx = (turnIndex.get(cid) ?? 0) % order.length;
  const actor = order[idx]!;
  io.to(ROOM).emit('combat:turn', { actorName: actor.name });
  if (!actor.isPlayer) {
    setTimeout(() => void runEnemyAI(cid, actor), 800);
  } else {
    // Auto-resolve death save if this player is at 0 HP
    const charId = playerCharIdByName.get(cid)?.get(actor.name);
    const entry  = charId ? playerHp.get(cid)?.get(charId) : undefined;
    if (entry && entry.current <= 0) {
      setTimeout(() => void runDeathSave(cid, actor), 800);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isOccupied(positions: Record<string, { gx: number; gy: number }>, gx: number, gy: number, excludeId: string): boolean {
  return Object.entries(positions).some(([id, p]) => id !== excludeId && p.gx === gx && p.gy === gy);
}

async function runDeathSave(cid: string, actor: TurnOrderEntry): Promise<void> {
  if (!deathSaves.has(cid)) deathSaves.set(cid, new Map());
  const savesMap = deathSaves.get(cid)!;
  if (!savesMap.has(actor.name)) savesMap.set(actor.name, { successes: 0, failures: 0, stable: false });
  const saves = savesMap.get(actor.name)!;

  if (saves.stable) { advanceTurn(cid); return; }

  const roll     = d20();
  const isNat20  = roll === 20;
  const isNat1   = roll === 1;
  let stable = false;
  let dead   = false;

  if (isNat20) {
    // Regain 1 HP
    const charId = playerCharIdByName.get(cid)?.get(actor.name);
    const entry  = charId ? playerHp.get(cid)?.get(charId) : undefined;
    if (entry && charId) {
      entry.current = 1;
      io.to(ROOM).emit('combat:player:damage', { characterId: charId, characterName: actor.name, damage: -1, currentHp: 1, maxHp: entry.max });
    }
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

  const saveData = { characterName: actor.name, roll, isNatural20: isNat20, isNatural1: isNat1, success: roll >= 10, successes: saves.successes, failures: saves.failures, stable, dead };
  io.to(ROOM).emit('combat:death:save', saveData);

  const msg = dead
    ? `${actor.name} has failed their third death save — they are dead.`
    : (stable || isNat20)
    ? `${actor.name} rolls ${roll} — STABILIZED! (${saves.successes}/3 successes)`
    : roll >= 10
    ? `${actor.name} rolls ${roll} on a death save — SUCCESS (${saves.successes}/3 successes, ${saves.failures}/3 failures)`
    : isNat1
    ? `${actor.name} rolls a 1 — DOUBLE FAILURE (${saves.successes}/3 successes, ${saves.failures}/3 failures)`
    : `${actor.name} rolls ${roll} on a death save — FAILURE (${saves.successes}/3 successes, ${saves.failures}/3 failures)`;

  io.to(ROOM).emit('chat:message', { text: msg, senderName: 'Combat', timestamp: Date.now() });
  void appendChatLog(cid, { text: msg, senderName: 'Combat', timestamp: Date.now() });

  await delay(1500);
  advanceTurn(cid);
}

async function runEnemyAI(cid: string, actor: TurnOrderEntry): Promise<void> {
  if (!combatState.get(cid)) return;

  const statBlock = encounterState.get(cid)?.find(e => e.id === actor.id);
  if (!statBlock) return advanceTurn(cid);

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
  const maxSteps = Math.floor(statBlock.speed / 5);

  for (let step = 0; step < maxSteps; step++) {
    const dist = Math.max(Math.abs(target.gx - gx), Math.abs(target.gy - gy));
    if (dist <= 1) break;

    // Prefer diagonal, fall back to cardinal if blocked
    const dx = Math.sign(target.gx - gx);
    const dy = Math.sign(target.gy - gy);
    const pos = tokenPositions.get(cid) ?? {};
    const candidates = [
      { gx: gx + dx, gy: gy + dy },  // diagonal (preferred)
      { gx: gx + dx, gy },            // horizontal only
      { gx,          gy: gy + dy },   // vertical only
    ].filter(c => c.gx >= 0 && c.gy >= 0 && !isOccupied(pos, c.gx, c.gy, actor.id));

    const next = candidates[0];
    if (!next) break; // Blocked on all sides

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
  if (statBlock.attacks.length > 0) {
    const atk      = statBlock.attacks[Math.floor(Math.random() * statBlock.attacks.length)]!;
    const finalDist = Math.max(Math.abs(target.gx - gx), Math.abs(target.gy - gy));
    if (finalDist <= 1) {
      const chars      = await listCharacters(cid);
      const targetChar = chars.find(c => c.name === target.name);
      const targetAc   = targetChar ? (10 + statMod(targetChar.stats.dex)) : 10;
      const roll  = d20();
      const total = roll + atk.bonus;
      const hit   = total >= targetAc;
      let damage: number | undefined;
      let remainingHp: number | undefined;
      let targetDead = false;
      if (hit && targetChar) {
        damage = rollDice(atk.damage);
        const hpMap = playerHp.get(cid);
        const entry = hpMap?.get(targetChar.id);
        if (entry) {
          entry.current = Math.max(0, entry.current - damage);
          remainingHp = entry.current;
          targetDead  = entry.current <= 0;
          io.to(ROOM).emit('combat:player:damage', {
            characterId: targetChar.id,
            characterName: target.name,
            damage,
            currentHp: entry.current,
            maxHp: entry.max,
          });
          console.log(`[ai] ${actor.name} attacks ${target.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — HIT ${damage} (${entry.current}/${entry.max} HP)`);
        }
      } else {
        console.log(`[ai] ${actor.name} attacks ${target.name} with ${atk.name}: ${roll}${fmtMod(atk.bonus)} = ${total} vs AC ${targetAc} — MISS`);
      }
      // Non-blocking flavour text for NPC attacks
      void (async () => {
        const cfg = await getConfig();
        if (!cfg.combat.apiKey) return;
        const atkResult = { attackerName: actor.name, targetName: target.name, targetId: target.name, weaponName: atk.name, d20: roll, attackBonus: atk.bonus, total, ac: targetAc, hit, damage, damageFormula: hit ? atk.damage : undefined, remainingHp, targetDead };
        const flavour = await generateCombatFlavour(atkResult, cfg.combat.apiKey, cfg.combat.model);
        if (flavour) {
          const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
          io.to(ROOM).emit('chat:message', msg);
          void appendChatLog(cid, msg);
        }
      })();
    } else {
      console.log(`[ai] ${actor.name} cannot reach ${target.name} (${finalDist} cells away)`);
    }
  }

  await delay(600);
  advanceTurn(cid);
}

async function applyDamageToCreature(cid: string, targetId: string, damage: number): Promise<void> {
  const enemies = encounterState.get(cid) ?? [];
  const target  = enemies.find(e => e.id === targetId);
  if (!target) return;
  const creatures = creatureState.get(cid);
  const creature  = creatures?.get(targetId);
  if (!creature || creature.effects.includes('Dead')) return;

  creature.currentHp = Math.max(0, creature.currentHp - damage);
  io.to(ROOM).emit('creature:update', { id: targetId, currentHp: creature.currentHp, maxHp: target.hp, effects: creature.effects });

  if (creature.currentHp <= 0) {
    creature.effects.push('Dead');
    io.to(ROOM).emit('creature:update', { id: targetId, currentHp: 0, maxHp: target.hp, effects: creature.effects });
    console.log(`[combat] ${target.name} is dead`);

    // Remove from turn order; adjust index if needed
    const order   = turnOrders.get(cid) ?? [];
    const deadIdx = order.findIndex(e => e.id === targetId);
    const idx     = turnIndex.get(cid) ?? 0;
    if (deadIdx !== -1 && deadIdx < idx) turnIndex.set(cid, Math.max(0, idx - 1));
    turnOrders.set(cid, order.filter(e => e.id !== targetId));

    // Victory check
    const allDead = [...(creatures?.values() ?? [])].every(c => c.effects.includes('Dead'));
    if (allDead) {
      const totalXp      = enemies.reduce((sum, e) => sum + crToXp(e.cr), 0);
      const playerCount  = campaignPlayers.get(cid)?.length ?? 1;
      const xpPerPlayer  = Math.floor(totalXp / playerCount);
      io.to(ROOM).emit('combat:victory', { xpPerPlayer, totalXp, kills: enemies.map(e => e.name) });
      console.log(`[combat] victory! ${totalXp} XP total, ${xpPerPlayer} per player`);
      // Persist XP to each player's character file
      void listCharacters(cid).then(chars => Promise.all(
        chars.map(char => writeCharacter(cid, char.id, { ...char, xp: (char.xp ?? 0) + xpPerPlayer }))
      ));
      // Give the victory screen a moment then end combat
      setTimeout(() => {
        combatState.set(cid, false);
        encounterState.delete(cid);
        creatureState.delete(cid);
        tokenPositions.delete(cid);
        turnIndex.delete(cid);
        turnOrders.delete(cid);
        expectedTurnCount.delete(cid);
        const hpMap = playerHp.get(cid);
        if (hpMap) {
          void listCharacters(cid).then(chars => Promise.all(
            chars.map(c => {
              const entry = hpMap.get(c.id);
              return entry ? writeCharacter(cid, c.id, { ...c, currentHp: entry.current, maxHp: entry.max }) : Promise.resolve();
            })
          ));
        }
        playerHp.delete(cid);
        playerCharIdByName.delete(cid);
        deathSaves.delete(cid);
        void clearEncounter(cid);
        io.to(ROOM).emit('combat:state', false);
      }, 7000);
    }
  }
}

function advanceTurn(cid: string) {
  if (!combatState.get(cid)) return;
  const order = turnOrders.get(cid) ?? [];
  if (!order.length) return;
  const next = ((turnIndex.get(cid) ?? 0) + 1) % order.length;
  turnIndex.set(cid, next);
  emitTurn(cid);
}

function rollPlayerInitiatives(cid: string, chars: Character[]): void {
  const players = campaignPlayers.get(cid) ?? [];
  expectedTurnCount.set(cid, (expectedTurnCount.get(cid) ?? 0) + players.length);
  const hpMap = new Map(chars.map(c => {
    const max = calcMaxHp(c);
    return [c.id, { current: c.currentHp ?? max, max }];
  }));
  playerHp.set(cid, hpMap);
  playerCharIdByName.set(cid, new Map(chars.map(c => [c.name, c.id])));
  const entries: TurnOrderEntry[] = players.map(name => {
    const char = chars.find(c => c.name === name);
    const mod  = (char ? statMod(char.stats.dex) : 0) + (char?.initiativeBonus ?? 0);
    return { id: char?.id ?? name, name, initiative: d20() + mod, isPlayer: true };
  });
  addToTurnOrder(cid, entries);
}

function rollEnemyInitiatives(cid: string, enemies: EnemyStatBlock[]): void {
  const existing = turnOrders.get(cid)?.length ?? 0;
  expectedTurnCount.set(cid, (expectedTurnCount.get(cid) ?? 0) + enemies.length);
  const entries: TurnOrderEntry[] = enemies.map(e => ({
    id: e.id, name: e.name, initiative: d20() + statMod(e.stats.dex), isPlayer: false,
  }));
  addToTurnOrder(cid, entries, existing * 500);
}

function addToTurnOrder(cid: string, entries: TurnOrderEntry[], baseDelay = 0): void {
  entries.forEach((entry, i) => {
    setTimeout(() => {
      const current = turnOrders.get(cid) ?? [];
      // Upsert — replace existing entry for this id if re-rolling
      const updated = [...current.filter(e => e.id !== entry.id), entry];
      updated.sort((a, b) => b.initiative - a.initiative);
      turnOrders.set(cid, updated);
      io.to(ROOM).emit('combat:initiative', entry);
      // Start the first turn only once the full roster is in
      const expected = expectedTurnCount.get(cid) ?? 0;
      if (updated.length >= expected && expected > 0 && (turnIndex.get(cid) ?? 0) === 0) {
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
    if (!apiKey) { console.warn('[encounter] no combat API key, using fallback'); }

    const [messages, characters] = await Promise.all([
      readChatLog(campaignId),
      listCharacters(campaignId),
    ]);

    const enemies = await generateEncounterEnemies(messages, characters, apiKey, model);
    encounterState.set(campaignId, enemies);
    await saveEncounter(campaignId, enemies);
    io.to(ROOM).emit('encounter:ready', enemies);
    // Initialise live creature state (currentHp, effects)
    const creatures = new Map(enemies.map(e => [e.id, { currentHp: e.hp, effects: [] as string[] }]));
    creatureState.set(campaignId, creatures);
    console.log('[encounter] ready:', enemies.map(e => `${e.name} (CR ${e.cr})`).join(', '));
    if (combatState.get(campaignId)) rollEnemyInitiatives(campaignId, enemies);
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
      const enemies = encounterState.get(campaignId);
      if (enemies) {
        socket.emit('encounter:ready', enemies);
      } else {
        void loadEncounter(campaignId).then(saved => {
          if (saved?.length) socket.emit('encounter:ready', saved);
        });
      }
      const positions = tokenPositions.get(campaignId) ?? {};
      Object.entries(positions).forEach(([tokenId, pos]) => socket.emit('token:moved', { tokenId, ...pos }));
      const order = turnOrders.get(campaignId) ?? [];
      if (order.length) {
        socket.emit('combat:turn:order', order);
        const idx = (turnIndex.get(campaignId) ?? 0) % order.length;
        socket.emit('combat:turn', { actorName: order[idx]!.name });
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

    socket.on('session:end', ({ campaignId: cid }) => {
      sessionState.set(cid, false);
      io.to(ROOM).emit('session:state', false);
      void processSession(cid).then(result => {
        const names = [...(result.updated ?? []), ...(result.created ?? []), ...(result.cascaded ?? [])];
        const text = result.skipped
          ? 'Session ended — no chat to process.'
          : `Session ended — notes updated: ${names.join(', ') || 'nothing new'}`;
        io.to(ROOM).emit('chat:message', { text, senderName: 'System', timestamp: Date.now() });
      });
    });

    function dispatchDMResponse(cid: string): void {
      if (!sessionState.get(cid)) return;
      io.to(ROOM).emit('dm:thinking', true);
      queueDMResponse(cid, async () => {
        try {
          const response = await getDMResponse(cid);
          if (!response) return;

          if ((response.includes('[BEGIN COMBAT]') || /roll\s+(?:for\s+)?initiative/i.test(response)) && !combatState.get(cid)) {
            combatState.set(cid, true);
            turnIndex.set(cid, 0);
            turnOrders.set(cid, []);
            io.to(ROOM).emit('combat:state', true);
            void listCharacters(cid).then(chars => rollPlayerInitiatives(cid, chars));
            void generateAndBroadcastMap(cid);
            void generateAndBroadcastEnemies(cid);
          }
          if (response.includes('[COMBAT END]') && combatState.get(cid)) {
            combatState.set(cid, false);
            encounterState.delete(cid);
            tokenPositions.delete(cid);
            turnIndex.delete(cid);
            turnOrders.delete(cid);
            expectedTurnCount.delete(cid);
            creatureState.delete(cid);
            // Persist updated player HP
            const hpMap = playerHp.get(cid);
            if (hpMap) {
              void listCharacters(cid).then(chars => Promise.all(
                chars.map(c => {
                  const entry = hpMap.get(c.id);
                  return entry ? writeCharacter(cid, c.id, { ...c, currentHp: entry.current, maxHp: entry.max }) : Promise.resolve();
                })
              ));
            }
            playerHp.delete(cid);
            playerCharIdByName.delete(cid);
            deathSaves.delete(cid);
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

        // During combat, if it's this sender's turn, check for improvised action
        if (combatState.get(campaignId)) {
          const order = turnOrders.get(campaignId) ?? [];
          const currentActor = order[(turnIndex.get(campaignId) ?? 0) % order.length];
          if (currentActor?.name === senderName && currentActor.isPlayer) {
            void (async () => {
              try {
                const config = await getConfig();
                const { model, apiKey } = config.combat;
                if (!apiKey) return;
                const recent = (await readChatLog(campaignId)).slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');
                const char = await listCharacters(campaignId).then(cs => cs.find(c => c.name === senderName));
                const enemies = (encounterState.get(campaignId) ?? []).filter(e => {
                  const cs = creatureState.get(campaignId)?.get(e.id);
                  return !cs?.effects.includes('Dead');
                });
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
                  // Auto-roll the ability check
                  const statKey = (result.stat ?? 'str') as keyof CharacterStats;
                  const roll = d20();
                  const mod  = statMod(char.stats[statKey]);
                  const total = roll + mod;
                  const hit   = total >= result.dc;
                  const dmgRoll = hit ? rollDice(result.damageFormula) : undefined;

                  const rollMsg = { text: `${senderName} rolls ${result.stat?.toUpperCase() ?? 'STR'}: ${roll}${fmtMod(mod)} = ${total} vs DC ${result.dc} — ${hit ? `HIT! ${dmgRoll} ${result.damageType ?? ''} damage` : 'MISS'}.`, senderName: 'System', timestamp: Date.now() };
                  await appendChatLog(campaignId, rollMsg);
                  io.to(ROOM).emit('chat:message', rollMsg);

                  // Apply damage to target
                  if (hit && dmgRoll) {
                    void applyDamageToCreature(campaignId, result.targetId, dmgRoll);
                  }

                  // Flavour
                  const weapon = { name: 'improvised action', damage: result.damageFormula ?? '', damageType: result.damageType ?? '', attackBonus: 0, range: 5, properties: [] } as Weapon & { id: string; description: string; quantity: number };
                  const atkResult = { attackerName: senderName, targetName: enemies.find(e => e.id === result.targetId)?.name ?? 'target', targetId: result.targetId, weaponName: 'improvised action', d20: roll, attackBonus: mod, total, ac: result.dc, hit, damage: dmgRoll, damageFormula: result.damageFormula, remainingHp: creatureState.get(campaignId)?.get(result.targetId)?.currentHp, targetDead: creatureState.get(campaignId)?.get(result.targetId)?.effects.includes('Dead') ?? false };
                  const flavour = await generateCombatFlavour(atkResult, apiKey, model);
                  if (flavour) {
                    const flavourMsg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
                    await appendChatLog(campaignId, flavourMsg);
                    io.to(ROOM).emit('chat:message', flavourMsg);
                  }
                }
              } catch (err) { console.error('[improvised]', err); }
            })();
            return; // Don't call story DM during combat
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
      const current  = turnOrders.get(cid) ?? [];
      const isNew    = !current.find(e => e.id === entry.id);
      if (isNew) expectedTurnCount.set(cid, (expectedTurnCount.get(cid) ?? 0) + 1);
      const updated  = [...current.filter(e => e.id !== entry.id), entry]
        .sort((a, b) => b.initiative - a.initiative);
      turnOrders.set(cid, updated);
      io.to(ROOM).emit('combat:initiative', entry);
      const expected = expectedTurnCount.get(cid) ?? 0;
      if (updated.length >= expected && expected > 0 && (turnIndex.get(cid) ?? 0) === 0) {
        emitTurn(cid);
      }
    });

    socket.on('combat:attack', ({ attackerId, attackerName, targetId, weapon }: { attackerId: string; attackerName: string; targetId: string; weapon: Weapon }) => {
      void (async () => {
        const cid = campaignId;
        if (!combatState.get(cid)) return;

        const char    = await getCharacter(cid, attackerId);
        const enemies = encounterState.get(cid) ?? [];
        const target  = enemies.find(e => e.id === targetId);
        const creature = creatureState.get(cid)?.get(targetId);
        if (!char || !target || !creature || creature.effects.includes('Dead')) return;

        const strMod     = statMod(char.stats.str);
        const attackBonus = strMod + (weapon.attackBonus ?? 0);
        const roll       = d20();
        const total      = roll + attackBonus;
        const hit        = total >= target.ac;

        let damage: number | undefined;
        if (hit) {
          damage = rollDice(weapon.damage);
          await applyDamageToCreature(cid, targetId, damage);
        }

        const atkResult = {
          attackerName,
          targetName: target.name,
          targetId,
          weaponName: weapon.name,
          d20: roll,
          attackBonus,
          total,
          ac: target.ac,
          hit,
          damage,
          damageFormula: weapon.damage,
          remainingHp: hit ? creatureState.get(cid)?.get(targetId)?.currentHp : undefined,
          targetDead: creatureState.get(cid)?.get(targetId)?.effects.includes('Dead') ?? false,
        };
        io.to(ROOM).emit('combat:attack:result', atkResult);
        console.log(`[combat] ${attackerName} attacks ${target.name}: ${roll}${fmtMod(attackBonus)} = ${total} vs AC ${target.ac} — ${hit ? `HIT ${damage}` : 'MISS'}`);

        // Flavour text async — non-blocking
        void (async () => {
          try {
            const config  = await getConfig();
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
      advanceTurn(campaignId);
    });

    socket.on('disconnect', () => {
      connected.delete(player);
      io.to(ROOM).emit('players:update', [...connected]);
    });
  });
});

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`api listening on :${PORT}`);
});
