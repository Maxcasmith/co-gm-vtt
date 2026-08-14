import type { CharacterStats, AbilityKey } from "./character.ts";
import type { ActiveCondition } from "./conditions.ts";

export interface RollResult {
  characterName: string;
  rollType: "check" | "save";
  stat: string;
  d20: number;
  modifier: number;
  total: number;
  description: string;
}

export interface CheckRequest {
  player: string;
  skill: string;
  type: "check" | "save";
}

// D&D 5e monster type categories — lets spell effects (e.g. Divine Smite vs Fiend/Undead)
// condition on what they're hitting. Optional on EnemyStatBlock: not backfilled onto old
// saved encounters/nemeses, but every new-creature creation site should set it.
export const CREATURE_TYPES = [
  "Aberration", "Beast", "Celestial", "Construct", "Dragon", "Elemental",
  "Fey", "Fiend", "Giant", "Humanoid", "Monstrosity", "Ooze", "Plant", "Undead",
] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

export interface EnemyStatBlock {
  id: string;
  name: string;
  cr: number;
  hp: number;
  ac: number;
  speed: number;
  stats: CharacterStats;
  attacks: { name: string; bonus: number; damage: string }[];
  xp?: number;
  level?: number;
  creatureType?: CreatureType;
  isBoss?: boolean;
  /** The player who controls this ally on the map (Find Familiar/Unseen Servant's summoner) — omitted for GM-recruited party allies, which stay GM-controlled. Same idea as "the telepathic link," simplified to full token control instead of a separate see/hear/command mechanic. */
  ownerId?: string;
  // Combat-scoped, like the rest of a creature's live state — not persisted beyond the fight
  // (Encounter.toJSON() only ever serialized stat blocks, same fidelity as HP/resources).
  conditions?: ActiveCondition[] | undefined;
  // Innate damage-type modifiers, e.g. ["Fire"] or ["Bludgeoning, Piercing, and Slashing"] as
  // printed on the stat block. Registered as endOfCombat DamageResistanceHooks at combat start
  // — same application path a spell-granted one (Absorb Elements) uses, just a longer duration.
  damageResistances?: string[];
  damageVulnerabilities?: string[];
  damageImmunities?: string[];
}

export interface TurnOrderEntry {
  id: string;
  name: string;
  initiative: number;
  isPlayer: boolean;
  teamId: string;
  /** See EnemyStatBlock.ownerId. */
  ownerId?: string;
}

export interface TokenPosition {
  tokenId: string;
  gx: number;
  gy: number;
}

export interface AttackResult {
  attackerName: string;
  targetName: string;
  targetId: string;
  weaponName: string;
  isMelee: boolean;
  d20: number;
  attackBonus: number;
  statBonus: number;
  statName: string;
  weaponBonus: number;
  total: number;
  ac: number;
  hit: boolean;
  damage?: number | undefined;
  damageRoll?: number | undefined;
  damageType?: string | undefined;
  damageFormula?: string | undefined;
  remainingHp?: number | undefined;
  targetDead: boolean;
  // Present when a pending on-hit spell buff (e.g. Divine Smite) triggered on this attack.
  bonusSpellName?: string | undefined;
  bonusDamage?: number | undefined;
  bonusDamageType?: string | undefined;
}

export interface CombatVictory {
  xpPerPlayer: number;
  totalXp: number;
  kills: string[];
}

export interface SpellAttackResult {
  attackerName: string;
  targetName: string;
  targetId: string;
  spellName: string;
  d20: number;
  attackBonus: number;
  statBonus: number;
  statName: string;
  total: number;
  ac: number;
  hit: boolean;
  damage?: number | undefined;
  damageRoll?: number | undefined;
  damageType?: string | undefined;
  damageFormula?: string | undefined;
  remainingHp?: number | undefined;
  targetDead: boolean;
}

export interface SpellSaveOutcome {
  targetId: string;
  targetName: string;
  isPC: boolean;
  roll: number;
  saveBonus: number;
  total: number;
  dc: number;
  saved: boolean;
  damage?: number | undefined;
  conditionsApplied?: string[] | undefined;
  remainingHp?: number | undefined;
  targetDead: boolean;
}

export interface SpellSaveResult {
  casterName: string;
  spellName: string;
  dc: number;
  saveAbility: AbilityKey;
  slotLevel: number;
  outcomes: SpellSaveOutcome[];
}
