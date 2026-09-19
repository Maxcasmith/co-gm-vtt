// Regression check for advanceWorldActorGoals — the pure milestone/day-threshold logic
// extracted from tickWorldForRest during the antagonist-goal/player-goal unification (goals now
// live in a shared Goal record, not inline on WorldActor). No LLM/storage I/O here by design, so
// this runs instantly with no network/API key required. Run with `tsx src/socketHandlers/rest.advanceWorldActorGoals.selfcheck.ts` from packages/api.
import type { WorldActor, Goal } from 'shared';
import { advanceWorldActorGoals } from './rest.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1', ownerType: 'bbeg', ownerId: 'actor-1', tier: 'long',
    description: 'Destroy the kingdom', status: 'active',
    milestones: [
      { id: 'm1', description: 'Raise an army', completed: false, day: 7 },
      { id: 'm2', description: 'March on the capital', completed: false, day: 14 },
    ],
    totalDays: 21, daysElapsed: 0, createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeActor(overrides: Partial<WorldActor> = {}): WorldActor {
  return { id: 'actor-1', name: 'The Warlord', type: 'bbeg', goalId: 'goal-1', currentStatus: 'Gathering forces.', status: 'active', ...overrides };
}

function main() {
  // --- a rest crossing one milestone's day threshold completes it and updates currentStatus ---
  {
    const goal = makeGoal();
    const actor = makeActor();
    const completed = advanceWorldActorGoals([actor], [goal], 24 * 8); // 8 days pass
    assert(goal.daysElapsed === 8, `expected daysElapsed=8, got ${goal.daysElapsed}`);
    assert(goal.milestones[0]!.completed, 'first milestone (day 7) should be completed after 8 days');
    assert(goal.milestones[0]!.completedOnDay === 8, `expected completedOnDay=8, got ${goal.milestones[0]!.completedOnDay}`);
    assert(!goal.milestones[1]!.completed, 'second milestone (day 14) should not be completed yet');
    assert(completed.length === 1 && completed[0]!.includes('Raise an army'), 'newlyCompleted should report the crossed milestone');
    assert(actor.currentStatus === 'Working toward: March on the capital', `unexpected currentStatus: ${actor.currentStatus}`);
    assert(actor.status === 'active', 'actor should still be active with a milestone remaining');
  }

  // --- a single big rest crossing multiple milestones + totalDays succeeds the actor ---
  {
    const goal = makeGoal();
    const actor = makeActor();
    const completed = advanceWorldActorGoals([actor], [goal], 24 * 25); // 25 days in one jump
    assert(goal.milestones.every(m => m.completed), 'all milestones should be completed after 25 days');
    assert(actor.status === 'succeeded', `expected actor.status=succeeded, got ${actor.status}`);
    assert(goal.status === 'succeeded', `expected goal.status=succeeded, got ${goal.status}`);
    assert(completed.some(c => c.includes('HAS SUCCEEDED')), 'newlyCompleted should include the succeeded warning');
    assert(actor.currentStatus.includes('Destroy the kingdom'), 'currentStatus should reference the achieved goal');
  }

  // --- an inactive actor is skipped entirely, no mutation ---
  {
    const goal = makeGoal();
    const actor = makeActor({ status: 'defeated' });
    const completed = advanceWorldActorGoals([actor], [goal], 24 * 30);
    assert(goal.daysElapsed === 0, 'a defeated actor\'s goal should not accumulate days');
    assert(completed.length === 0, 'a defeated actor should never produce newlyCompleted entries');
  }

  // --- an actor whose goalId doesn't resolve is skipped without throwing ---
  {
    const actor = makeActor({ goalId: 'missing-goal' });
    const completed = advanceWorldActorGoals([actor], [], 24 * 5);
    assert(completed.length === 0, 'an actor with no matching goal should be skipped silently');
  }
}

main();
console.log('advanceWorldActorGoals selfcheck: OK — milestone completion, succeeded flip, inactive/missing-goal skips all behave.');
