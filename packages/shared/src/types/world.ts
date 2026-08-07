import type { EnemyStatBlock } from "./combat.ts";

export interface WorldConcept {
  name: string;
  description: string;
}

export interface Campaign {
  id: string;
  name: string;
}

export interface WorldMeta {
  id: string;
  name: string;
  campaignDir: string;
  type: "campaign" | "one-shot" | "dungeon-crawl" | "module";
  concept?: { name: string; description: string };
  tags?: string[];
  adventureSlug?: string;
}

export interface Quest {
  id: string;
  name: string;
  description: string;
  status: "undiscovered" | "open" | "resolved";
  log: Array<{ date: string; text: string }>;
  addedAt: string;
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
