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

export interface BattleMap {
  id: string;
  createdAt: string;
  locationName?: string;
}

export interface EnemyStatBlock {
  id: string;
  name: string;
  cr: number;
  hp: number;
  ac: number;
  speed: number;
  stats: CharacterStats;
  attacks: { name: string; bonus: number; damage: string }[];
}

export interface TurnOrderEntry {
  id: string;
  name: string;
  initiative: number;
  isPlayer: boolean;
}

export interface TokenPosition {
  tokenId: string;
  gx: number;
  gy: number;
}

export interface Creature extends EnemyStatBlock {
  currentHp: number;
  effects: string[];
}

export interface AttackResult {
  attackerName: string;
  targetName: string;
  targetId: string;
  weaponName: string;
  d20: number;
  attackBonus: number;
  total: number;
  ac: number;
  hit: boolean;
  damage?: number;
  damageFormula?: string;
  remainingHp?: number;
  targetDead: boolean;
}

export interface CombatVictory {
  xpPerPlayer: number;
  totalXp: number;
  kills: string[];
}

export interface ServerToClientEvents {
  'players:update':       (players: Player[]) => void;
  'roll:result':          (result: RollResult) => void;
  'chat:message':         (payload: ChatPayload) => void;
  'chat:history':         (messages: ChatPayload[]) => void;
  'session:state':        (active: boolean) => void;
  'session:recap':        (text: string) => void;
  'dm:thinking':          (active: boolean) => void;
  'combat:state':         (active: boolean) => void;
  'map:generating':       () => void;
  'map:generated':        (mapId: string) => void;
  'encounter:generating': () => void;
  'encounter:ready':      (enemies: EnemyStatBlock[]) => void;
  'token:moved':          (pos: TokenPosition) => void;
  'combat:turn':          (data: { actorName: string }) => void;
  'combat:initiative':    (entry: TurnOrderEntry) => void;
  'combat:turn:order':    (entries: TurnOrderEntry[]) => void;
  'combat:attack:result': (result: AttackResult) => void;
  'creature:update':      (data: { id: string; currentHp: number; maxHp: number; effects: string[] }) => void;
  'combat:victory':       (data: CombatVictory) => void;
  'combat:player:damage': (data: { characterId: string; characterName: string; damage: number; currentHp: number; maxHp: number }) => void;
  'rest:result': (data: { currentHp: number; maxHp: number; hpGained?: number; worldEvents?: string }) => void;
  'combat:death:save': (data: { characterName: string; roll: number; isNatural20: boolean; isNatural1: boolean; success: boolean; successes: number; failures: number; stable: boolean; dead: boolean }) => void;
  'combat:defeat': () => void;
  'combat:player:dead': (data: { characterId: string; characterName: string }) => void;
}


export interface ClientToServerEvents {
  'player:join':    (payload: { name: Player; campaignId: string }) => void;
  'roll:check':     (payload: { campaignId: string; characterId: string; stat: string; skill?: string }) => void;
  'roll:save':      (payload: { campaignId: string; characterId: string; stat: string }) => void;
  'chat:message':   (payload: { text: string; senderName: string }) => void;
  'session:start':  (payload: { campaignId: string }) => void;
  'session:end':    (payload: { campaignId: string }) => void;
  'token:move':     (pos: TokenPosition) => void;
  'combat:turn:end': () => void;
  'combat:initiative:roll': (entry: TurnOrderEntry) => void;
  'combat:attack':  (payload: { attackerId: string; attackerName: string; targetId: string; weapon: Weapon }) => void;
}

export type StoryProvider = 'claude' | 'openai' | 'deepseek';
export type ImageModel = 'gpt-image-1' | 'dall-e-3' | 'dall-e-2';

export interface StoryConfig {
  provider: StoryProvider;
  model: string;
  apiKey: string;
}

export interface ImageConfig {
  model: ImageModel;
  apiKey: string;
}

export interface CombatConfig {
  model: string;
  apiKey: string;
}

export interface AppConfig {
  story: StoryConfig;
  image: ImageConfig;
  combat: CombatConfig;
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

export interface Item {
  id: string;
  name: string;
  description: string;
  quantity: number;
  type?: string;
}

export interface Weapon extends Item {
  type: 'weapon';
  damage: string;
  damageType: string;
  attackBonus: number;
  range: number;
  properties: string[];
}

export function isWeapon(item: Item | Weapon | Consumable): item is Weapon {
  return item.type === 'weapon';
}

export interface Consumable extends Item {
  type: 'consumable';
  effect: string;
  actionCost: 'action' | 'bonusAction';
}

export function isConsumable(item: Item | Weapon | Consumable): item is Consumable {
  return item.type === 'consumable';
}

export type InventoryItem = Item;

export interface WorldMilestone {
  day: number;
  description: string;
  completed: boolean;
  completedOnDay?: number;
}

export interface WorldActor {
  id: string;
  name: string;
  type: 'bbeg' | 'faction';
  ultimateGoal: string;
  totalDays: number;
  daysElapsed: number;
  milestones: WorldMilestone[];
  currentStatus: string;
  status: 'active' | 'defeated' | 'succeeded';
}

export interface WorldState {
  dayNumber: number;
  totalHoursElapsed: number;
  actors: WorldActor[];
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
  inventory?: Array<Item | Weapon | Consumable>;
  gold?: number;
  speed?: number;
  initiativeBonus?: number;
  xp?: number;
  maxHp?: number;
  currentHp?: number;
}
