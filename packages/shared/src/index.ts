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

export interface CheckRequest {
  player: string;
  skill: string;
  type: 'check' | 'save';
}

export interface DungeonRoom {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DungeonEntity {
  id: string;
  type: 'creature' | 'loot';
  x: number;
  y: number;
  name: string;
}

export interface Dungeon {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: number[][];
  rooms: DungeonRoom[];
  entities: DungeonEntity[];
}

export interface ChatPayload {
  text: string;
  senderName: string;
  timestamp: number;
  checkRequests?: CheckRequest[];
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
  teamId: string;
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
}

export interface CombatVictory {
  xpPerPlayer: number;
  totalXp: number;
  kills: string[];
}

export interface ServerToClientEvents {
  'players:update': (players: Player[]) => void;
  'roll:result': (result: RollResult) => void;
  'chat:message': (payload: ChatPayload) => void;
  'chat:history': (messages: ChatPayload[]) => void;
  'session:state': (active: boolean) => void;
  'session:recap': (payload: { text: string; senderName: string; checkRequests?: CheckRequest[] }) => void;
  'dm:thinking': (active: boolean) => void;
  'combat:state': (active: boolean) => void;
  'map:generating': () => void;
  'map:generated': (mapId: string) => void;
  'encounter:generating': () => void;
  'encounter:ready': (enemies: EnemyStatBlock[]) => void;
  'token:moved': (pos: TokenPosition) => void;
  'combat:turn': (data: { actorName: string }) => void;
  'combat:initiative': (entry: TurnOrderEntry) => void;
  'combat:turn:order': (entries: TurnOrderEntry[]) => void;
  'combat:attack:result': (result: AttackResult) => void;
  'creature:update': (data: { id: string; currentHp: number; maxHp: number; effects: string[] }) => void;
  'combat:victory': (data: CombatVictory) => void;
  'combat:player:damage': (data: { characterId: string; characterName: string; damage: number; currentHp: number; maxHp: number }) => void;
  'rest:result': (data: { currentHp: number; maxHp: number; hpGained?: number; worldEvents?: string }) => void;
  'combat:death:save': (data: { characterName: string; roll: number; isNatural20: boolean; isNatural1: boolean; success: boolean; successes: number; failures: number; stable: boolean; dead: boolean }) => void;
  'combat:defeat': () => void;
  'combat:player:dead': (data: { characterId: string; characterName: string }) => void;
  'combat:log': (data: { text: string; timestamp: number }) => void;
  'players:characters': (map: Record<string, string>) => void;
  'character:inventory:add': (items: unknown[]) => void;
  'dungeon:loaded': (dungeon: Dungeon) => void;
  'quest:update': (data: { quests: Quest[]; act: number }) => void;
  'clock:update': (data: { worldTimeSecs: number }) => void;
}

export interface ClientToServerEvents {
  'player:join': (payload: { name: Player; id: string; campaignId: string }) => void;
  'roll:check': (payload: { campaignId: string; characterId: string; stat: string; skill?: string }) => void;
  'roll:save': (payload: { campaignId: string; characterId: string; stat: string }) => void;
  'chat:message': (payload: { text: string; senderName: string }) => void;
  'session:start': (payload: { campaignId: string }) => void;
  'session:end': (payload: { campaignId: string }) => void;
  'token:move': (pos: TokenPosition) => void;
  'combat:turn:end': () => void;
  'combat:initiative:roll': (entry: TurnOrderEntry) => void;
  'combat:attack': (payload: { attackerId: string; attackerName: string; targetId: string; weapon: Weapon }) => void;
}

export type StoryProvider = 'claude' | 'openai' | 'deepseek';
export type ImageModel = 'gpt-image-1' | 'dall-e-3' | 'dall-e-2';

export interface ModelTier {
  provider: StoryProvider;
  model: string;
}

export interface ImageConfig {
  model: ImageModel;
  generateMaps: boolean;
  generateWorldMap: boolean;
}

export type NarrationModel = 'none' | 'browser' | 'tts-1' | 'tts-1-hd';

export interface NarrationConfig {
  model: NarrationModel;
  voice: string;
}

export interface ApiKeys {
  openai: string;
  anthropic: string;
  deepseek: string;
}

export interface AppConfig {
  tiers: { light: ModelTier; thinking: ModelTier };
  tasks: { story: 'light' | 'thinking'; combat: 'light' | 'thinking' };
  apiKeys: ApiKeys;
  image: ImageConfig;
  narration: NarrationConfig;
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
  type: 'campaign' | 'one-shot' | 'dungeon-crawl' | 'module';
  concept?: { name: string; description: string };
  tags?: string[];
  adventureSlug?: string;
}

export interface Quest {
  id: string;
  name: string;
  description: string;
  status: 'undiscovered' | 'open' | 'resolved';
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
}

export interface CompendiumMeta {
  slug: string;
  name: string;
  source: string;
  createdAt: string;
  entityCount: { npc: number; creature: number; faction: number; location: number };
}

export interface CharacterStats {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

// ── Item class hierarchy ──────────────────────────────────────────────────────
// All item subtypes extend Item. Plain-object constructors (single props arg)
// so instances serialize cleanly to/from JSON without custom toJSON logic.

export class Item {
  id: string;
  name: string;
  description: string;
  quantity: number;
  type?: string;

  constructor(props: { id: string; name: string; description: string; quantity: number; type?: string }) {
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.quantity = props.quantity;
    this.type = props.type;
  }
}

export class Weapon extends Item {
  declare type: 'weapon';
  damage: string;
  damageType: string;
  attackBonus: number;
  range: number;
  extendedRange?: number;
  properties: string[];
  isFinesse: boolean;
  mastery?: string;

