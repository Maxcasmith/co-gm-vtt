import type { Character } from 'shared';
import { statMod, hasOriginFeat } from 'shared';
import { getCharacter, updateCharacter, readChatLog, saveEncounter, clearEncounter, saveDungeon, listCharacters, loadPartyAllies, readNemeses, getConfig } from '../../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../../providers/index.ts';
import { evaluateNemesisCandidates } from '../../session-processor/imagePrompts.ts';
import { toClientDungeon } from '../../dungeon/index.ts';
import { Team, Participant } from '../../domain/encounter.ts';
import { Creature } from '../../domain/creature.ts';
import { logError } from '../../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, campaignPlayers, enemiesReady, combatStartedAt, combatScores, dungeons, pendingWeaponBonuses, activeMarks, microDungeons, connected, withLivePositions, getStateEngine, stateEngines } from '../../state.ts';
import { D20Roll, calcMaxHp } from '../dice.ts';
import { ReactionOfferHook } from '../stateEngine/hooks/ReactionOfferHook.ts';
import { RetaliationOfferHook } from '../stateEngine/hooks/RetaliationOfferHook.ts';
import { offerReaction } from '../stateEngine/reactionPrompt.ts';
import { DamageResistanceHook } from '../stateEngine/hooks/DamageResistanceHook.ts';
import { registerPassiveClassHooks, registerPassiveFightingStyleHooks } from '../stateEngine/passiveClassHooks.ts';
import type { SpeedModifierHook } from '../stateEngine/hooks/SpeedModifierHook.ts';
import type { ActionUnlockHook } from '../stateEngine/hooks/ActionUnlockHook.ts';
import { findSpell } from '../../routes/spells.ts';
import { applyEffects } from '../../effects.ts';
import { endSession } from '../../session.ts';
import { findOpenAdjacent } from '../ai/executor.ts';
import { runEnemyAI, runPlayerTactics } from './ai.ts';
import { applyDamageToCreature } from './damage.ts';
import { runDeathSave } from './deathSaves.ts';
import { recomputeIllumination } from './environment.ts';
import { delay, emitResources } from './shared.ts';

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
  if (actor.isPlayer) {
    const char = await getCharacter(cid, actor.id);
    if (char) {
      registerPassiveClassHooks(getStateEngine(cid), actor.id, char.class, char.level ?? 1);
      if (char.fightingStyle) registerPassiveFightingStyleHooks(getStateEngine(cid), actor.id, char.fightingStyle);
    }
  }
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
    actorId: actor.id,
    actorName: actor.name,
    ...(speedMultiplier !== 1 ? { speedMultiplier } : {}),
    ...(speedBonusFt !== 0 ? { speedBonusFt } : {}),
    ...(buffs.length ? { buffs } : {}),
  });

  if (!actor.isPlayer) {
    setTimeout(() => void runEnemyAI(cid, actor), 800);
  } else if (actor.isDown()) {
    setTimeout(() => void runDeathSave(cid, actor), 800);
  } else {
    void (async () => {
      const char = await getCharacter(cid, actor.id);
      if (char?.aiControlled && !connected.has(actor.name)) setTimeout(() => void runPlayerTactics(cid, actor), 800);
    })();
  }
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

  // Offline-AI-spawned party members (see rollPlayerInitiatives) only existed for this fight —
  // any player-participant whose name isn't currently connected was necessarily one of them,
  // since only connected names get added the normal way. Drop their token before teardown.
  if (encounter) {
    const positions = tokenPositions.get(cid);
    if (positions) {
      for (const p of encounter.players) {
        if (!connected.has(p.name)) delete positions[p.name];
      }
      tokenPositions.set(cid, positions);
    }
  }

  encounter?.teardown();
  encounters.delete(cid);
  stateEngines.delete(cid);
  combatStartedAt.delete(cid);
  pendingWeaponBonuses.delete(cid);
  activeMarks.delete(cid);
  void clearEncounter(cid);
}

// Guards endCombatDefeated against firing twice for the same wipe — combatState can't serve
// that purpose here since this now also fires with no active combat (an exploration death).
const defeatedCampaigns = new Set<string>();

