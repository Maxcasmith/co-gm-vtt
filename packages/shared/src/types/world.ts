import type { EnemyStatBlock } from "./combat.ts";
import type { PlotHookTag } from "./plotHooks.ts";

export interface WorldConcept {
  name: string;
  description: string;
}

/** Fixed sets, classified once from the campaign's tags at creation (see api
 * dungeon/genreTiles.ts's classifyCampaignGenre) and persisted. Purely a key for narrowing which
 * reusable tile art is offered (see GenreTileMap in dungeon.ts) — setting decides the material
 * palette, tone decides which variant of a material fits (clean vs bloodstained tile). */
export const GENRE_SETTINGS = ["fantasy", "modern", "scifi"] as const;
export type GenreSetting = (typeof GENRE_SETTINGS)[number];
export const GENRE_TONES = ["standard", "grim", "horror", "whimsical"] as const;
export type GenreTone = (typeof GENRE_TONES)[number];
export interface CampaignGenre {
  setting: GenreSetting;
  tone: GenreTone;
}
export const DEFAULT_CAMPAIGN_GENRE: CampaignGenre = { setting: "fantasy", tone: "standard" };

export const GENRE_SETTING_DESCRIPTIONS: Record<GenreSetting, string> = {
  fantasy: "pre-industrial — swords, magic, stone, timber.",
  modern: "industrial era to today, roughly 1800s onward — railways, gunpowder, iron, concrete. Includes westerns, Victorian, steampunk, dieselpunk, present day.",
  scifi: "future technology — spacecraft, advanced machines, other worlds.",
};

export const GENRE_TONE_DESCRIPTIONS: Record<GenreTone, string> = {
  standard: "the setting's natural look, no strong treatment — clean or lived-in, balanced colour. e.g. LOTR's Shire, Star Trek, a modern police station.",
  grim: "human-caused hardship — war, poverty, neglect, brutality. Mud, scorch, wear, desaturated greys and browns. Dark but nothing unnatural. e.g. The Witcher, Game of Thrones, Band of Brothers, Mad Max.",
  horror: "wrongness — supernatural, disease, the monstrous. Blood, rot, unnatural growth, sickly colour, deep shadow. e.g. Van Helsing, Resident Evil, Alien, Bloodborne.",
  whimsical: "storybook, heightened — saturated colour, soft or magical surfaces, cosy or playful. e.g. Fable, Studio Ghibli, Alice in Wonderland, Pixar.",
};

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
  /** Set once at creation, never changed. Tile-lookup key only — see GENRE_SETTINGS/GENRE_TONES.
   * Undefined on campaigns saved before this field existed; treated as "no genre map filtering". */
  genre?: CampaignGenre;
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
  /** Origin feat Alert's post-initiative swap pause — whether it auto-cancels after alertSwapTimeoutSecs. Off: waits until every Alert player answers. */
  alertSwapTimerEnabled: boolean;
  /** How long (seconds) each Alert player has to swap before it counts as Cancel. Independent of reactionTimeoutSecs. */
  alertSwapTimeoutSecs: number;
}

export const DEFAULT_HOUSE_RULES: HouseRules = {
  perkinsCrit: false,
  noAttacksOfOpportunity: false,
  levelUpHp: "roll",
  reactionTimeoutSecs: 15,
  reactionShowDetailsByDefault: false,
  alertSwapTimerEnabled: true,
  alertSwapTimeoutSecs: 30,
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
  /** Goal.id(s) this quest was generated to serve, when it came from the session-end goal review pass — a single quest can intersect more than one party member's goal. */
  relatedGoalId?: string[];
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

export interface WorldActor {
  id: string;
  name: string;
  type: "bbeg" | "faction";
  /** The Goal (goals.json, ownerType "bbeg"|"faction", ownerId === this actor's id) this actor is pursuing. */
  goalId: string;
  currentStatus: string;
  status: "active" | "defeated" | "succeeded";
}

export interface WorldState {
  dayNumber: number;
  totalHoursElapsed: number;
  actors: WorldActor[];
}
