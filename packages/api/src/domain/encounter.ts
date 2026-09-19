import { randomUUID } from 'crypto';
import type { TurnOrderEntry, ActionResource, EnemyStatBlock } from 'shared';
import { setTempHp, statMod } from 'shared';
import { Creature } from './creature.ts';
import { D20Roll } from '../combat/dice.ts';

// ── Turn ──────────────────────────────────────────────────────────────────────

export class Turn {
  participant: Participant;
  startedAt: number;
  completedAt?: number;

  constructor(participant: Participant) {
    this.participant = participant;
    this.startedAt = Date.now();
  }

  complete(): void {
    this.completedAt = Date.now();
  }

  get isActive(): boolean {
    return this.completedAt === undefined;
  }
}

// ── Round ─────────────────────────────────────────────────────────────────────

export class Round {
  number: number;
  turns: Turn[] = [];

  constructor(number: number) {
    this.number = number;
  }

  get currentTurn(): Turn | undefined {
    return this.turns[this.turns.length - 1];
  }

  addTurn(participant: Participant): Turn {
    const turn = new Turn(participant);
    this.turns.push(turn);
    return turn;
  }
}

// ── Participant ───────────────────────────────────────────────────────────────

export class Participant {
  id: string;
  name: string;
  initiative: number;
  isPlayer: boolean;
  teamId: string;
  creature?: Creature;
  /** See EnemyStatBlock.ownerId — which player controls this ally's token, if any. */
  ownerId?: string;

  // Player-only HP tracking
  currentHp: number;
  maxHp: number;
  tempHp: number;

  deathSaves: { successes: number; failures: number; stable: boolean } = {
    successes: 0,
    failures: 0,
    stable: false,
  };

  // 5e action economy for the current turn, refilled by the StateEngine's beforeTurn step.
  // Reactions refresh at the start of your turn (not the end), which is what makes one
  // available during every *other* participant's turn — the window Shield is cast in.
  //
  // ponytail: movement is deliberately absent — the client already owns movementRemaining
  // (GamePage refills it on vtt:combat:turn and decrements on vtt:movement:used), and
  // mirroring it here without also moving distance validation into the token:move handler
  // would leave two sources of truth. Move it server-side when movement needs enforcing.
  actionsRemaining = 1;
  bonusActionsRemaining = 1;
  reactionsRemaining = 1;

  /** Wardaway's "only an action or a Bonus Action, not both" — armed/disarmed by LinkedActionEconomyHook. */
  linkedActionEconomy = false;

  /** Height off the ground (Feather Fall, falling damage) — set via combat:elevation:set, see applyElevationChange in runtime.ts. */
  elevationFt = 0;

  /** Took the Disengage action this turn — its movement doesn't provoke Opportunity Attacks (see checkOpportunityAttacks, runtime.ts). Cleared on refillResources like every other per-turn flag. */
  disengaging = false;

  /** Origin feat Savage Attacker's "once per turn" reroll — cleared on refillResources like every other per-turn flag. */
  savageAttackerUsed = false;

  /** Origin feat Tavern Brawler's "once per turn" push — cleared on refillResources like every other per-turn flag. */
  tavernBrawlerPushUsed = false;

  /** Origin feat Alert's initiative-swap clause — once per combat, not per-turn, so this is never cleared by refillResources. */
  alertSwapUsed = false;

  constructor(props: {
    id: string;
    name: string;
    initiative: number;
    isPlayer: boolean;
    teamId?: string;
    creature?: Creature;
    ownerId?: string | undefined;
    currentHp?: number;
    maxHp?: number;
    tempHp?: number;
  }) {
    this.id = props.id;
    this.name = props.name;
    this.initiative = props.initiative;
    this.isPlayer = props.isPlayer;
    this.teamId = props.teamId ?? (props.isPlayer ? 'players' : 'enemies');
    if (props.creature !== undefined) this.creature = props.creature;
    if (props.ownerId !== undefined) this.ownerId = props.ownerId;
    this.currentHp = props.currentHp ?? (props.creature?.currentHp ?? 0);
    this.maxHp = props.maxHp ?? (props.creature?.hp ?? 0);
    this.tempHp = props.tempHp ?? 0;
  }