export function endCombatDefeated(cid: string): void {
  if (defeatedCampaigns.has(cid)) return;
  defeatedCampaigns.add(cid);
  combatState.set(cid, false);
  enemiesReady.delete(cid);
  io.to(ROOM).emit('combat:defeat');
  setTimeout(() => {
    void endCombat(cid);
    io.to(ROOM).emit('combat:state', false);
    microDungeons.delete(cid);
    endSession(cid);
    defeatedCampaigns.delete(cid);
  }, 8000);
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

      // If afterTurn killed the outgoing actor (a DoT ticking on their own turn), applyDamageTo*
      // already spliced them out of turnOrder — which, per removeFromTurnOrder, leaves _turnIndex
      // pointing at whoever shifted into their old slot (the correct next actor). Advancing again
      // here would double-increment and skip that participant entirely.
      const outgoingGone = !!outgoing && !encounter.turnOrder.some(p => p.id === outgoing.id);
      const before = encounter.currentActor?.name ?? '?';
      const { roundStarted } = outgoingGone ? { roundStarted: false } : encounter.advanceTurn();
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

  // Offline party members who opted into AI control (see the AI tab) spawn in for this fight
  // only, adjacent to whichever online player happens to be first — same "adjacent, or stack if
  // boxed in" rule combat/ai/executor.ts's findOpenAdjacent already gives summons. Skipped
  // entirely if nobody's online to anchor the spawn point on; despawned again in endCombat.
  const anchorPos = players[0] ? tokenPositions.get(cid)?.[players[0]] : undefined;
  if (anchorPos) {
    const offlineAiChars = chars.filter(c => !connected.has(c.name) && c.aiControlled);
    if (offlineAiChars.length) {
      const positions = tokenPositions.get(cid) ?? {};
      const aiEntries = offlineAiChars.map(char => {
        const pos = findOpenAdjacent(positions, anchorPos.gx, anchorPos.gy);
        positions[char.name] = pos;
        io.to(ROOM).emit('token:moved', { tokenId: char.name, gx: pos.gx, gy: pos.gy });

        const alertBonus = hasOriginFeat(char, 'Alert') ? (char.proficiencyBonus ?? 2) : 0;
        const mod = statMod(char.stats.dex) + (char.initiativeBonus ?? 0) + alertBonus;
        const maxHp = calcMaxHp(char);
        const participant = new Participant({
          id: char.id,
          name: char.name,
          initiative: new D20Roll().roll() + mod,
          isPlayer: true,
          teamId: 'players',
          currentHp: char.currentHp ?? maxHp,
          maxHp,
          tempHp: char.tempHp ?? 0,
        });
        playerTeam!.addParticipant(participant);
        registerReactionOffers(cid, char);
        registerStaticDamageModifiers(cid, char.id, char);
        return participant;
      });
      tokenPositions.set(cid, positions);
      encounter.expectedParticipantCount += aiEntries.length;
      addToTurnOrder(cid, aiEntries, entries.length * 500);
    }
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

/**
 * Origin feat Alert's swap clause: offers targetId (a willing ally) the chance to trade rolled
 * Initiative with characterId. Once per combat per requester (alertSwapUsed), not per-turn, so
 * it isn't cleared by refillResources. Only a real connected player can be offered — offerReaction
 * needs a live socket to prompt, which AI-controlled allies and summons don't have.
 */
export async function requestAlertSwap(cid: string, characterId: string, targetId: string): Promise<void> {
  if (!combatState.get(cid)) return;
  const encounter = encounters.get(cid);
  if (!encounter) return;

  const requester = encounter.findParticipant(characterId);
  const target = encounter.findParticipant(targetId);
  if (!requester || !target || requester.id === target.id || !target.isPlayer) return;
  if (requester.alertSwapUsed) return;

  const char = await getCharacter(cid, characterId);
  if (!char || !hasOriginFeat(char, 'Alert')) return;

  const picked = await offerReaction(cid, targetId, [{
    spellName: 'Alert Swap', kind: 'swap', attackerName: requester.name, sourceName: 'Alert',
  }]);
  if (!picked) return;

  // Re-check after the await — combat may have ended, or this got used elsewhere in the meantime.
  if (!combatState.get(cid) || !encounters.get(cid) || requester.alertSwapUsed) return;

  const requesterInit = requester.initiative;
  requester.initiative = target.initiative;
  target.initiative = requesterInit;
  requester.alertSwapUsed = true;
  encounter.addToTurnOrder(requester);
  encounter.addToTurnOrder(target);
  io.to(ROOM).emit('combat:initiative', requester.toTurnOrderEntry());
  io.to(ROOM).emit('combat:initiative', target.toTurnOrderEntry());
  console.log(`[alert] ${requester.name} swaps Initiative with ${target.name}`);
}

