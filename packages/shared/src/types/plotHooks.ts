// Fixed taxonomy shared between a plot hook's own tags (below) and a campaign's storyTags
// (WorldMeta, populated over play — see session-processor). Deliberately genre-agnostic: a
// plot hook's theme/tone survives a full reflavor across genres, so genre itself is never a tag
// here — it lives on the campaign (WorldMeta.tags) and only matters at reflavor time, not selection.
export const PLOT_HOOK_TAGS = [
  "authority-betrayal", "false-flag", "unjust-persecution", "moral-dilemma", "protector-turned-oppressor",
  "political-intrigue", "revenge", "hidden-identity", "forbidden-knowledge", "sacrifice", "corruption",
  "survival-under-siege", "found-family", "coming-of-age",
  "dark", "morally-gray", "tragic", "hopeful", "grim",
] as const;

export type PlotHookTag = typeof PLOT_HOOK_TAGS[number];

// A beat's `function` is the narrative purpose only — deliberately stripped of concrete nouns/names
// (no "kingsguard", no "village") so the same skeleton can be reflavored with an unrecognizable
// vehicle every time it's used, instead of just having its proper nouns swapped out.
export interface PlotHookBeat {
  order: number;
  function: string;
}

export interface PlotHook {
  id: string;
  title: string;
  // Original admin-entered prose, kept so a re-normalize never loses the source material.
  rawText: string;
  tags: PlotHookTag[];
  // Free-text entity roles this hook needs (e.g. "an authority faction", "a settlement") — checked
  // against a campaign's existing entities at selection time, not drawn from a fixed taxonomy.
  structuralRequirements: string[];
  beats: PlotHookBeat[];
  createdAt: string;
  usedIn: Array<{ campaignId: string; usedAt: string }>;
}

// One beat of an ActivePlotArc, already reflavored into this specific campaign's concrete vehicle
// (real names, not the skeleton's bare function) — this is what actually becomes a Quest object
// when its turn comes, verbatim.
export interface PlotArcBeatInstance {
  order: number;
  questId: string;
  name: string;
  description: string;
}

// A plot hook committed to one campaign, mid-play. Only `beats[currentBeatIndex]` is ever exposed
// as an actual quest — every later beat stays here, unseen by any prompt or player, until the
// current one resolves (see plotArcs.ts's advancePlotArc). This is what makes the sequence spoiler-
// safe: the beats aren't "hidden but present" in the quest list, they don't exist as quests yet.
export interface ActivePlotArc {
  plotHookId: string;
  beats: PlotArcBeatInstance[];
  currentBeatIndex: number;
  startedAt: string;
}
