// Multi-fight + multi-team invariants — `tsx src/domain/encounter.fights.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import type { EnemyStatBlock } from 'shared';
import { Encounter, Participant, PLAYERS_TEAM_ID } from './encounter.ts';
import { registerFight, fightOf, fightsIn, unregisterFight } from '../state.ts';

const sb = (id: string, name: string): EnemyStatBlock => ({
  id, name, cr: 1, hp: 10, ac: 12, speed: 30, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, attacks: [],
} as unknown as EnemyStatBlock);
const player = (name: string) => new Participant({ id: `id-${name}`, name, initiative: 10, isPlayer: true, teamId: PLAYERS_TEAM_ID, currentHp: 10, maxHp: 10 });

const CID = '__selfcheck-fights__';
const a = Encounter.empty(CID);
const b = Encounter.empty(CID);
registerFight(CID, a);
registerFight(CID, b);

// Two fights, each player/creature in exactly one.
a.team(PLAYERS_TEAM_ID, 'Players').addParticipant(player('Aria'));
const thief = a.spawnEnemy(sb('t1', 'Thief'), { id: 'thieves', name: "Thieves' Guild" });
const watch = a.spawnEnemy(sb('w1', 'Watchman'), { id: 'watch', name: 'The Watch' });
b.pendingPlayerNames.push('Bex'); // claimed before initiative
b.spawnEnemy(sb('r1', 'Rat'));
assert.equal(fightOf(CID, 'Aria'), a);
assert.equal(fightOf(CID, 'Bex'), b);
assert.equal(fightOf(CID, 'w1'), a);
assert.equal(fightOf(CID, 'nobody'), undefined);

// Different sides are hostile to each other and to the party; same side isn't.
assert.deepEqual(a.hostilesOf(thief).map(p => p.name).sort(), ['Aria', 'Watchman']);
assert.ok(!a.hostilesOf(watch).includes(watch));

// LLM side assignment re-homes a participant and drops the side it empties.
a.moveToTeam(watch, { id: 'thieves', name: "Thieves' Guild" });
assert.ok(!a.teams.some(t => t.id === 'watch'));
assert.deepEqual(a.hostilesOf(thief).map(p => p.name), ['Aria']);

// Victory needs every non-player side down, not just one of them.
thief.creature!.takeDamage(99);
assert.equal(a.allEnemiesDead(), false);
watch.creature!.takeDamage(99);
assert.equal(a.allEnemiesDead(), true);

// Merge: the older fight absorbs the other; the absorbed one stops counting as live.
a.absorb(b);
unregisterFight(CID, b);
assert.equal(b.ended, true);
assert.deepEqual(fightsIn(CID), [a]);
assert.equal(fightOf(CID, 'Bex'), a);
assert.equal(fightOf(CID, 'r1'), a);

// A decided (ended) fight no longer claims anyone.
a.ended = true;
assert.equal(fightOf(CID, 'Aria'), undefined);

console.log('encounter fights selfcheck OK');
