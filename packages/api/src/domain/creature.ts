import type { EnemyStatBlock, CharacterStats, CreatureType } from 'shared';

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
    };
  }
}
