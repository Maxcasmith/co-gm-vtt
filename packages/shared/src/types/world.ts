import type { EnemyStatBlock } from "./combat.ts";
import type { PlotHookTag } from "./plotHooks.ts";

export interface WorldConcept {
  name: string;
  description: string;
}

export interface Campaign {
  id: string;
  name: string;
  type: WorldMeta["type"];
  concept?: { name: string; description: string };
  tags?: string[];
  scenarioSynopsis?: string;
  partySize?: number;
}

export interface WorldMeta {
  id: string;
  name: string;
  campaignDir: string;
  type: "campaign" | "one-shot" | "dungeon-crawl" | "module";
  concept?: { name: string; description: string };
  tags?: string[];
  adventureSlug?: string;
  houseRules?: HouseRules;
  gamePassword?: string;
  /** Dungeon-crawl worlds only — the rich scenario synopsis generated before the dungeon itself,
   * shown in full in the game lobby and fed into manifest generation as story context. */
  scenarioSynopsis?: string;
  /** Dungeon-crawl worlds only — the party size the dungeon's rooms/encounters were scaled for. */
  partySize?: number;
  /** Grown from actual play (session-end classification), not set at creation — what this campaign's
   * play has actually proven to be about, used to filter the plot hook pool. Empty/undefined means
   * "not yet known", not "nothing fits" — pool eligibility treats that as no tag filter at all. */
  storyTags?: PlotHookTag[];
}

/** Optional per-campaign rule toggles, off by default. */
export interface HouseRules {
  /** On a crit, add the die's max value instead of rolling a second time. */
  perkinsCrit: boolean;
  /** Disables Opportunity Attacks entirely. */
  noAttacksOfOpportunity: boolean;
  /** How HP is determined on level-up. */
  levelUpHp: "roll" | "average" | "max" | "min";
  /** How long (seconds) a reaction offer stays open before auto-declining. */
  reactionTimeoutSecs: number;
  /** Shows each reaction option's roll/AC detail panel by default, instead of just the prompt sentence. */
  reactionShowDetailsByDefault: boolean;
}

export const DEFAULT_HOUSE_RULES: HouseRules = {
  perkinsCrit: false,
  noAttacksOfOpportunity: false,
  levelUpHp: "roll",
  reactionTimeoutSecs: 15,
  reactionShowDetailsByDefault: false,
};

export interface Quest {
  id: string;
  name: string;
  description: string;
  status: "undiscovered" | "open" | "resolved";
  log: Array<{ date: string; text: string }>;
  addedAt: string;
  /** Set when this quest was seeded by a dungeon's own goals (buildDungeonQuests) — scopes it to that dungeon's closed-world narration instead of the full campaign quest list. */
  sourceDungeonId?: string;
  /** npc entity slug this quest's hook originates from, when it has one (a missive/document-origin quest may have none). Lets the DM prompt point at a concrete NPC instead of leaving the match to inference — see session-processor/index.ts's undiscovered-quests block. */
  relatedNpc?: string;
  /** location entity slug this quest's hook is tied to, when known. */
  relatedLocation?: string;
}

export interface SessionManifest {
  currentLocation: string | null;
  npcs: string[];
  factions: string[];
  connectedZones: string[];
  updatedAt: string;
  act: number;
  worldTimeSecs: number;
  sessionsPlayed: number;
}

export interface NemesisRecord {
  id: string;
  name: string;
  boundTo: string; // 'party' or a specific character name
  status: "active" | "retired";
  deathCount: number;
  cooldownUntilSession: number;
  statBlock: EnemyStatBlock;
  createdAtSession: number;
}

export interface SavedAdventureMeta {
  slug: string;
  name: string;
  sourceType: WorldMeta["type"];
  savedAt: string;
  hasDungeon: boolean;
  /** Dungeon-crawl templates only — carried over from the source campaign's WorldMeta so a
   * "Play a Copy of X" screen can show what the dungeon is about instead of just "a dungeon". */
  scenarioSynopsis?: string;
  /** Dungeon-crawl templates only — carried over from the source campaign's WorldMeta. */
  partySize?: number;
  /** Carried over from the source campaign's WorldMeta.concept.name — the generated world's theme/premise. */
  theme?: string;
  entityCount: {
    npc: number;
    creature: number;
    faction: number;
    location: number;
  };
}

export interface CompendiumMeta {
  slug: string;
  name: string;
  source: string;
  createdAt: string;
  entityCount: {
    npc: number;
    creature: number;
    faction: number;
    location: number;
  };
  status: "complete" | "draft";
  resumeFromChunk: number;
}

export interface WorldMilestone {
  day: number;
  description: string;
  completed: boolean;
  completedOnDay?: number;
}

export interface WorldActor {
  id: string;
  name: string;
  type: "bbeg" | "faction";
  ultimateGoal: string;
  totalDays: number;
  daysElapsed: number;
  milestones: WorldMilestone[];
  currentStatus: string;
  status: "active" | "defeated" | "succeeded";
}

export interface WorldState {
  dayNumber: number;
  totalHoursElapsed: number;
  actors: WorldActor[];
}