  isDown(): boolean {
    if (!this.isPlayer) return this.creature?.isDead() ?? false;
    return this.currentHp <= 0;
  }

  isDead(): boolean {
    if (!this.isPlayer) return this.creature?.isDead() ?? false;
    return this.deathSaves.failures >= 3;
  }

  takeDamage(amount: number): void {
    if (!this.isPlayer) {
      this.creature?.takeDamage(amount);
      return;
    }
    // Temp HP absorbs first and is never restored by it — a separate pool from real HP.
    const absorbed = Math.min(this.tempHp, amount);
    this.tempHp -= absorbed;
    this.currentHp = Math.max(0, this.currentHp - (amount - absorbed));
  }

  heal(amount: number): void {
    if (!this.isPlayer) {
      this.creature?.heal(amount);
      return;
    }
    this.currentHp = Math.min(this.maxHp, this.currentHp + amount);
  }

  /** Sets (not adds) temp HP — the higher of what's already there and this grant wins. */
  grantTempHp(amount: number): void {
    this.tempHp = setTempHp(this.tempHp, amount);
  }

  refillResources(): void {
    this.actionsRemaining = 1;
    this.bonusActionsRemaining = 1;
    this.reactionsRemaining = 1;
    this.disengaging = false;
    this.savageAttackerUsed = false;
    this.tavernBrawlerPushUsed = false;
  }

  hasResource(kind: ActionResource): boolean {
    return this.resourceCount(kind) > 0;
  }

  /** Spends one of `kind` if available. Returns false (and changes nothing) when the budget is empty. */
  trySpend(kind: ActionResource): boolean {
    if (!this.hasResource(kind)) return false;
    if (kind === 'action') this.actionsRemaining--;
    else if (kind === 'bonusAction') this.bonusActionsRemaining--;
    else this.reactionsRemaining--;
    // Wardaway: spending either action or bonus action this turn forfeits the other.
    if (this.linkedActionEconomy && (kind === 'action' || kind === 'bonusAction')) {
      this.linkedActionEconomy = false;
      this.actionsRemaining = 0;
      this.bonusActionsRemaining = 0;
    }
    return true;
  }

  private resourceCount(kind: ActionResource): number {
    if (kind === 'action') return this.actionsRemaining;
    if (kind === 'bonusAction') return this.bonusActionsRemaining;
    return this.reactionsRemaining;
  }

  toTurnOrderEntry(): TurnOrderEntry {
    return {
      id: this.id,
      name: this.name,
      initiative: this.initiative,
      isPlayer: this.isPlayer,
      teamId: this.teamId,
      ...(this.ownerId !== undefined ? { ownerId: this.ownerId } : {}),
    };
  }
}

// ── Team ──────────────────────────────────────────────────────────────────────

export class Team {
  id: string;
  name: string;
  participants: Participant[] = [];

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  addParticipant(p: Participant): void {
    this.participants.push(p);
  }

  findById(id: string): Participant | undefined {
    return this.participants.find(p => p.id === id);
  }

  allDead(): boolean {
    return this.participants.length > 0 && this.participants.every(p => p.isDead());
  }
}

// ── Encounter ─────────────────────────────────────────────────────────────────

/** The team every player character (and their allies/summons) is on. Every other team is a
 * creature side the LLM grouped at combat start (see assignCombatTeams) — any two different teams
 * are hostile to each other, players included. */
export const PLAYERS_TEAM_ID = 'players';
const DEFAULT_ENEMY_TEAM = { id: 'enemies', name: 'Enemies' };

