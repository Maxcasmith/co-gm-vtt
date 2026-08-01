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
  xp?: number;
  level?: number;
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
  'combat:spell:attack:result': (result: SpellAttackResult) => void;
  'combat:spell:save:result': (result: SpellSaveResult) => void;
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
  'combat:spell:attack': (payload: { casterId: string; casterName: string; targetId: string; spell: Spell; slotLevel: number }) => void;
  'combat:spell:cast': (payload: { casterId: string; casterName: string; spell: Spell; slotLevel: number; targetIds: string[] }) => void;
}

export type StoryProvider = 'claude' | 'openai' | 'deepseek' | 'kimi';
export type ImageModel = 'gpt-image-1' | 'dall-e-3' | 'dall-e-2';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'maximum';

export interface ModelTier {
  provider: StoryProvider;
  model: string;
  effort?: ReasoningEffort;
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
  kimi: string;
}

export interface AppConfig {
  tiers: { light: ModelTier[]; thinking: ModelTier[] };
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
  sessionsPlayed: number;
}

export interface NemesisRecord {
  id: string;
  name: string;
  boundTo: string; // 'party' or a specific character name
  status: 'active' | 'retired';
  deathCount: number;
  cooldownUntilSession: number;
  statBlock: EnemyStatBlock;
  createdAtSession: number;
}

export interface CompendiumMeta {
  slug: string;
  name: string;
  source: string;
  createdAt: string;
  entityCount: { npc: number; creature: number; faction: number; location: number };
  status: 'complete' | 'draft';
  tierKey: 'light' | 'thinking';
  resumeFromChunk: number;
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
  spells?: string[]; // learned spell names
}

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

// One tier of a scaling progression, e.g. { atLevel: 5, value: '2d10' }
export interface ScalingTier { atLevel: number; value: string }

// 'cantrip' scales with character level (5/11/17); 'spell-slot' scales with the slot level cast at.
export interface Scaling { mode: 'cantrip' | 'spell-slot'; base: string; tiers: ScalingTier[] }

export const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled',
  'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned',
  'Prone', 'Restrained', 'Stunned', 'Unconscious',
] as const;
export type Condition = typeof CONDITIONS[number];

export interface EffectSpec {
  type: 'damage' | 'condition';
  damageType?: string;       // Fire, Acid, Force, ...
  scaling?: Scaling;         // present for damage effects
  condition?: Condition;
  duration?: { value: number; unit: 'round' | 'minute' | 'hour' | 'until-save' | 'instant' };
}

export interface SpellCombatMeta {
  resolution: 'attack' | 'save' | 'auto' | 'none';
  attackType?: 'melee' | 'ranged';                        // when resolution === 'attack'
  save?: { ability: AbilityKey; halfOnSave: boolean };    // when resolution === 'save'
  area?: { shape: 'sphere' | 'cone' | 'cube' | 'line' | 'cylinder' | 'emanation'; size: number; width?: number; origin: 'point' | 'self' };
  targets?: number;                                       // discrete non-AoE multi-target (e.g. Magic Missile darts)
  onHit?: EffectSpec[];
  onSave?: EffectSpec[];
}

export interface Spell {
  name: string;
  source: string;
  level: number;       // 0 = cantrip, 1–9 = spell level
  levelLabel: string;  // 'Cantrip' | '1st' | '2nd' | …
  castingTime: string;
  duration: string;
  school: string;      // normalized, e.g. 'Evocation' (ritual stripped out)
  range: string;
  components: string;
  classes: string[];   // canonical class names, e.g. ['Wizard', 'Sorcerer']
  text: string;
  atHigherLevels: string;
  isRitual: boolean;
  combat?: SpellCombatMeta; // GM/engine-only metadata; not for player-facing display
}

export const CLASS_SPELLCASTING_ABILITY: Record<string, AbilityKey> = {
  Artificer: 'int',
  Bard:      'cha',
  Cleric:    'wis',
  Druid:     'wis',
  Paladin:   'cha',
  Ranger:    'wis',
  Sorcerer:  'cha',
  Warlock:   'cha',
  Wizard:    'int',
};

// Canonical source — client/src/character-creation/srd.ts imports this rather than
// keeping its own (uppercase-keyed) copy.
export const CLASS_SAVING_THROWS: Record<string, [AbilityKey, AbilityKey]> = {
  Artificer:  ['int', 'con'],
  Barbarian:  ['str', 'con'],
  Bard:       ['dex', 'cha'],
  Cleric:     ['wis', 'cha'],
  Druid:      ['int', 'wis'],
  Fighter:    ['str', 'con'],
  Monk:       ['str', 'dex'],
  Paladin:    ['wis', 'cha'],
  Ranger:     ['str', 'dex'],
  Rogue:      ['dex', 'int'],
  Sorcerer:   ['con', 'cha'],
  Warlock:    ['wis', 'cha'],
  Wizard:     ['int', 'wis'],
};

/** 'Action' → 'action', 'Bonus Action' → 'bonusAction', reactions → 'reaction'; rituals/long casts → null (not castable mid-combat). */
export function actionCostFromCastingTime(castingTime: string): 'action' | 'bonusAction' | 'reaction' | null {
  const t = castingTime.trim().toLowerCase();
  if (t === 'action') return 'action';
  if (t === 'bonus action') return 'bonusAction';
  if (t.includes('reaction')) return 'reaction';
  return null;
}

/** Parses a spell's `range` field into feet for targeting math. 'Self'→0, 'Touch'→5, 'Sight'/'Unlimited'→Infinity. */
export function parseRangeFeet(range: string): number {
  const t = range.trim().toLowerCase();
  if (t === 'self' || t.startsWith('self (')) return 0;
  if (t === 'touch') return 5;
  if (t === 'sight' || t === 'unlimited') return Infinity;
  const m = t.match(/(\d+)\s*feet/);
  return m ? Number(m[1]) : 0;
}

/**
 * Resolves a Scaling to the dice formula to roll for a caster's level.
 * No spell-slot upcast support yet (no slot-tracking system exists) — spell-slot
 * mode always returns base; cantrip mode picks the highest tier the caster qualifies for.
 */
export function resolveSpellDamageDice(scaling: Scaling | undefined, casterLevel: number): string | undefined {
  if (!scaling) return undefined;
  if (scaling.mode !== 'cantrip') return scaling.base;
  let value = scaling.base;
  for (const tier of scaling.tiers) {
    if (casterLevel >= tier.atLevel) value = tier.value;
  }
  return value;
}

export interface SpellAttackResult {
  attackerName: string;
  targetName: string;
  targetId: string;
  spellName: string;
  d20: number;
  attackBonus: number;
  statBonus: number;
  statName: string;
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

export interface SpellSaveOutcome {
  targetId: string;
  targetName: string;
  isPC: boolean;
  saveBonus: number;
  dc: number;
  saved: boolean;
  damage?: number | undefined;
  conditionsApplied?: string[] | undefined;
  remainingHp?: number | undefined;
  targetDead: boolean;
}

export interface SpellSaveResult {
  casterName: string;
  spellName: string;
  dc: number;
  saveAbility: AbilityKey;
  slotLevel: number;
  outcomes: SpellSaveOutcome[];
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
