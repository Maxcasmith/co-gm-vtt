import type { Character } from 'shared';
import { statMod, hasOriginFeat, trackOf } from 'shared';
import { getCharacter, updateCharacter, readChatLog, saveEncounter, clearEncounter, saveDungeon, listCharacters, loadPartyAllies, readNemeses, getConfig } from '../../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../../providers/index.ts';
import { evaluateNemesisCandidates } from '../../session-processor/imagePrompts.ts';
import { toClientDungeon, chainClosure, broadcastDungeon } from '../../dungeon/index.ts';
import { Participant, PLAYERS_TEAM_ID, type Encounter } from '../../domain/encounter.ts';
import { Creature } from '../../domain/creature.ts';
import { logError } from '../../logger.ts';
import { campaignRoom, io, positionsOf, dungeonOf, dungeonsIn, fightDungeon, occupantsOf, campaignPlayers, pendingWeaponBonuses, connected, getStateEngine, COMBAT_CHAIN_RADIUS, fightsIn, fightOf, unregisterFight, toFight, toSockets, playerSocketIds, toDungeonOf } from '../../state.ts';
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
import { getPartyGroups, postChat } from '../../partyGroups.ts';

/**
 * Refills the incoming actor's action economy and fires `beforeTurn`. Shared by the combat-start
 * path and every turn advance, so the very first actor of a fight gets the same treatment as
 * everyone after them.
 */
async function runTurnStart(cid: string, encounter: Encounter): Promise<void> {
  const actor = encounter.currentActor;
  if (!actor) return;
  // Whoever just moved last turn (a creature especially — its AI walk doesn't go through token:move)
  // may have closed the chain on a bystander, or on another fight.
  void resolveFightChains(cid);
  actor.refillResources();
  emitResources(cid, actor);
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
  recomputeIllumination(cid, fightDungeon(cid, encounter));
}

/**
 * Starts the fight once every expected participant has rolled initiative. Previously this guard
 * plus beginCombat/emitTurn was copy-pasted into both the initiative paths (addToTurnOrder's
 * callback and the combat:initiative:roll handler); they now share this one function so the
 * beforeCombat stage cannot fire on one path and not the other.
 */
/** Ids of everyone in the fight — the scope for fight-wide hook stages, so one fight's rounds never tick another's hooks. */
export function fightScope(encounter: Encounter): Set<string> {
  return new Set(encounter.teams.flatMap(t => t.participants.map(p => p.id)));
}

export function tryBeginCombat(cid: string, encounter: Encounter): void {
  const expected = encounter.expectedParticipantCount;
  if (encounter.ended || expected <= 0 || encounter.turnOrder.length < expected || encounter.currentRound || !encounter.enemiesReady) return;

  encounter.beginCombat();
  void (async () => {
    await getStateEngine(cid).trigger('beforeCombat', { round: encounter.currentRound?.number ?? 1 }, fightScope(encounter));
    if (encounter.ended) return;
    await runTurnStart(cid, encounter);
    if (encounter.ended) return;
    emitTurn(cid, encounter);
  })();
}

export function emitTurn(cid: string, encounter: Encounter) {
  if (encounter.ended) return;

  if (encounter.allPlayersDown()) {
    endCombatDefeated(cid, encounter);
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
  toFight(encounter).emit('combat:turn', {
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
function pruneExpiredHazardCells(cid: string, encounter: Encounter, round: number): void {
  const dungeon = fightDungeon(cid, encounter);
  if (!dungeon?.hazardCells?.length) return;
  // Only this fight's hazards — another fight's round numbers mean nothing to them.
  const kept = dungeon.hazardCells.filter(h => h.expiresOnRound === undefined || (h.fightId !== undefined && h.fightId !== encounter.id) || h.expiresOnRound > round);
  if (kept.length === dungeon.hazardCells.length) return;
  dungeon.hazardCells = kept;
  void saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);
}

export async function evaluateNemesisAfterCombat(cid: string, encounter: Encounter): Promise<void> {
  try {
    // Captured synchronously, before any await — endCombat() calls encounter.teardown()
    // right after this function's first await suspends it, which wipes encounter.teams.
    const enemyParticipants = encounter.enemies.filter(p => p.creature);
    const roster = enemyParticipants.map(p => p.creature!.toStatBlock());
    if (!roster.length) return;
    const statusLines = enemyParticipants.map(p =>
      `${p.name}: ${p.creature!.isDead() ? 'dead' : `${p.creature!.currentHp}/${p.creature!.hp} HP, alive`}`
    );

    const startedAt = encounter.startedAt;
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
      }], 'all');
    }
  } catch (err) {
    logError('index:evaluateNemesisAfterCombat', err);
  }
}

