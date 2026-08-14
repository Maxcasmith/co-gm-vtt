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
  "onMove",
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

/**
 * Fired once per token:move, independent of the attack/turn/round chain above — the movement
 * counterpart, driving anything that reacts to a creature actually changing cells (Booming
 * Blade's "takes damage if it moves before your next turn", future terrain effects like a
 * Spike-Growth-shaped "damage per foot moved through this area"). Opportunity Attacks are NOT
 * driven through this — every creature with a reaction has that innately, not just ones a spell
 * touched, so it's checked directly in checkOpportunityAttacks (runtime.ts) rather than needing
 * a hook registered on anyone.
 *
 * Only the two endpoints are known (see checkOpportunityAttacks' own doc for why), so a hook
 * reacting to "did they cross into/out of some area" only ever sees where they started and
 * ended, not the cells in between.
 */
export interface MoveContext {
  participantId: string;
  participantName: string;
  fromGx: number;
  fromGy: number;
  toGx: number;
  toGy: number;
  /** Chebyshev distance in feet between the from/to cells — same convention as every other range check. */
  distanceFt: number;
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
  onMove: MoveContext;
}

// ── Duration & triggers ───────────────────────────────────────────────────────

/**
 * When a registered hook stops applying. 'startOfOwnerTurn' is the 5e "until the start of
 * your next turn" window where "your" is whoever the hook is attached to (Shield, cast on and
 * watching the caster). 'startOfCasterNextTurn' is the same window but for an effect planted on
 * a target that must instead watch the CASTER's turn (Ray of Sickness's "until the end of your
 * next turn" — the target is Poisoned, but "your" means the caster who threw the ray, not the
 * target's own turn). 'rounds' covers fixed-length effects measured in combat rounds (Tasha's
 * Caustic Brew's 1 minute = 10 rounds) — these only ever tick while an encounter is running,
 * since rounds don't exist outside one. 'gameTime' is the same idea measured against the
 * campaign's real clock instead (Mage Armor's 8 hours, Comprehend Languages' 1 hour) — it
 * expires by wall-clock/narrative time passing (see sweepGameTimeExpiries in runtime.ts, called
 * wherever worldTimeSecs advances) regardless of whether combat is active, so it's the right
 * choice for anything cast during exploration that needs to actually run out.
 */
export interface HookDuration {
  until: "startOfOwnerTurn" | "startOfCasterNextTurn" | "endOfCombat" | "rounds" | "gameTime";
  rounds?: number;
  /** gameTime only — how many game-seconds from the moment of casting until this expires. */
  gameSecs?: number;
}

/**
 * What prompts a reaction-cast spell to be offered to its owner mid-resolution. Declared on
 * the spell rather than inferred, so the engine knows *why* it is interrupting.
 *
 * 'beingHit' fires on afterAttackRoll, before damage — a defensive boost that might turn the
 * incoming hit into a miss (Shield). 'takingDamage' fires on afterDamage, after the hit already
 * landed — a retaliation cast back at whoever dealt the damage (Hellish Rebuke). The two need
 * different Hook classes (ReactionOfferHook vs RetaliationOfferHook in the api package) since
 * the shape of what's being decided is different, not just the stage.
 */
export interface ReactionTrigger {
  on: "beingHit" | "takingDamage";
  /**
   * How an accepted 'takingDamage' pick resolves — 'retaliate' (default, Hellish Rebuke) casts
   * back at whoever dealt the damage; 'resist' (Absorb Elements) instead grants the owner
   * resistance to the triggering damage type and arms bonus damage on their next weapon hit.
   * Both shapes fire on the same afterDamage broker so a player who knows both sees them
   * together in one offer. Irrelevant for 'beingHit', which is always the defend shape.
   */
  resolve?: "retaliate" | "resist";
}
