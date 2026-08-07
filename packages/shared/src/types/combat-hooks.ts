import type { AbilityKey } from "./character.ts";

/**
 * Lifecycle points the combat StateEngine fires hooks at. Every stage has exactly one
 * context type (see CONTEXT MUTATION below) and one place in the runtime that triggers it.
 *
 * Ordering within a single attack:
 *   beforeAttackRoll → (roll) → afterAttackRoll → beforeDamage → (apply) → afterDamage → onDown/onKill
 * Ordering across a turn:
 *   afterTurn (outgoing actor) → afterRound/beforeRound (only when the order wraps) → beforeTurn (incoming actor)
 */
export const HOOK_STAGES = [
  "beforeCombat",
  "afterCombat",
  "beforeRound",
  "afterRound",
  "beforeTurn",
  "afterTurn",
  "beforeAttackRoll",
  "afterAttackRoll",
  "beforeDamage",
  "afterDamage",
  "beforeSave",
  "afterSave",
  "beforeSpellCast",
  "afterSpellCast",
  "onDown",
  "onKill",
] as const;
export type HookStage = (typeof HOOK_STAGES)[number];

// ── Contexts ──────────────────────────────────────────────────────────────────
//
// CONTEXT MUTATION — the rule the whole engine rests on.
//
// A context is mutable working state, not a result. Hooks read it and write to the
// fields marked mutable below; the runtime then RE-DERIVES the outcome from the context
// after the stage returns, rather than trusting the local it computed before firing.
//
// For attacks that means, after `afterAttackRoll`:
//     ctx.total = ctx.d20 + ctx.attackBonus;
//     ctx.hit   = ctx.total >= ctx.ac;
// and for saves, after `beforeSave`:
//     ctx.total = ctx.d20 + ctx.saveBonus;
//     ctx.saved = ctx.total >= ctx.dc;
//
// This is what lets Shield work: it raises `ac` in `afterAttackRoll`, and an attack that
// had already cleared the old AC is re-checked against the new one and becomes a miss.
// Nothing is broadcast to clients until after the chain has run, so no result is ever
// emitted and then retracted.

export interface AttackContext {
  attackerId: string;
  attackerName: string;
  targetId: string;
  targetName: string;
  /** True when the *defender* is a player character — reaction offers only go to players. */
  targetIsPlayer: boolean;
  /** Display name of the weapon or spell driving the attack, for prompts and logs. */
  sourceName: string;
  d20: number;
  /** Mutable — total is re-derived as d20 + attackBonus. */
  attackBonus: number;
  /** Mutable — Shield's +5 lands here. */
  ac: number;
  /** Re-derived after each stage; do not write. */
  total: number;
  /** Re-derived after each stage; do not write. */
  hit: boolean;
}

export interface DamageContext {
  sourceId: string;
  targetId: string;
  targetName: string;
  /** Mutable — resistance, absorption, and outright negation all set this (0 = fully prevented). */
  amount: number;
  // `| undefined` (rather than a bare optional) because api/client compile with
  // exactOptionalPropertyTypes and build these contexts straight from optional sources
  // such as `rolledDamage?.damageType` — same convention as AttackResult in combat.ts.
  damageType?: string | undefined;
  /** Display name of the weapon, spell, or effect dealing the damage. */
  sourceName: string;
}

export interface SaveContext {
  casterId: string;
  targetId: string;
  targetName: string;
  targetIsPlayer: boolean;
  spellName: string;
  ability: AbilityKey;
  /** Mutable — a hook may raise or lower the DC this target rolls against. */
  dc: number;
  d20: number;
  /** Mutable — total is re-derived as d20 + saveBonus. */
  saveBonus: number;
  /** Re-derived after each stage; do not write. */
  total: number;
  /** Re-derived after each stage; do not write. */
  saved: boolean;
}

export interface TurnContext {
  participantId: string;
  participantName: string;
  isPlayer: boolean;
  round: number;
}

export interface RoundContext {
  round: number;
}

export interface CombatContext {
  round: number;
}

export interface SpellCastContext {
  casterId: string;
  casterName: string;
  spellName: string;
  /** The spell's own level (0 = cantrip), independent of the slot it was cast with. */
  spellLevel: number;
  slotLevel: number;
  targetIds: string[];
}

/** Fired for both `onDown` (dropped to 0 HP) and `onKill` (dead outright / failed final death save). */
export interface DeathContext {
  participantId: string;
  participantName: string;
  isPlayer: boolean;
  /** Whoever dealt the finishing damage, when known. */
  sourceId?: string | undefined;
}

/** Maps each stage to the context type the engine passes to hooks registered on it. */
export interface HookContextMap {
  beforeCombat: CombatContext;
  afterCombat: CombatContext;
  beforeRound: RoundContext;
  afterRound: RoundContext;
  beforeTurn: TurnContext;
  afterTurn: TurnContext;
  beforeAttackRoll: AttackContext;
  afterAttackRoll: AttackContext;
  beforeDamage: DamageContext;
  afterDamage: DamageContext;
  beforeSave: SaveContext;
  afterSave: SaveContext;
  beforeSpellCast: SpellCastContext;
  afterSpellCast: SpellCastContext;
  onDown: DeathContext;
  onKill: DeathContext;
}

// ── Duration & triggers ───────────────────────────────────────────────────────

/**
 * When a registered hook stops applying. 'startOfOwnerTurn' is the 5e "until the start of
 * your next turn" window (Shield); 'rounds' covers fixed-length effects (Tasha's Caustic
 * Brew's 1 minute = 10 rounds).
 */
export interface HookDuration {
  until: "startOfOwnerTurn" | "endOfCombat" | "rounds";
  rounds?: number;
}

/**
 * What prompts a reaction-cast spell to be offered to its owner mid-resolution. Declared on
 * the spell rather than inferred, so the engine knows *why* it is interrupting.
 */
export interface ReactionTrigger {
  on: "beingHit";
}
