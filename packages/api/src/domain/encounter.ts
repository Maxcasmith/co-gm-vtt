import type { TurnOrderEntry } from 'shared';
import { Creature } from './creature.ts';

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
  creature?: Creature;

  // Player-only HP tracking
  currentHp: number;
  maxHp: number;

  deathSaves: { successes: number; failures: number; stable: boolean } = {
    successes: 0,
    failures: 0,
    stable: false,
  };

  constructor(props: {
    id: string;
    name: string;
    initiative: number;
    isPlayer: boolean;
    creature?: Creature;
    currentHp?: number;
    maxHp?: number;
  }) {
    this.id = props.id;
    this.name = props.name;
    this.initiative = props.initiative;
    this.isPlayer = props.isPlayer;
    if (props.creature !== undefined) this.creature = props.creature;
    this.currentHp = props.currentHp ?? (props.creature?.currentHp ?? 0);
    this.maxHp = props.maxHp ?? (props.creature?.hp ?? 0);
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
    this.currentHp = Math.max(0, this.currentHp - amount);
  }

  heal(amount: number): void {
    if (!this.isPlayer) {
      this.creature?.heal(amount);
      return;
    }
    this.currentHp = Math.min(this.maxHp, this.currentHp + amount);
  }

  toTurnOrderEntry(): TurnOrderEntry {
    return {
      id: this.id,
      name: this.name,
      initiative: this.initiative,
      isPlayer: this.isPlayer,
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

export class Encounter {
  campaignId: string;
  teams: Team[] = [];
  turnOrder: Participant[] = [];
  rounds: Round[] = [];

  // ponytail: internal index tracked here so callers only call advanceTurn()
  private _turnIndex = 0;
  // Tracks how many participants are expected before combat can begin (players + enemies roll async)
  expectedParticipantCount = 0;

  constructor(campaignId: string) {
    this.campaignId = campaignId;
  }

  static empty(campaignId: string): Encounter {
    return new Encounter(campaignId);
  }

  // ── Team helpers ────────────────────────────────────────────────────────────

  get enemies(): Participant[] {
    return this.teams.find(t => t.name === 'Enemies')?.participants ?? [];
  }

  get players(): Participant[] {
    return this.teams.find(t => t.name === 'Players')?.participants ?? [];
  }

  addTeam(team: Team): void {
    this.teams.push(team);
  }

  // ── Participant lookup ──────────────────────────────────────────────────────

  findParticipant(id: string): Participant | undefined {
    for (const team of this.teams) {
      const p = team.findById(id);
      if (p) return p;
    }
    // Also check by name (player participants are keyed by name in some paths)
    return this.turnOrder.find(p => p.name === id || p.id === id);
  }

  findCreature(id: string): Creature | undefined {
    return this.findParticipant(id)?.creature;
  }

  // ── Turn order ──────────────────────────────────────────────────────────────

  addToTurnOrder(p: Participant): void {
    // Upsert: replace if already present (re-roll case)
    const idx = this.turnOrder.findIndex(e => e.id === p.id);
    if (idx !== -1) {
      this.turnOrder[idx] = p;
    } else {
      this.turnOrder.push(p);
    }
    this.sortTurnOrder();
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

  advanceTurn(): void {
    if (!this.turnOrder.length) return;
    this.currentTurn?.complete();
    this._turnIndex = (this._turnIndex + 1) % this.turnOrder.length;

    // Start a new round when we've lapped the order
    if (this._turnIndex === 0) this.startNextRound();

    const actor = this.currentActor;
    if (actor) this.currentRound?.addTurn(actor);
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

  allEnemiesDead(): boolean {
    const enemyTeam = this.teams.find(t => t.name === 'Enemies');
    return (enemyTeam?.participants.length ?? 0) > 0 && (enemyTeam?.allDead() ?? false);
  }

  allPlayersDead(): boolean {
    const playerTeam = this.teams.find(t => t.name === 'Players');
    return (playerTeam?.participants.length ?? 0) > 0 && (playerTeam?.allDead() ?? false);
  }

  // ── Serialization ───────────────────────────────────────────────────────────

  toJSON(): object {
    return {
      campaignId: this.campaignId,
      enemies: this.enemies
        .filter(p => p.creature)
        .map(p => p.creature!.toStatBlock()),
    };
  }

  static fromJSON(data: unknown): Encounter {
    // ponytail: handle legacy format (plain EnemyStatBlock array)
    if (Array.isArray(data)) return Encounter.fromJSON({ enemies: data });
    const obj = data as { campaignId?: string; enemies?: unknown[] };
    const enc = new Encounter(obj.campaignId ?? '');
    const enemyTeam = new Team('enemies', 'Enemies');
    enc.addTeam(enemyTeam);

    if (Array.isArray(obj.enemies)) {
      for (const raw of obj.enemies) {
        const statBlock = raw as Parameters<typeof Creature.from>[0];
        const creature = Creature.from(statBlock);
        const p = new Participant({
          id: creature.id,
          name: creature.name,
          initiative: 0,
          isPlayer: false,
          creature,
        });
        enemyTeam.addParticipant(p);
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
