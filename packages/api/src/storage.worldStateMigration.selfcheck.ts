// Regression check for readWorldState's legacy-actor migration (storage.ts) — an old-shape
// world-state.json (goal/milestones embedded directly on WorldActor) must be split into a Goal
// record in goals.json plus a slim WorldActor, transparently, on first read. No test framework in
// this repo — run with `tsx src/storage.worldStateMigration.selfcheck.ts` from packages/api.
import { deleteCampaign, writeCampaignFile, readWorldState, readGoals } from './storage.ts';

const SLUG = '__selfcheck-world-migration__';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const legacyState = {
  dayNumber: 5, totalHoursElapsed: 96,
  actors: [
    {
      id: 'actor-1', name: 'The Warlord', type: 'bbeg',
      ultimateGoal: 'Destroy the kingdom', totalDays: 30, daysElapsed: 4,
      milestones: [
        { day: 7, description: 'Raise an army', completed: false },
        { day: 14, description: 'March on the capital', completed: false },
      ],
      currentStatus: 'Gathering forces.', status: 'active',
    },
  ],
};

async function main() {
  await deleteCampaign(SLUG); // idempotent: wipe any leftovers from a previous failed run

  await writeCampaignFile(SLUG, 'world-state.json', JSON.stringify(legacyState, null, 2));

  const state = await readWorldState(SLUG);
  assert(state !== null, 'migrated world state should still read back non-null');
  const actor = state!.actors[0]!;
  assert('ultimateGoal' in actor === false, 'migrated actor should no longer carry ultimateGoal inline');
  assert('milestones' in actor === false, 'migrated actor should no longer carry milestones inline');
  assert(typeof (actor as unknown as { goalId?: string }).goalId === 'string', 'migrated actor should have a goalId reference');

  const goals = await readGoals(SLUG);
  assert(goals.length === 1, `expected exactly one migrated goal, got ${goals.length}`);
  const goal = goals[0]!;
  assert(goal.id === (actor as unknown as { goalId: string }).goalId, 'actor.goalId should point at the migrated goal');
  assert(goal.description === 'Destroy the kingdom', `expected migrated description, got "${goal.description}"`);
  assert(goal.milestones.length === 2 && goal.milestones[0]!.day === 7, 'migrated goal should carry both milestones with their day thresholds');
  assert(goal.totalDays === 30 && goal.daysElapsed === 4, 'migrated goal should carry totalDays/daysElapsed from the legacy actor');
  assert(goal.ownerType === 'bbeg' && goal.ownerId === 'actor-1', 'migrated goal ownership should point back at the actor');

  // Reading again must not duplicate the goal (already-slim actor, nothing left to migrate).
  const state2 = await readWorldState(SLUG);
  const goals2 = await readGoals(SLUG);
  assert(state2!.actors[0]!.goalId === actor.goalId, 'second read should be stable, same goalId');
  assert(goals2.length === 1, `second read should not duplicate goals, got ${goals2.length}`);
}

main()
  .then(() => console.log('world-state migration selfcheck: OK — legacy actor splits into a Goal + slim WorldActor, idempotently.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => deleteCampaign(SLUG))
  .finally(() => process.exit(process.exitCode ?? 0));