export class Encounter {
  /** Unique per fight — a campaign can run several at once (split groups in different parts of a dungeon). */
  id: string;
  campaignId: string;
  teams: Team[] = [];
  turnOrder: Participant[] = [];
  rounds: Round[] = [];

  // ponytail: internal index tracked here so callers only call advanceTurn()
  private _turnIndex = 0;
  // Tracks how many participants are expected before combat can begin (players + enemies roll async)
  expectedParticipantCount = 0;

  // ── Per-fight runtime state (was per-campaign Maps in state.ts, back when a campaign had one fight) ──
  /** Set the instant the fight is decided (victory/defeat) — before its delayed teardown — so nothing acts in it any more. */
  ended = false;
  /** True once rollEnemyInitiatives has fired. */
  enemiesReady = false;
  /** When combat started, for nemesis transcript slicing. */
  startedAt = Date.now();
  /** charId → running kill/damage tally, flushed onto the character sheet once in endCombat. */
  scores = new Map<string, { enemiesKilled: number; damageDealt: number; damageReceived: number }>();
  /** casterId → the creature a concentration curse (Hunter's Mark, Hex) is locked on — see resolvePlayerCast. */
  marks = new Map<string, { targetId: string; targetName: string; spellName: string }>();
  /** One advanceTurn in flight at a time — see advanceTurn. */
  advancing = false;
  /** Players who belong to this fight but have no participant yet — claimed the instant a fight
   * starts (before initiative is rolled, so a racing second fight can't grab them too), or restored
   * off disk (player participants aren't serialized). fightOf treats them as members. */
  pendingPlayerNames: string[] = [];

  constructor(campaignId: string, id: string = randomUUID()) {
    this.campaignId = campaignId;
    this.id = id;
  }

  static empty(campaignId: string): Encounter {
    return new Encounter(campaignId);
  }

  // ── Team helpers ────────────────────────────────────────────────────────────

  /** Every non-player-side participant, across however many creature teams there are. */
  get enemies(): Participant[] {
    return this.teams.filter(t => t.id !== PLAYERS_TEAM_ID).flatMap(t => t.participants);
  }

  get players(): Participant[] {
    return this.teams.find(t => t.id === PLAYERS_TEAM_ID)?.participants ?? [];
  }

  /** Everyone in this fight on a different team from `p` — the only definition of "hostile". */
  hostilesOf(p: Participant): Participant[] {
    return this.teams.filter(t => t.id !== p.teamId).flatMap(t => t.participants);
  }

  addTeam(team: Team): void {
    this.teams.push(team);
  }

  /** Re-homes a participant onto `side` (LLM side assignment lands after they've already joined), dropping a team it empties. */
  moveToTeam(p: Participant, side: { id: string; name: string }): void {
    if (p.teamId === side.id) return;
    for (const t of this.teams) t.participants = t.participants.filter(x => x.id !== p.id);
    this.teams = this.teams.filter(t => t.participants.length || t.id === PLAYERS_TEAM_ID);
    this.team(side.id, side.name).addParticipant(p);
    p.teamId = side.id;
  }

  /** Finds the team by id, creating it (named `name`) on first use. */
  team(id: string, name: string): Team {
    let team = this.teams.find(t => t.id === id);
    if (!team) {
      team = new Team(id, name);
      this.addTeam(team);
    }
    return team;
  }

  /**
   * Adds a fresh creature to this fight on `team` (default: the generic enemies side). Rolls
   * initiative immediately (D20 + DEX mod) since every caller here is joining a fight already in
   * progress (dungeon proximity reinforcements, the Conjurer summon action) rather than the
   * enemies rolled at combat start. Bumps expectedParticipantCount so tryBeginCombat's readiness
   * gate still accounts for them. Previously this same six-line block was duplicated at every
   * call site in dungeon/runtime.ts — one copy here instead.
   */
  spawnEnemy(statBlock: EnemyStatBlock, team: { id: string; name: string } = DEFAULT_ENEMY_TEAM): Participant {
    const creature = Creature.from(statBlock);
    const participant = new Participant({
      id: creature.id,
      name: creature.name,
      initiative: new D20Roll().roll() + statMod(creature.stats.dex),
      isPlayer: false,
      teamId: team.id,
      creature,
    });
    this.team(team.id, team.name).addParticipant(participant);
    this.expectedParticipantCount += 1;
    return participant;
  }

