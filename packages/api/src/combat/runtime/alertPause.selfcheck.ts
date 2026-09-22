// Origin feat Alert's post-initiative pause (lifecycle.ts beginAlertPause/resolveAlertPause).
//   LLM_STUB=1 npx tsx src/combat/runtime/alertPause.selfcheck.ts   (from packages/api)
// Writes a throwaway campaign and deletes it afterwards, pass or fail.
import assert from 'node:assert';
import type { Character, WorldMeta } from 'shared';
import { DEFAULT_HOUSE_RULES } from 'shared';
import { deleteCampaign, writeCharacter, writeWorldMeta } from '../../storage.ts';
import { connected } from '../../state.ts';
import { Encounter, Participant, PLAYERS_TEAM_ID } from '../../domain/encounter.ts';
import { Creature } from '../../domain/creature.ts';
import { tryBeginCombat, resolveAlertPause } from './lifecycle.ts';

const SLUG = '__selfcheck-alert-pause__';

function character(name: string, background: string): Character {
  return {
    id: `fixture-${name}`, campaignId: SLUG, name, species: 'Dwarf', background, class: 'Fighter', level: 3,
    stats: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, skillProficiencies: [],
    password: 'x', portraitPath: '', tokenPath: '', createdAt: new Date().toISOString(),
    currentHp: 30, maxHp: 30, xp: 0, inventory: [],
  } as unknown as Character; // fixture: only the fields hasOriginFeat/getCharacter read are real
}

/** Names in `inits` are connected players; `allies` are ally creatures on the players' side. */
function fight(inits: Record<string, number>, allies: Record<string, number> = {}): Encounter {
  const enc = new Encounter(SLUG);
  const team = enc.team(PLAYERS_TEAM_ID, 'Players');
  const add = (p: Participant) => { team.addParticipant(p); enc.addToTurnOrder(p); };
  for (const [name, initiative] of Object.entries(inits)) {
    add(new Participant({ id: `fixture-${name}`, name, initiative, isPlayer: true, teamId: PLAYERS_TEAM_ID, currentHp: 30, maxHp: 30 }));
    connected.add(name);
  }
  for (const [name, initiative] of Object.entries(allies)) {
    const creature = Creature.from({ id: `ally-${name}`, name, cr: 1, hp: 20, ac: 12, speed: 30, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, attacks: [] });
    add(new Participant({ id: creature.id, name, initiative, isPlayer: false, teamId: PLAYERS_TEAM_ID, creature }));
  }
  enc.expectedParticipantCount = enc.turnOrder.length;
  enc.enemiesReady = true;
  return enc;
}

const settle = () => new Promise(r => setTimeout(r, 200));

async function main(): Promise<void> {
  // Guard → Alert; Soldier → Savage Attacker.
  await writeCharacter(SLUG, 'fixture-Aria', character('Aria', 'Guard'));
  await writeCharacter(SLUG, 'fixture-Bex', character('Bex', 'Soldier'));

  // No Alert player: round 1 starts straight away.
  const plain = fight({ Bex: 12 });
  tryBeginCombat(SLUG, plain);
  await settle();
  assert.equal(plain.alertPauseState, 'done');
  assert.ok(plain.currentRound, 'fight without Alert players must start');
  plain.ended = true;

  // Alert player present: round 1 held until they resolve; the timer is on by default.
  const held = fight({ Aria: 5, Bex: 18 });
  tryBeginCombat(SLUG, held);
  tryBeginCombat(SLUG, held); // staggered callbacks must not start it twice
  await settle();
  assert.equal(held.alertPauseState, 'active');
  assert.deepEqual([...held.alertPauseIds], ['fixture-Aria']);
  assert.ok(held.alertPauseTimers.has('fixture-Aria'), 'default house rules time the swap');
  assert.equal(held.currentRound, undefined, 'round 1 must wait for the Alert player');

  resolveAlertPause(SLUG, held, 'fixture-Bex', null); // not pending — ignored
  assert.equal(held.alertPauseState, 'active');

  resolveAlertPause(SLUG, held, 'fixture-Aria', 'fixture-Bex');
  assert.equal(held.findParticipant('fixture-Aria')?.initiative, 18);
  assert.equal(held.findParticipant('fixture-Bex')?.initiative, 5);
  assert.equal(held.turnOrder[0]?.name, 'Aria', 'turn order re-sorted after the swap');
  assert.equal(held.findParticipant('fixture-Aria')?.alertSwapUsed, true);
  assert.equal(held.alertPauseState, 'done');
  assert.ok(held.currentRound, 'last resolution starts round 1');
  held.ended = true;

  // Cancel (null): no change, still starts.
  const cancelled = fight({ Aria: 5, Bex: 18 });
  tryBeginCombat(SLUG, cancelled);
  await settle();
  resolveAlertPause(SLUG, cancelled, 'fixture-Aria', null);
  assert.equal(cancelled.findParticipant('fixture-Aria')?.initiative, 5);
  assert.ok(cancelled.currentRound);
  cancelled.ended = true;

  // Lone Alert player with nobody on their side: no pause.
  connected.delete('Bex');
  const alone = fight({ Aria: 5 });
  tryBeginCombat(SLUG, alone);
  await settle();
  assert.ok(alone.currentRound, 'solo Alert player must not be paused');
  alone.ended = true;

  // Timer house rule off: no auto-cancel. An ally creature is a valid swap target.
  await writeWorldMeta(SLUG, {
    id: SLUG, name: 'selfcheck', campaignDir: SLUG, type: 'campaign',
    houseRules: { ...DEFAULT_HOUSE_RULES, alertSwapTimerEnabled: false },
  } as WorldMeta);
  const withAlly = fight({ Aria: 5 }, { Wolf: 16 });
  tryBeginCombat(SLUG, withAlly);
  await settle();
  assert.equal(withAlly.alertPauseState, 'active', 'an ally alone is enough to swap with');
  assert.equal(withAlly.alertPauseTimers.size, 0, 'timer off: no auto-cancel');
  resolveAlertPause(SLUG, withAlly, 'fixture-Aria', 'ally-Wolf');
  assert.equal(withAlly.findParticipant('fixture-Aria')?.initiative, 16);
  assert.equal(withAlly.findParticipant('ally-Wolf')?.initiative, 5);
  assert.ok(withAlly.currentRound);
  withAlly.ended = true;

  console.log('alertPause selfcheck: ok');
}

main()
  .finally(() => deleteCampaign(SLUG))
  .then(() => process.exit(0), err => { console.error(err); process.exit(1); });
