import { randomUUID } from 'node:crypto';
import { isGoalLocked, type Goal, type GoalTier } from 'shared';
import { io, playerSocketIds } from '../state.ts';
import { readGoals, writeGoals } from '../storage.ts';
import type { JoinContext } from './context.ts';

/**
 * Pure upsert, no I/O — matches an existing goal by id (scoped to this character's own player
 * goals, so one client can never touch another character's or an antagonist's goal by guessing an
 * id) or appends a new one. Editing the description clears any prior validationFeedback — the
 * next session-end review re-judges it fresh. failureConsequence is never player-settable here —
 * only the VDM writes it, at the moment a goal actually fails (see applyGoalReview). A locked goal
 * (isGoalLocked — already built into the world, failed, or succeeded) is a no-op: the client can't
 * edit it out from under a quest that now depends on its description. Exported for
 * rest.goals.selfcheck.ts.
 */
export function upsertPlayerGoal(
  goals: Goal[], characterId: string,
  input: { id?: string; tier: GoalTier; description: string },
): Goal[] {
  const existing = goals.find(g => g.id === input.id && g.ownerType === 'player' && g.ownerId === characterId);
  if (existing) {
    if (isGoalLocked(existing)) return goals;
    existing.tier = input.tier;
    existing.description = input.description;
    delete existing.validationFeedback;
    return goals;
  }
  return [...goals, {
    id: randomUUID(), ownerType: 'player', ownerId: characterId, tier: input.tier, description: input.description,
    status: 'active', milestones: [], createdAt: new Date().toISOString(),
  }];
}

/** Pure removal, no I/O — scoped the same way as upsertPlayerGoal. A locked goal (isGoalLocked) can't be removed. Returns the same array reference when nothing matched or the match is locked. */
export function removePlayerGoal(goals: Goal[], characterId: string, id: string): Goal[] {
  const goal = goals.find(g => g.id === id && g.ownerType === 'player' && g.ownerId === characterId);
  if (!goal || isGoalLocked(goal)) return goals;
  return goals.filter(g => g !== goal);
}

function playerGoalsFor(goals: Goal[], characterId: string): Goal[] {
  return goals.filter(g => g.ownerType === 'player' && g.ownerId === characterId);
}

export function registerGoalHandlers(ctx: JoinContext): void {
  const { socket, campaignId } = ctx;

  // Explicit save, not live-as-you-type — the character sheet holds edits in local draft state;
  // nothing reaches goals.json (and no other client can spoof it) until this fires.
  socket.on('goal:save', ({ characterId, id, tier, description }) => {
    void (async () => {
      const goals = upsertPlayerGoal(await readGoals(campaignId), characterId, {
        tier, description,
        ...(id !== undefined ? { id } : {}),
      });
      await writeGoals(campaignId, goals);
      const sid = playerSocketIds.get(characterId);
      if (sid) io.to(sid).emit('goals:update', { characterId, goals: playerGoalsFor(goals, characterId) });
    })();
  });

  socket.on('goal:delete', ({ characterId, id }) => {
    void (async () => {
      const goals = removePlayerGoal(await readGoals(campaignId), characterId, id);
      await writeGoals(campaignId, goals);
      const sid = playerSocketIds.get(characterId);
      if (sid) io.to(sid).emit('goals:update', { characterId, goals: playerGoalsFor(goals, characterId) });
    })();
  });

  // Loads this character's goals when their sheet is opened — no separate REST fetch, goals only exist in goals.json.
  socket.on('goals:fetch', ({ characterId }) => {
    void readGoals(campaignId).then(goals => {
      const sid = playerSocketIds.get(characterId);
      if (sid) io.to(sid).emit('goals:update', { characterId, goals: playerGoalsFor(goals, characterId) });
    });
  });
}
