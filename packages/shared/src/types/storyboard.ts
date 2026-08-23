export interface StoryboardSlide {
  url: string;
  caption: string;
}

export interface CharacterStoryboard {
  characterId: string;
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
