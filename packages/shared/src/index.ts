export type Player = string;

export interface RollResult {
  characterName: string;
  rollType: 'check' | 'save';
  stat: string;
  d20: number;
  modifier: number;
  total: number;
  description: string;
}

export interface ChatPayload {
  text: string;
  senderName: string;
  timestamp: number;
}

export interface ServerToClientEvents {
  'players:update': (players: Player[]) => void;
  'roll:result':    (result: RollResult) => void;
  'chat:message':   (payload: ChatPayload) => void;
}

export interface ClientToServerEvents {
  'player:join':  (player: Player) => void;
  'roll:check':   (payload: { campaignId: string; characterId: string; stat: string; skill?: string }) => void;
  'roll:save':    (payload: { campaignId: string; characterId: string; stat: string }) => void;
  'chat:message': (payload: { text: string; senderName: string }) => void;
}

export type StoryProvider = 'claude' | 'openai' | 'deepseek';
export type ImageModel = 'dall-e-3' | 'dall-e-2';

export interface StoryConfig {
  provider: StoryProvider;
  model: string;
  apiKey: string;
}

export interface ImageConfig {
  model: ImageModel;
  apiKey: string;
}

export interface AppConfig {
  story: StoryConfig;
  image: ImageConfig;
}

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
  type: 'campaign' | 'one-shot';
  concept?: { name: string; description: string };
  tags?: string[];
}

export interface CharacterStats {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface Character {
  id: string;
  campaignId: string;
  name: string;
  species: string;
  background: string;
  class: string;
  stats: CharacterStats;
  skillProficiencies: string[];
  password: string;
  portraitPath: string;
  tokenPath: string;
  createdAt: string;
}
