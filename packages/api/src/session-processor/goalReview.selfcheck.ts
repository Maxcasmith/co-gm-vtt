// Regression check for applyGoalReview — the pure branching behind the session-end goal review
// pass (vague-flagging, failure adjudication, quest generation from goal ids). No LLM/storage I/O
// here by design. Run with `tsx src/session-processor/goalReview.selfcheck.ts` from packages/api.
import type { Goal } from 'shared';
import { applyGoalReview, type GoalReviewResult } from './index.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1', ownerType: 'player', ownerId: 'char-1', tier: 'mid',
    description: 'Find the missing key', status: 'active', milestones: [],
    createdAt: new Date().toISOString(), ...overrides,
  };
}

function main() {
  // --- a goal flagged vague gets validationFeedback set, stays active ---
  {
    const goals = [makeGoal()];
    const result: GoalReviewResult = { goalUpdates: [{ goalId: 'goal-1', action: 'vague', feedback: 'Say which key and where.' }], quests: [] };
    const { goals: updated, newQuests } = applyGoalReview(goals, result);
    assert(updated[0]!.validationFeedback === 'Say which key and where.', 'vague action should set validationFeedback');
    assert(updated[0]!.status === 'active', 'a vague goal should remain active, not fail');
    assert(newQuests.length === 0, 'no quests expected in this case');
  }

  // --- a goal marked failed flips status and stamps failedAt, not retryable ---
  {
    const goals = [makeGoal()];
    const { goals: updated } = applyGoalReview(goals, { goalUpdates: [{ goalId: 'goal-1', action: 'failed' }], quests: [] });
    assert(updated[0]!.status === 'failed', 'failed action should flip status to failed');
    assert(typeof updated[0]!.failedAt === 'string', 'failed action should stamp failedAt');
  }

  // --- an already-failed goal can't be re-failed/re-stamped (not retryable) ---
  {
    const goals = [makeGoal({ status: 'failed', failedAt: '2020-01-01T00:00:00.000Z' })];
    const { goals: updated } = applyGoalReview(goals, { goalUpdates: [{ goalId: 'goal-1', action: 'failed' }], quests: [] });
    assert(updated[0]!.failedAt === '2020-01-01T00:00:00.000Z', 'an already-failed goal\'s failedAt should not be overwritten');
  }

  // --- an update naming an unknown/hallucinated goal id is ignored, not thrown ---
  {
    const goals = [makeGoal()];
    const { goals: updated } = applyGoalReview(goals, { goalUpdates: [{ goalId: 'does-not-exist', action: 'failed' }], quests: [] });
    assert(updated[0]!.status === 'active', 'an unknown goal id in goalUpdates should be a no-op');
  }

  // --- a well-formed quest naming real goal ids is kept, tagged with relatedGoalId ---
  {
    const goals = [makeGoal({ id: 'goal-1' }), makeGoal({ id: 'goal-2', ownerId: 'char-2' })];
    const result: GoalReviewResult = {
      goalUpdates: [],
      quests: [{ goalIds: ['goal-1', 'goal-2'], name: 'The Terror over Elfheim', description: 'A dragon cult stirs.', relatedNpc: 'Timmy the town crier', relatedLocation: 'Town square' }],
    };
    const { goals: updated, newQuests } = applyGoalReview(goals, result);
    assert(newQuests.length === 1, 'a well-formed quest should be created');
    const q = newQuests[0]!;
    assert(q.status === 'open' && q.name === 'The Terror over Elfheim', 'quest should start open with the given name');
    assert(q.relatedGoalId?.length === 2, 'quest should carry both goal ids it serves');
    assert(q.relatedNpc === 'Timmy the town crier' && q.relatedLocation === 'Town square', 'quest should carry the optional NPC/location fields');
    assert(updated.every(g => g.builtIntoWorld === true), 'every goal a real quest was generated from should be marked builtIntoWorld, locking it from further player edits');
  }

  // --- a quest naming a nonexistent goal id is dropped, not written as an orphan ---
  {
    const goals = [makeGoal()];
    const { newQuests } = applyGoalReview(goals, { goalUpdates: [], quests: [{ goalIds: ['ghost-goal'], name: 'Orphan Quest', description: 'x' }] });
    assert(newQuests.length === 0, 'a quest referencing no real goal id should be dropped');
  }

  // --- a quest naming an antagonist (non-player) goal id is also dropped ---
  {
    const goals = [makeGoal({ id: 'bbeg-goal', ownerType: 'bbeg', ownerId: 'actor-1' })];
    const { newQuests } = applyGoalReview(goals, { goalUpdates: [], quests: [{ goalIds: ['bbeg-goal'], name: 'x', description: 'x' }] });
    assert(newQuests.length === 0, 'a quest can only be tied to player goals from this pass, not antagonist goals');
  }
}

main();
console.log('goalReview selfcheck: OK — vague-flagging, one-way failure, unknown-id safety, and quest goalId scoping all behave.');