  // ── Participant lookup ──────────────────────────────────────────────────────

  findParticipant(id: string): Participant | undefined {
    for (const team of this.teams) {
      const p = team.findById(id);
      if (p) return p;
    }
    // Also check by name (player participants are keyed by name in some paths) — on teams too, not
    // just the turn order: a joiner sits on a team ~500ms before their initiative lands (addToTurnOrder).
    return this.turnOrder.find(p => p.name === id || p.id === id)
      ?? this.teams.flatMap(t => t.participants).find(p => p.isPlayer && p.name === id);
  }

  findCreature(id: string): Creature | undefined {
    return this.findParticipant(id)?.creature;
  }

  // ── Turn order ──────────────────────────────────────────────────────────────

  addToTurnOrder(p: Participant): void {
    // Remember the current actor before mutating the order — sorting can shift indices
    const currentId = this.currentRound ? this.currentActor?.id : undefined;
    const currentName = this.currentRound ? this.currentActor?.name : undefined;

    const idx = this.turnOrder.findIndex(e => e.id === p.id);
    if (idx !== -1) {
      this.turnOrder[idx] = p;
    } else {
      this.turnOrder.push(p);
    }
    this.sortTurnOrder();

    // Re-anchor the turn index to the same actor after the sort
    if (currentId !== undefined) {
      const newIdx = this.turnOrder.findIndex(e => e.id === currentId);
      if (newIdx !== -1) {
        if (newIdx !== this._turnIndex) console.log(`[turn] re-anchor: ${currentName} ${this._turnIndex}→${newIdx} after adding ${p.name} order=[${this.turnOrder.map(e => e.name).join(',')}]`);
        this._turnIndex = newIdx;
      } else {
        console.log(`[turn] re-anchor MISS: could not find ${currentName} after adding ${p.name}`);
      }
    }
  }

  sortTurnOrder(): void {
    this.turnOrder.sort((a, b) => b.initiative - a.initiative);
  }

  // ── Round / turn advancement ────────────────────────────────────────────────

  get currentRound(): Round | undefined {
    return this.rounds[this.rounds.length - 1];
  }

  get currentTurn(): Turn | undefined {
    return this.currentRound?.currentTurn;
  }

  get currentActor(): Participant | undefined {
    if (!this.turnOrder.length) return undefined;
    return this.turnOrder[this._turnIndex % this.turnOrder.length];
  }

  startNextRound(): Round {
    const round = new Round(this.rounds.length + 1);
    this.rounds.push(round);
    return round;
  }

  /**
   * Advances to the next actor. Reports whether lapping the order started a new round —
   * the wrap is invisible from outside this class otherwise, and the runtime needs it to
   * fire the afterRound/beforeRound hook stages.
   */
  advanceTurn(): { roundStarted: boolean } {
    if (!this.turnOrder.length) return { roundStarted: false };
    this.currentTurn?.complete();
    this._turnIndex = (this._turnIndex + 1) % this.turnOrder.length;

    // Start a new round when we've lapped the order
    const roundStarted = this._turnIndex === 0;
    if (roundStarted) this.startNextRound();

    const actor = this.currentActor;
    if (actor) this.currentRound?.addTurn(actor);
    return { roundStarted };
  }

  beginCombat(): void {
    if (this.turnOrder.length) {
      this.startNextRound();
      const actor = this.currentActor;
      if (actor) this.currentRound?.addTurn(actor);
    }
  }