  constructor(props: { id: string; name: string; description: string; quantity: number; damage: string; damageType: string; attackBonus: number; range: number; extendedRange?: number; properties: string[]; isFinesse?: boolean; mastery?: string }) {
    super({ ...props, type: 'weapon' as const });
    this.damage = props.damage;
    this.damageType = props.damageType;
    this.attackBonus = props.attackBonus;
    this.range = props.range;
    this.extendedRange = props.extendedRange;
    this.properties = props.properties;
    this.isFinesse = props.isFinesse ?? false;
    this.mastery = props.mastery;
  }
}

export class Armor extends Item {
  declare type: 'armor';
  armorType: 'light' | 'medium' | 'heavy' | 'none';
  acBonus: number;
  isShield: boolean;

  constructor(props: { id: string; name: string; description: string; quantity: number; armorType: 'light' | 'medium' | 'heavy' | 'none'; acBonus: number; isShield: boolean }) {
    super({ ...props, type: 'armor' as const });
    this.armorType = props.armorType;
    this.acBonus = props.acBonus;
    this.isShield = props.isShield;
  }
}

export class Consumable extends Item {
  declare type: 'consumable';
  effect: string;
  actionCost: 'action' | 'bonusAction';

  constructor(props: { id: string; name: string; description: string; quantity: number; effect: string; actionCost: 'action' | 'bonusAction' }) {
    super({ ...props, type: 'consumable' as const });
    this.effect = props.effect;
    this.actionCost = props.actionCost;
  }
}

export class Ammunition extends Item {
  declare type: 'ammunition';
  usableBySlug: string;

  constructor(props: { id: string; name: string; description: string; quantity: number; usableBySlug: string }) {
    super({ ...props, type: 'ammunition' as const });
    this.usableBySlug = props.usableBySlug;
  }
}

// Discriminant-based guards — not instanceof, since items cross the socket/JSON
// boundary as plain objects and won't satisfy instanceof on the receiving side.
export function isWeapon(item: Item): item is Weapon { return item.type === 'weapon'; }
export function isArmor(item: Item): item is Armor { return item.type === 'armor'; }
export function isConsumable(item: Item): item is Consumable { return item.type === 'consumable'; }
export function isAmmunition(item: Item): item is Ammunition { return item.type === 'ammunition'; }

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
  inventory?: Array<Item | Weapon | Armor | Consumable | Ammunition>;
  gold?: number;
  speed?: number;
  initiativeBonus?: number;
  xp?: number;
  level?: number;
  proficiencyBonus?: number;
  maxHp?: number;
  currentHp?: number;
}

export type WeaponProficiency = 'simple' | 'martial';
export type ArmorTraining = 'light' | 'medium' | 'heavy' | 'shield';

export const CLASS_WEAPON_PROFS: Record<string, WeaponProficiency[]> = {
  Artificer:  ['simple'],
  Barbarian:  ['simple', 'martial'],
  Bard:       ['simple'],
  Cleric:     ['simple'],
  Druid:      ['simple'],
  Fighter:    ['simple', 'martial'],
  Monk:       ['simple'],
  Paladin:    ['simple', 'martial'],
  Ranger:     ['simple', 'martial'],
  Rogue:      ['simple'],
  Sorcerer:   ['simple'],
  Warlock:    ['simple'],
  Wizard:     ['simple'],
};

export const CLASS_ARMOR_TRAINING: Record<string, ArmorTraining[]> = {
  Artificer:  ['light', 'medium', 'shield'],
  Barbarian:  ['light', 'medium', 'shield'],
  Bard:       ['light'],
  Cleric:     ['light', 'medium', 'shield'],
  Druid:      ['light', 'medium', 'shield'],
  Fighter:    ['light', 'medium', 'heavy', 'shield'],
  Monk:       [],
  Paladin:    ['light', 'medium', 'heavy', 'shield'],
  Ranger:     ['light', 'medium', 'shield'],
  Rogue:      ['light'],
  Sorcerer:   [],
  Warlock:    ['light'],
  Wizard:     [],
};

function statMod(score: number) { return Math.floor((score - 10) / 2); }

/** Compute a character's AC from their inventory armor, applying D&D 5e dex-mod rules per armor type. */
export function calcAC(character: Character): number {
  const dex = statMod(character.stats.dex);
  const inv = character.inventory ?? [];

  // Find the first non-shield armor and any shield
  const bodyArmor = inv.find((i): i is Armor => i.type === 'armor' && !(i as Armor).isShield) as Armor | undefined;
  const shield    = inv.find((i): i is Armor => i.type === 'armor' && (i as Armor).isShield)  as Armor | undefined;
  const shieldAc  = shield ? (shield as Armor).acBonus : 0;

  if (!bodyArmor) {
    // Unarmored — class special cases
    if (character.class === 'Barbarian') return 10 + dex + statMod(character.stats.con) + shieldAc;
    if (character.class === 'Monk')      return 10 + dex + statMod(character.stats.wis);
    return 10 + dex + shieldAc;
  }

  const base = (bodyArmor as Armor).acBonus;
  switch ((bodyArmor as Armor).armorType) {
    case 'light':  return base + dex + shieldAc;
    case 'medium': return base + Math.min(dex, 2) + shieldAc;
    case 'heavy':  return base + shieldAc;
    default:       return base + dex + shieldAc;
  }
}
