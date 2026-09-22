import assert from 'node:assert';
import type { EnemyStatBlock } from 'shared';
import { Creature } from './creature.ts';

// Run: npx tsx packages/api/src/domain/creature.selfcheck.ts
const base = {
  id: 'c1', name: 'Assimilated Crewman', cr: 0.25, hp: 11, ac: 12, speed: 30,
  stats: { str: 14, dex: 10, con: 12, int: 6, wis: 10, cha: 6 },
} as const;

// The crash case: an LLM stat block that came back with no attacks key at all.
const { attacks: _drop, ...noAttacks } = { ...base, attacks: [] };
const repaired = Creature.from(noAttacks as unknown as EnemyStatBlock);
assert.equal(repaired.attacks.length, 1);
assert.deepEqual(repaired.attacks[0], { name: 'Strike', bonus: 4, damage: '1d6+2' });

// Negative STR still formats as a legal dice expression.
const weak = Creature.from({ ...base, stats: { ...base.stats, str: 6 } } as unknown as EnemyStatBlock);
assert.equal(weak.attacks[0]!.damage, '1d6-2');

// An explicit empty attacks[] is a deliberate choice — left alone.
assert.deepEqual(Creature.from({ ...base, attacks: [] }).attacks, []);

console.log('creature selfcheck OK');