  removeFromTurnOrder(id: string): void {
    const deadIdx = this.turnOrder.findIndex(p => p.id === id);
    if (deadIdx === -1) return;
    if (deadIdx < this._turnIndex) {
      this._turnIndex = Math.max(0, this._turnIndex - 1);
    }
    this.turnOrder.splice(deadIdx, 1);
    if (this.turnOrder.length > 0) {
      this._turnIndex = this._turnIndex % this.turnOrder.length;
    }
  }

  // ── Victory / defeat ────────────────────────────────────────────────────────

  /** Victory: every creature on every non-player team is down (factions that fought each other count too). */
  allEnemiesDead(): boolean {
    const enemies = this.enemies;
    return enemies.length > 0 && enemies.every(p => p.isDead());
  }

  allPlayersDead(): boolean {
    const playerTeam = this.teams.find(t => t.id === PLAYERS_TEAM_ID);
    return (playerTeam?.participants.length ?? 0) > 0 && (playerTeam?.allDead() ?? false);
  }

  allPlayersDown(): boolean {
    const humanPlayers = this.players.filter(p => p.isPlayer);
    return humanPlayers.length > 0 && humanPlayers.every(p => p.isDown());
  }

  /**
   * Folds `other` into this fight (their combatants came within chain range of each other).
   * Its participants keep the initiative they already rolled and slot into this order; this
   * fight's round count and current actor carry on. Teams merge by id, so two fights' copies of
   * the same creature side (or the players) become one side.
   */
  absorb(other: Encounter): void {
    for (const t of other.teams) {
      const mine = this.team(t.id, t.name);
      for (const p of t.participants) if (!mine.findById(p.id)) mine.addParticipant(p);
    }
    for (const p of other.turnOrder) this.addToTurnOrder(p);
    this.expectedParticipantCount += other.expectedParticipantCount;
    for (const [k, v] of other.scores) this.scores.set(k, v);
    for (const [k, v] of other.marks) this.marks.set(k, v);
    this.pendingPlayerNames.push(...other.pendingPlayerNames);
    other.ended = true;
  }

  // ── Serialization ───────────────────────────────────────────────────────────

  toJSON(): object {
    return {
      id: this.id,
      campaignId: this.campaignId,
      playerNames: [...new Set([...this.players.filter(p => p.isPlayer).map(p => p.name), ...this.pendingPlayerNames])],
      teams: this.teams.filter(t => t.id !== PLAYERS_TEAM_ID).map(t => ({
        id: t.id,
        name: t.name,
        enemies: t.participants.filter(p => p.creature).map(p => p.creature!.toStatBlock()),
      })),
    };
  }

  static fromJSON(data: unknown): Encounter {
    // ponytail: handle legacy formats (plain EnemyStatBlock array; single-team { enemies })
    if (Array.isArray(data)) return Encounter.fromJSON({ enemies: data });
    const obj = data as {
      id?: string; campaignId?: string; playerNames?: string[]; enemies?: unknown[];
      teams?: { id: string; name: string; enemies: unknown[] }[];
    };
    const enc = new Encounter(obj.campaignId ?? '', obj.id);
    enc.pendingPlayerNames = obj.playerNames ?? [];
    const teams = obj.teams ?? [{ ...DEFAULT_ENEMY_TEAM, enemies: obj.enemies ?? [] }];
    for (const t of teams) {
      const team = enc.team(t.id, t.name);
      for (const raw of t.enemies) {
        const creature = Creature.from(raw as Parameters<typeof Creature.from>[0]);
        team.addParticipant(new Participant({ id: creature.id, name: creature.name, initiative: 0, isPlayer: false, teamId: t.id, creature }));
      }
    }
    return enc;
  }

  teardown(): void {
    this.teams = [];
    this.turnOrder = [];
    this.rounds = [];
    this._turnIndex = 0;
  }
}