export async function endCombat(cid: string, encounter: Encounter): Promise<void> {
  encounter.ended = true;
  const scope = fightScope(encounter);
  // Awaited before teardown so afterCombat hooks still see a live encounter.
  const engine = getStateEngine(cid);
  await engine.trigger('afterCombat', { round: encounter.currentRound?.number ?? 0 }, scope);

  void evaluateNemesisAfterCombat(cid, encounter);

  // One process: every kill/damage tallied during the fight lands on each character sheet
  // in a single read-modify-write, rather than a write per hit.
  void Promise.all([...encounter.scores].map(([charId, s]) =>
    updateCharacter(cid, charId, c => ({
      ...c,
      enemiesKilled: (c.enemiesKilled ?? 0) + s.enemiesKilled,
      damageDealt: (c.damageDealt ?? 0) + s.damageDealt,
      damageReceived: (c.damageReceived ?? 0) + s.damageReceived,
    }))
  ));

  // Offline-AI-spawned party members (see rollPlayerInitiatives) only existed for this fight —
  // any player-participant whose name isn't currently connected was necessarily one of them,
  // since only connected names get added the normal way. Drop their token before teardown.
  const positions = fightDungeon(cid, encounter)?.positions;
  if (positions) {
    for (const p of encounter.players) {
      if (p.isPlayer && !connected.has(p.name)) delete positions[p.name];
    }
  }

  // The campaign's hook registry is shared by every fight (and exploration) — drop only this
  // fight's combatants' hooks, never the whole engine, or ending one fight would strip another's.
  for (const id of scope) {
    engine.unregisterByOwner(id);
    delete pendingWeaponBonuses.get(cid)?.[id];
  }
  encounter.teardown();
  unregisterFight(cid, encounter);
  void clearEncounter(cid, encounter);
}

// Guards endCombatDefeated against firing twice for the same wipe — `ended` can't serve that
// purpose here since this also fires with no active combat (an exploration death).
const defeatedFights = new Set<string>();

/** A fight's players all went down. Their fight ends; the session only ends if that was everyone
 * (no other group still standing somewhere else). */
export function endCombatDefeated(cid: string, encounter?: Encounter): void {
  const key = encounter?.id ?? cid;
  if (defeatedFights.has(key)) return;
  defeatedFights.add(key);
  if (encounter) encounter.ended = true;
  const audience = encounter ? toFight(encounter) : io.to(campaignRoom(cid));
  // Solo-party / whole-party wipe = game over (see CLAUDE-README). One split group falling while
  // another is still up somewhere is just that group's defeat.
  const online = (campaignPlayers.get(cid) ?? []).filter(name => connected.has(name));
  const wholeParty = !encounter || online.every(name => encounter.findParticipant(name));
  audience.emit('combat:defeat');
  setTimeout(() => {
    if (encounter) void endCombat(cid, encounter);
    audience.emit('combat:state', false);
    if (wholeParty) endSession(cid);
    defeatedFights.delete(key);
  }, 8000);
}

