export type StoryProvider = "claude" | "openai" | "deepseek" | "kimi";
export type ImageModel = "gpt-image-1" | "dall-e-3" | "dall-e-2";

export type ReasoningEffort = "low" | "medium" | "high" | "maximum";

export interface ModelTier {
  provider: StoryProvider;
  model: string;
  effort?: ReasoningEffort;
  timeoutSeconds?: number; // undefined/empty = no timeout
}

export type AiFeature =
  | "campaignConcepts" | "dungeonPremise" | "backstoryGeneration" | "backstoryCheck" | "worldLoreSync"
  | "nemesisGeneration" | "dmBrief" | "questGeneration" | "dmChatResponse" | "sessionTriage" | "sessionRecap" | "tagEffectProcessing"
  | "worldGeneration" | "dungeonGeneration" | "worldStateAdvance"
  | "combatNarration" | "encounterGeneration" | "improvisedResolution"
  | "compendium";

export interface AiWorkflow {
  id: string;
  name: string;
  enabled: boolean;
  models: ModelTier[];
  features: AiFeature[];
}

export interface ImageConfig {
  model: ImageModel;
  generateMaps: boolean;
  generateWorldMap: boolean;
}

export type NarrationModel = "none" | "browser" | "tts-1" | "tts-1-hd";

export interface NarrationConfig {
  model: NarrationModel;
  voice: string;
}

export interface ApiKeys {
  openai: string;
  anthropic: string;
  deepseek: string;
  kimi: string;
}

export interface AppConfig {
  workflows: AiWorkflow[];
  apiKeys: ApiKeys;
  image: ImageConfig;
  narration: NarrationConfig;
}
