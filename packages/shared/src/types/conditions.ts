// Own file (not spells.ts) so Character can reference Condition without a spells.ts↔character.ts
// import cycle — same reasoning as combat-hooks.ts splitting off from spells.ts.
export const CONDITIONS = [
  "Blinded",
  "Charmed",
  "Concentrating",
  "Deafened",
  "Exhaustion",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * What a 'Concentrating' condition is sustaining — the StateEngine hooks it's keeping alive.
 * `targetIds` are whoever those hooks are registered on (an owner + spell.name pair is how the
 * engine already addresses a spell's hooks — see registerSpellHooks/unregisterBySource — so
 * breaking concentration is just unregisterBySource(targetId, spellName) for each one, no
 * separate id scheme needed).
 */
export interface ConcentrationLink {
  spellName: string;
  targetIds: string[];
}

/** A condition currently affecting a character. No duration tracking yet — add/remove is manual. */
export interface ActiveCondition {
  name: Condition;
  /** Only meaningful when name === 'Concentrating'. */
  concentration?: ConcentrationLink | undefined;
}
