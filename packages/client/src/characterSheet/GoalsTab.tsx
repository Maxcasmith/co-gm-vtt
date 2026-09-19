import { useState } from "react";
import { isGoalLocked, type Character, type Goal, type GoalTier } from "shared";
import { Button } from "../components/Button/Button.tsx";
import { dispatch } from "../events.ts";

const TIER_LABEL: Record<GoalTier, string> = {
  short: "Short Term",
  mid: "Mid Term",
  long: "Long Term",
};

interface DraftGoal {
  id?: string;
  tier: GoalTier;
  description: string;
}

function toDraft(goal: Goal): DraftGoal {
  return { id: goal.id, tier: goal.tier, description: goal.description };
}

const NEW_DRAFT: DraftGoal = { tier: "short", description: "" };

export function GoalsTab({ character, goals }: { character: Character; goals: Goal[] }) {
  const [drafts, setDrafts] = useState<Record<string, DraftGoal>>({});
  const [adding, setAdding] = useState<DraftGoal | null>(null);

  function draftFor(goal: Goal): DraftGoal {
    return drafts[goal.id] ?? toDraft(goal);
  }

  function updateDraft(goalId: string, base: DraftGoal, patch: Partial<DraftGoal>) {
    setDrafts((prev) => ({ ...prev, [goalId]: { ...base, ...patch } }));
  }

  function save(draft: DraftGoal, isNew: boolean) {
    if (!draft.description.trim()) return;
    dispatch("vtt:goal:save", {
      characterId: character.id,
      id: draft.id,
      tier: draft.tier,
      description: draft.description.trim(),
    });
    if (isNew) setAdding(null);
    else if (draft.id) setDrafts((prev) => { const next = { ...prev }; delete next[draft.id!]; return next; });
  }

  return (
    <>
      {goals.length === 0 && !adding && (
        <div className="sheet-empty">
          <p className="sheet-empty-title">No goals yet</p>
          <p className="sheet-empty-hint">
            A good goal is concrete enough for the VDM to build a quest from it — "I want to break
            into the thieves' den to steal back my ancestral weapon", not "I want to be stronger".
          </p>
        </div>
      )}

      <div className="sheet-goals-list">
        {goals.map((goal) => {
          const draft = draftFor(goal);
          const dirty = drafts[goal.id] != null;
          const locked = isGoalLocked(goal);
          return (
            <div key={goal.id} className={`sheet-goal-card${locked ? " sheet-goal-card--locked" : ""}`}>
              <div className="sheet-goal-card-header">
                {locked ? (
                  <span className="sheet-goal-tier-label">{TIER_LABEL[goal.tier]}</span>
                ) : (
                  <select
                    className="sheet-goal-tier-select"
                    value={draft.tier}
                    onChange={(e) => updateDraft(goal.id, draft, { tier: e.target.value as GoalTier })}
                  >
                    <option value="short">{TIER_LABEL.short}</option>
                    <option value="mid">{TIER_LABEL.mid}</option>
                    <option value="long">{TIER_LABEL.long}</option>
                  </select>
                )}
                <span className={`sheet-goal-status sheet-goal-status--${goal.status}`}>{goal.status}</span>
                {locked ? (
                  <span className="sheet-goal-locked-hint" title="The VDM has already built this into the world — it can no longer be edited or removed.">🔒</span>
                ) : (
                  <Button variant="ghost" className="sheet-goal-delete" onClick={() => dispatch("vtt:goal:delete", { characterId: character.id, id: goal.id })}>
                    Remove
                  </Button>
                )}
              </div>
              {locked ? (
                <p className="sheet-goal-description-locked">{goal.description}</p>
              ) : (
                <>
                  <textarea
                    className="sheet-goal-textarea"
                    placeholder="What do you want to achieve? Be specific enough to build a quest from."
                    value={draft.description}
                    onChange={(e) => updateDraft(goal.id, draft, { description: e.target.value })}
                  />
                  <p className="sheet-goal-lock-notice">
                    Please finalise this goal before session end — once it's built into the world you won't be able to edit or remove it.
                  </p>
                </>
              )}
              {goal.validationFeedback && (
                <p className="sheet-goal-feedback">{goal.validationFeedback}</p>
              )}
              {goal.status === "failed" && goal.failureConsequence && (
                <p className="sheet-goal-consequence">{goal.failureConsequence}</p>
              )}
              {goal.tier !== "short" && goal.milestones.length > 0 && (
                <ul className="sheet-goal-milestones">
                  {goal.milestones.map((m) => (
                    <li key={m.id} className={m.completed ? "sheet-goal-milestone--done" : ""}>{m.description}</li>
                  ))}
                </ul>
              )}
              {!locked && dirty && (
                <Button variant="ghost" className="sheet-goal-save" onClick={() => save(draft, false)}>
                  Save
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="sheet-goal-card sheet-goal-card--new">
          <select
            className="sheet-goal-tier-select"
            value={adding.tier}
            onChange={(e) => setAdding({ ...adding, tier: e.target.value as GoalTier })}
          >
            <option value="short">{TIER_LABEL.short}</option>
            <option value="mid">{TIER_LABEL.mid}</option>
            <option value="long">{TIER_LABEL.long}</option>
          </select>
          <textarea
            className="sheet-goal-textarea"
            placeholder="What do you want to achieve? Be specific enough to build a quest from."
            value={adding.description}
            onChange={(e) => setAdding({ ...adding, description: e.target.value })}
          />
          <p className="sheet-goal-lock-notice">
            Please finalise this goal before session end — once it's built into the world you won't be able to edit or remove it.
          </p>
          <div className="sheet-goal-new-actions">
            <Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button>
            <Button variant="ghost" className="sheet-goal-save" onClick={() => save(adding, true)}>Save</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" className="sheet-goal-add" onClick={() => setAdding(NEW_DRAFT)}>
          + Add new Goal
        </Button>
      )}
    </>
  );
}
