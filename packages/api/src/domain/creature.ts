import type { EnemyStatBlock, CharacterStats, CreatureType, ActiveCondition, EnemyRole, EnemyAction } from 'shared';

export class Creature {
  id: string;
  name: string;
  cr: number;
  hp: number;
  currentHp: number;
  ac: number;
  speed: number;
  stats: CharacterStats;
  attacks: { name: string; bonus: number; damage: string }[];
  effects: string[];
  creatureType: CreatureType;
  conditions: ActiveCondition[];
  damageResistances: string[];
  damageVulnerabilities: string[];
  damageImmunities: string[];
  // Tactical-AI role + non-melee actions — see combat/ai/. Old saved encounters/nemeses predate
  // these and fall back to plain melee-only behavior (role undefined), same convention creatureType
  // already used before it was ubiquitous.
  role: EnemyRole | undefined;
  actions: EnemyAction[];
  /** Combat round this creature last took damage — Conjurer's summon action reads (currentRound - lastDamagedRound) to decide it's "unchallenged." Set at combat start and on every hit, see applyDamageToCreature. */
  lastDamagedRound: number;
  appearance: string | undefined;
  portraitSrc: string | undefined;

  constructor(data: EnemyStatBlock) {
    this.id = data.id;
    this.name = data.name;
    this.cr = data.cr;
    this.hp = data.hp;
    this.currentHp = data.hp;
    this.ac = data.ac;
    this.speed = data.speed;
    this.stats = data.stats;
    this.attacks = data.attacks;
    this.effects = [];
    // Old saved encounters predate creatureType — fall back to Humanoid rather than backfilling.
    this.creatureType = data.creatureType ?? 'Humanoid';
    this.conditions = data.conditions ?? [];
    this.damageResistances = data.damageResistances ?? [];
    this.damageVulnerabilities = data.damageVulnerabilities ?? [];
    this.damageImmunities = data.damageImmunities ?? [];
    this.role = data.role;
    this.actions = data.actions ?? [];
    this.lastDamagedRound = 0;
    this.appearance = data.appearance;
    this.portraitSrc = data.portraitSrc;
  }

  static from(data: EnemyStatBlock): Creature {
    return new Creature(data);
  }

  takeDamage(amount: number): void {
    this.currentHp = Math.max(0, this.currentHp - amount);
    if (this.currentHp <= 0) this.addEffect('Dead');
  }

  heal(amount: number): void {
    this.currentHp = Math.min(this.hp, this.currentHp + amount);
  }

  addEffect(effect: string): void {
    if (!this.effects.includes(effect)) this.effects.push(effect);
  }

  isDead(): boolean {
    return this.effects.includes('Dead');
  }

  toStatBlock(): EnemyStatBlock {
    return {
      id: this.id,
      name: this.name,
      cr: this.cr,
      hp: this.hp,
      ac: this.ac,
      speed: this.speed,
      stats: this.stats,
      attacks: this.attacks,
      creatureType: this.creatureType,
      conditions: this.conditions,
      damageResistances: this.damageResistances,
      damageVulnerabilities: this.damageVulnerabilities,
      damageImmunities: this.damageImmunities,
      ...(this.role !== undefined ? { role: this.role } : {}),
      actions: this.actions,
      ...(this.appearance !== undefined ? { appearance: this.appearance } : {}),
      ...(this.portraitSrc !== undefined ? { portraitSrc: this.portraitSrc } : {}),
    };
  }
}
