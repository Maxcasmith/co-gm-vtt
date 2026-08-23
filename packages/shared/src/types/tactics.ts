import type { Condition } from "./conditions.ts";

/**
 * Gate kinds a Group's condition can check. `lastActionMissed`/`always` are step-sequencing
 * gates (see executionLoop.ts) rather than situational checks. `hpBelowPct`/`statusPresent`
 * always check the group's resolved target (the same scope-chain "target" directive system
 * everything else uses, see Manoeuvre.defaultTarget) — checking your own HP/status means placing
 * a "Target: Self" directive in scope rather than a separate self/target toggle on the condition.
 */
export type TacticCondition =
  | { kind: "hpBelowPct"; unit: "percent" | "hp"; amount: number }
  | { kind: "statusPresent"; status: Condition }
  | { kind: "inRange"; ft: number }
  | { kind: "lastActionMissed" }
  | { kind: "always" };

/** Which participant a "target" directive (or a "move" directive referencing one) resolves to — see combat/tactics/conditionEvaluator.ts's resolveTarget. */
export type TargetStrategy = "self" | "closestEnemy" | "lowestHpEnemy" | "highestHpEnemy" | "closestAlly" | "lowestHpAlly" | "highestHpAlly" | "allyWithStatus";

/** A target strategy plus whatever it needs to actually resolve — today only `allyWithStatus` needs `statusFilter` ("any" matches any status at all); every other strategy ignores it. */
export interface TargetRef {
  strategy: TargetStrategy;
  statusFilter?: Condition | "any";
}

/**
 * The authorable directive kinds. "target" isn't itself an action — it never becomes a candidate
 * to execute (see executionLoop.ts's walkGroup) — it's a pure modifier consumed by the directive
 * immediately after it in the same children list: a "move" directive with a "target" directive as
 * its immediately preceding sibling moves toward/away from whatever that target resolves to,
 * instead of the default nearest enemy.
 */
export type DirectiveKind = "move" | "attackWithWeapon" | "castSpell" | "target" | "dash" | "disengage" | "dodge" | "useConsumable";

/** A leaf action — fires when every enclosing Group's gate (see Group) currently holds. */
export interface Directive {
  id: string;
  type: "directive";
  kind: DirectiveKind;
  /** Only set (and only meaningful) when kind === "castSpell". */
  spellName?: string;
  /** Only set (and only meaningful) when kind === "move" — defaults to "toward" when unset. */
  direction?: "toward" | "away";
  /** Only set (and only meaningful) when kind === "target". */
  target?: TargetRef;
  /** Only set (and only meaningful) when kind === "useConsumable" — an id into the character's own inventory. */
  itemId?: string;
}

/**
 * A gate plus an ordered list of children (more Groups and/or Directives). No stored logic
 * operator: a group's position in its parent's children list determines how its own `condition`
 * combines with whatever gate was already accumulated there — the first group in any list is
 * intrinsically "when" (ANDs with the incoming gate), every later sibling group in that same list
 * is intrinsically "or when" (ORs with it). See combat/tactics/executionLoop.ts's walkGroup for
 * the exact evaluation.
 */
export interface Group {
  id: string;
  type: "group";
  condition: TacticCondition;
  /** Inverts `condition` before it combines into the gate — "when NOT X" instead of "when X". */
  negate?: boolean;
  children: (Group | Directive)[];
}

/** A named chain of gated directives. `root` always exists and is always the "when" position (it has no siblings) — every manoeuvre must contain at least a (possibly empty) root group. */
export interface Manoeuvre {
  id: string;
  name: string;
  /**
   * The manoeuvre-wide target, fixed ahead of the root group — not itself a tree node, so it
   * can't be removed or repositioned. Every "target"-referencing condition and every action
   * (attack/spell/a "move" with no closer local target directive preceding it) resolves against
   * this unless a directive-local "target" directive overrides it — see executionLoop.ts.
   */
  defaultTarget: TargetRef;
  root: Group;
}
