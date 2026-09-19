export type GoalTier = "short" | "mid" | "long";
export type GoalOwnerType = "player" | "bbeg" | "faction";
export type GoalStatus = "active" | "succeeded" | "failed";

export interface GoalMilestone {
  id: string;
  description: string;
  completed: boolean;
  completedOnDay?: number;
  /** Rest-driven (bbeg/faction) goals only — the actor's daysElapsed threshold that completes this milestone. Player-advanced goals leave this unset; the player/VDM marks `completed` directly instead. */
  day?: number;
}

export interface Goal {
  id: string;
  ownerType: GoalOwnerType;
  /** characterId for player goals, WorldActor.id for bbeg/faction goals. */
  ownerId: string;
  tier: GoalTier;
  description: string;
  status: GoalStatus;
  /** Set by the VDM (session-end goal review), not the player, at the moment a goal fails — what concretely changes in the world now. Not retryable once failed. Unset while the goal is still active. */
  failureConsequence?: string;
  /** Short-term goals carry none (a single quest suffices); mid/long-term goals break the goal into dated/ordered steps. */
  milestones: GoalMilestone[];
  /** Only meaningful for bbeg/faction goals, which advance on a day-count budget via long rest ticks. */
  totalDays?: number;
  daysElapsed?: number;
  /** Set by the session-end AI review when a player goal's description is too vague to target ("I want to be stronger") — shown to the player, cleared once they revise it. */
  validationFeedback?: string;
  /** Set once the session-end AI review has generated a real quest hook from this goal — the goal is now woven into the world (an NPC/location/quest exists because of it), so its description can no longer be edited or removed out from under that quest. See isGoalLocked. */
  builtIntoWorld?: boolean;
  createdAt: string;
  failedAt?: string;
}

/** A goal the player can no longer edit or remove: either the VDM has already built it into the world (a quest now depends on its description), or it's reached a terminal state (failed — not retryable — or succeeded). Enforced server-side (upsertPlayerGoal/removePlayerGoal are no-ops against a locked goal); the client uses this to render it read-only. */
export function isGoalLocked(goal: Goal): boolean {
  return goal.status !== "active" || !!goal.builtIntoWorld;
}
