// Regression check for upsertPlayerGoal/removePlayerGoal — the pure logic behind the goal:save/
// goal:delete socket handlers. No I/O, no socket harness needed. Run with
// `tsx src/socketHandlers/goals.selfcheck.ts` from packages/api.
import type { Goal } from 'shared';
import { upsertPlayerGoal, removePlayerGoal } from './goals.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  // --- creating a new goal (no id) appends, ownership stamped from characterId not the caller ---
  let goals: Goal[] = [];
  goals = upsertPlayerGoal(goals, 'char-1', { tier: 'short', description: 'Find the missing key' });
  assert(goals.length === 1, 'first save should create one goal');
  const created = goals[0]!;
  assert(created.ownerType === 'player' && created.ownerId === 'char-1', 'new goal should be owned by the saving character');
  assert(created.status === 'active' && created.milestones.length === 0, 'a fresh short-term goal starts active with no milestones');

  // --- saving again with the same id updates in place, doesn't duplicate ---
  goals = upsertPlayerGoal(goals, 'char-1', { id: created.id, tier: 'mid', description: 'Find the missing key and return it' });
  assert(goals.length === 1, 'saving with a matching id should update, not duplicate');
  assert(goals[0]!.tier === 'mid' && goals[0]!.description === 'Find the missing key and return it', 'update should overwrite tier/description');
  assert(goals[0]!.failureConsequence === undefined, 'a player save can never set failureConsequence — only the VDM writes it, at failure time');

  // --- editing a goal clears prior AI validationFeedback so the next review re-judges it ---
  goals[0]!.validationFeedback = 'Too vague — what does "return it" mean concretely?';
  goals = upsertPlayerGoal(goals, 'char-1', { id: created.id, tier: 'mid', description: 'Return the key to the Vesper Hollow archivist' });
  assert(goals[0]!.validationFeedback === undefined, 'editing a goal should clear stale validationFeedback');

  // --- a second character can't overwrite the first's goal by guessing its id ---
  goals = upsertPlayerGoal(goals, 'char-2', { id: created.id, tier: 'long', description: 'Hijack char-1\'s goal' });
  assert(goals.length === 2, 'a mismatched owner should create a new goal, never hijack an existing one');
  assert(goals.find(g => g.id === created.id)!.ownerId === 'char-1', 'the original goal must remain owned by char-1, untouched');

  // --- deleting scoped to (id, characterId) — wrong owner is a no-op, right owner removes ---
  const beforeWrongOwner = goals.length;
  goals = removePlayerGoal(goals, 'char-2', created.id); // char-2 doesn't own char-1's goal
  assert(goals.length === beforeWrongOwner, 'deleting with the wrong owner should be a no-op');

  goals = removePlayerGoal(goals, 'char-1', created.id);
  assert(!goals.some(g => g.id === created.id), 'deleting with the correct owner should remove the goal');

  // --- a goal already built into the world by the VDM can't be edited or removed ---
  {
    let locked: Goal[] = [{
      id: 'locked-1', ownerType: 'player', ownerId: 'char-1', tier: 'mid', description: 'Original wording',
      status: 'active', milestones: [], createdAt: new Date().toISOString(), builtIntoWorld: true,
    }];
    locked = upsertPlayerGoal(locked, 'char-1', { id: 'locked-1', tier: 'long', description: 'Retconned wording' });
    assert(locked[0]!.description === 'Original wording' && locked[0]!.tier === 'mid', 'editing a builtIntoWorld goal should be a no-op');
    locked = removePlayerGoal(locked, 'char-1', 'locked-1');
    assert(locked.length === 1, 'removing a builtIntoWorld goal should be a no-op');
  }

  // --- a failed (or succeeded) goal is also locked, even without builtIntoWorld ---
  {
    let failedGoal: Goal[] = [{
      id: 'failed-1', ownerType: 'player', ownerId: 'char-1', tier: 'short', description: 'Original wording',
      status: 'failed', failedAt: new Date().toISOString(), milestones: [], createdAt: new Date().toISOString(),
    }];
    failedGoal = upsertPlayerGoal(failedGoal, 'char-1', { id: 'failed-1', tier: 'short', description: 'Try to edit anyway' });
    assert(failedGoal[0]!.description === 'Original wording', 'editing a failed goal should be a no-op, it is not retryable');
    failedGoal = removePlayerGoal(failedGoal, 'char-1', 'failed-1');
    assert(failedGoal.length === 1, 'removing a failed goal should be a no-op');
  }
}

main();
console.log('goals selfcheck: OK — upsert create/update, ownership scoping, stale-feedback clearing, and scoped delete all behave.');
