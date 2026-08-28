export interface StoryboardSlide {
  url: string;
  caption: string;
}

export interface CharacterStoryboard {
  characterId: string;
  slides: StoryboardSlide[];
  generatedAt: string;
}

// Dungeon-crawl worlds only — one per campaign, generated alongside the dungeon itself from the
// scenario synopsis. No characterId: it isn't owned by any one character, and StoryboardQueueEntry
// (below) doesn't need one either — the client plays entries generically without reading the name.
export interface ScenarioStoryboard {
  slides: StoryboardSlide[];
  generatedAt: string;
}

export interface StoryboardQueueEntry {
  characterId: string;
  characterName: string;
  slides: StoryboardSlide[];
}

export interface StoryboardQueuePayload {
  entries: StoryboardQueueEntry[];
}

// Admin Resources "test the storyboard pipeline" sandbox — decoupled from any real character,
// a single persisted record so tweaking name/backstory and re-generating never loses the last
// result while you edit.
export interface StoryboardTestRecord {
  name: string;
  backstory: string;
  portraitUrl: string;
  slides: StoryboardSlide[];
  generatedAt: string;
  // Unmodified atlas straight from the model, before crop/resize — for reviewing what it actually
  // drew (grid alignment, panel bleed, composition) independent of the final cropped slides.
  sourceUrl?: string;
}