// Advancing a turn is asynchronous now that hook stages are awaited, which opens a window the old
// synchronous version did not have: a second advanceTurn arriving mid-flight (a client's
// combat:turn:end racing the enemy AI's own end-of-turn call) would fire afterTurn twice for the
// same actor and skip a participant. One advance in flight per fight (encounter.advancing).
export function advanceTurn(cid: string, encounter: Encounter) {
  if (encounter.ended || !encounter.turnOrder.length) return;
  if (encounter.advancing) {
    console.log('[turn] advanceTurn ignored — an advance is already in flight');
    return;
  }
  encounter.advancing = true;

  void (async () => {
    try {
      const engine = getStateEngine(cid);
      const round = encounter.currentRound?.number ?? 1;

      const outgoing = encounter.currentActor;
      if (outgoing) {
        await engine.trigger('afterTurn', {
          participantId: outgoing.id, participantName: outgoing.name, isPlayer: outgoing.isPlayer, round,
        });
        // Hook chains are awaited, so combat may have ended (or been merged away) while suspended —
        // same re-guard the delay()-based paths in runEnemyAI already use.
        if (encounter.ended) return;
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
        const scope = fightScope(encounter);
        await engine.trigger('afterRound', { round }, scope);
        await engine.trigger('beforeRound', { round: encounter.currentRound?.number ?? round + 1 }, scope);
        if (encounter.ended) return;
        pruneExpiredHazardCells(cid, encounter, encounter.currentRound?.number ?? round + 1);
      }

      // beforeTurn hooks can damage the incoming actor (a lingering acid/poison effect ticking at
      // the start of its turn). A creature killed here is spliced out of the turn order by
      // applyDamageToCreature, which leaves currentActor pointing at the next live participant —
      // so emitTurn below still lands correctly without needing to re-advance.
      await runTurnStart(cid, encounter);
      if (encounter.ended) return;

      emitTurn(cid, encounter);
      void saveEncounter(cid, encounter);
    } finally {
      encounter.advancing = false;
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

function buildPlayerParticipant(cid: string, name: string, char: Character | undefined): Participant {
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
  if (char) {
    registerReactionOffers(cid, char);
    registerStaticDamageModifiers(cid, char.id, char);
  }
  return participant;
}

/** Rolls initiative for `names` and queues them into `encounter` — at combat start, or mid-fight
 * when the chain rule pulls someone in. Skips anyone already in a fight (two moves racing to pull
 * in the same player, or someone who got pulled into another fight first). Returns who was added. */
export function addPlayersToFight(cid: string, encounter: Encounter, chars: Character[], names: string[], baseDelay = 0): Participant[] {
  const team = encounter.team(PLAYERS_TEAM_ID, 'Players');
  // Not already in this fight, and not claimed by a different one (this fight's own pending claims are fine).
  const entries = [...new Set(names)].filter(name => !encounter.findParticipant(name) && (fightOf(cid, name) ?? encounter) === encounter).map(name => {
    const participant = buildPlayerParticipant(cid, name, chars.find(c => c.name === name));
    team.addParticipant(participant);
    return participant;
  });
  encounter.expectedParticipantCount += entries.length;
  addToTurnOrder(cid, encounter, entries, baseDelay);
  return entries;
}

/** Combat start: `names` are the connected players in this fight (the chain rule's pick in a
 * dungeon, the acting group in the open world) — not everyone online. Their allies and their
 * group's AI-controlled offline members come with them; anyone else's stay out. */
export async function rollPlayerInitiatives(cid: string, encounter: Encounter, chars: Character[], names: string[]): Promise<void> {
  const team = encounter.team(PLAYERS_TEAM_ID, 'Players');
  const entries = addPlayersToFight(cid, encounter, chars, names);
  const inFight = new Set(names);

  // Persistent party allies follow their owner — one whose owner is off elsewhere stays out of this fight.
  const allies = (await loadPartyAllies(cid)).filter(sb => !sb.ownerId || chars.some(c => c.id === sb.ownerId && inFight.has(c.name)));
  if (allies.length) {
    const allyEntries = allies.map(sb => {
      const creature = Creature.from(sb);
      const p = new Participant({
        id: creature.id,
        name: creature.name,
        initiative: new D20Roll().roll() + statMod(creature.stats.dex),
        isPlayer: false,
        teamId: PLAYERS_TEAM_ID,
        creature,
        ownerId: sb.ownerId,
      });
      team.addParticipant(p);
      registerStaticDamageModifiers(cid, creature.id, creature);
      return p;
    });
    encounter.expectedParticipantCount += allyEntries.length;
    addToTurnOrder(cid, encounter, allyEntries, entries.length * 500);
  }

  // Offline party members who opted into AI control (see the AI tab) spawn in for this fight
  // only, adjacent to someone from their own Party Groups track who's in it (with the party
  // together, that's simply the first fighter) — same "adjacent, or stack if boxed in" rule
  // combat/ai/executor.ts's findOpenAdjacent already gives summons. A member whose track has
  // nobody in the fight, or no token to anchor on, stays out; despawned again in endCombat.
  const groups = await getPartyGroups(cid);
  const positions = fightDungeon(cid, encounter)?.positions ?? {};
  const aiEntries: Participant[] = [];
  for (const char of chars.filter(c => !connected.has(c.name) && c.aiControlled && !fightOf(cid, c.id))) {
    const anchorName = names.find(n => trackOf(groups, n) === trackOf(groups, char.name));
    const anchorPos = anchorName ? positions[anchorName] : undefined;
    if (!anchorPos) continue;
    const pos = findOpenAdjacent(positions, anchorPos.gx, anchorPos.gy);
    positions[char.name] = pos;
    toDungeonOf(cid, char.name).emit('token:moved', { tokenId: char.name, gx: pos.gx, gy: pos.gy });
    const participant = buildPlayerParticipant(cid, char.name, char);
    team.addParticipant(participant);
    aiEntries.push(participant);
  }
  if (aiEntries.length) {
    encounter.expectedParticipantCount += aiEntries.length;
    addToTurnOrder(cid, encounter, aiEntries, entries.length * 500);
  }
}

/** Full combat snapshot, for players whose client saw none of this fight happen — pulled in
 * mid-fight by the chain rule, or merged in from another fight. */
export function syncFight(encounter: Encounter, audience = toFight(encounter)): void {
  audience.emit('combat:state', true);
  audience.emit('encounter:ready', encounter.enemies.filter(p => p.creature).map(p => p.creature!.toStatBlock()));
  if (!encounter.turnOrder.length) return;
  audience.emit('combat:turn:order', encounter.turnOrder.map(p => p.toTurnOrderEntry()));
  const actor = encounter.currentRound ? encounter.currentActor : undefined;
  if (actor) audience.emit('combat:turn', { actorId: actor.id, actorName: actor.name });
}

function livePositionsOf(cid: string, encounter: Encounter): { gx: number; gy: number }[] {
  const positions = fightDungeon(cid, encounter)?.positions ?? {};
  return encounter.turnOrder
    .filter(p => !p.isDead())
    .map(p => positions[p.isPlayer ? p.name : p.id])
    .filter((pos): pos is { gx: number; gy: number } => !!pos);
}

/** Oldest fight absorbs the newer one — its round count and current actor carry on. */
function mergeFights(cid: string, keep: Encounter, gone: Encounter): void {
  console.log(`[combat] fights merge: ${gone.id} → ${keep.id}`);
  keep.absorb(gone);
  unregisterFight(cid, gone);
  void clearEncounter(cid, gone);
  void saveEncounter(cid, keep);
  syncFight(keep);
  void postChat(cid, { text: 'The fights converge into one battle!', senderName: 'Combat', timestamp: Date.now() }, keep.turnOrder.map(p => p.id));
}

/** The chain rule (dungeon only — the open world has no positions): two fights whose combatants
 * come within COMBAT_CHAIN_RADIUS cells and sight of each other merge; then every connected
 * player outside any fight who is within range and sight of anyone in one (directly, or through
 * someone who just joined) is pulled into it. Runs on every player move and every turn start, so
 * a creature walking up to a bystander catches them too. */
export async function resolveFightChains(cid: string): Promise<void> {
  let chars: Character[] | undefined;
  // Per map: fights in different dungeons can never reach each other. An open-world combat arena
  // isn't a place anyone else is standing in — its grid shares coordinates with every other arena,
  // so chaining there would drag in bystanders who are nowhere near. Open-world fights don't chain.
  for (const dungeon of dungeonsIn(cid)) {
    if (dungeon.arena) continue;
    const here = (fight: Encounter) => fightDungeon(cid, fight)?.id === dungeon.id;

    const byAge = fightsIn(cid).filter(here).sort((a, b) => a.startedAt - b.startedAt);
    for (const [i, keep] of byAge.entries()) {
      for (const other of byAge.slice(i + 1)) {
        if (keep.ended || other.ended) continue;
        const otherCells = Object.fromEntries(livePositionsOf(cid, other).map((pos, k) => [String(k), pos]));
        if (chainClosure(dungeon, livePositionsOf(cid, keep), otherCells, COMBAT_CHAIN_RADIUS).length) mergeFights(cid, keep, other);
      }
    }

    const positions = dungeon.positions ?? {};
    for (const fight of fightsIn(cid).filter(here)) {
      // Only players standing in this dungeon — someone in another dungeon (or out in the world)
      // shares its coordinates but none of its space.
      const candidates = Object.fromEntries(occupantsOf(cid, dungeon.id).flatMap(name => {
        const pos = positions[name];
        return pos && connected.has(name) && !fightOf(cid, name) ? [[name, pos] as const] : [];
      }));
      const names = chainClosure(dungeon, livePositionsOf(cid, fight), candidates, COMBAT_CHAIN_RADIUS);
      if (!names.length) continue;
      chars ??= await listCharacters(cid);
      const added = addPlayersToFight(cid, fight, chars, names);
      syncFight(fight, toSockets(added.map(p => playerSocketIds.get(p.id)).filter((sid): sid is string => !!sid)));
      for (const p of added) {
        void postChat(cid, { text: `${p.name} joins the fight!`, senderName: 'Combat', timestamp: Date.now() }, [p.id]);
      }
    }
  }
}

export function rollEnemyInitiatives(cid: string, encounter: Encounter): void {
  encounter.enemiesReady = true;
  const existing = encounter.turnOrder.length;
  const entries = encounter.enemies.map(p => {
    p.initiative = new D20Roll().roll() + statMod(p.creature?.stats.dex ?? 10);
    if (p.creature) registerStaticDamageModifiers(cid, p.id, p.creature);
    return p;
  });
  addToTurnOrder(cid, encounter, entries, existing * 500);
}

export function addToTurnOrder(cid: string, encounter: Encounter, entries: Participant[], baseDelay = 0): void {
  entries.forEach((entry, i) => {
    setTimeout(() => {
      if (encounter.ended) return;
      encounter.addToTurnOrder(entry);
      toFight(encounter).emit('combat:initiative', entry.toTurnOrderEntry());
      tryBeginCombat(cid, encounter);
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
  const encounter = fightOf(cid, characterId);
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
  if (encounter.ended || requester.alertSwapUsed) return;

  const requesterInit = requester.initiative;
  requester.initiative = target.initiative;
  target.initiative = requesterInit;
  requester.alertSwapUsed = true;
  encounter.addToTurnOrder(requester);
  encounter.addToTurnOrder(target);
  toFight(encounter).emit('combat:initiative', requester.toTurnOrderEntry());
  toFight(encounter).emit('combat:initiative', target.toTurnOrderEntry());
  console.log(`[alert] ${requester.name} swaps Initiative with ${target.name}`);
}

