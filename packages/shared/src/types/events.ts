import type { CheckRequest, RollResult, EnemyStatBlock, TokenPosition, TurnOrderEntry, AttackResult, SpellAttackResult, SpellSaveResult, CombatVictory } from "./combat.ts";
import type { Dungeon, DungeonEntity } from "./dungeon.ts";
import type { Quest } from "./world.ts";
import type { Weapon } from "./items.ts";
import type { Spell } from "./spells.ts";
import type { Condition } from "./conditions.ts";

export type Player = string;

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

export interface ReactionOffer {
  /** Correlates the offer with the client's response; also the key the server waits on. */
  requestId: string;
  spellName: string;
  /** Who is attacking, and with what — for the prompt copy. */
  attackerName: string;
  sourceName: string;
  attackTotal: number;
  /** AC as it stands right now, and what it would become if the reaction is taken. */
  currentAc: number;
  boostedAc: number;
  /** How long the client has to answer before the server auto-declines. */
  expiresInMs: number;
}

export interface RestResultBroadcast {
  characterId: string;
  characterName: string;
  resting: boolean;
  restType: "short" | "long";
  hpGained?: number;
  currentHp?: number;
  maxHp?: number;
  currentSpellSlots1?: number;
  maxSpellSlots1?: number;
  worldEvents?: string;
}

export interface ServerToClientEvents {
  "players:update": (players: Player[]) => void;
  "roll:result": (result: RollResult) => void;
  "chat:message": (payload: ChatPayload) => void;
  "chat:history": (messages: ChatPayload[]) => void;
  "session:state": (active: boolean) => void;
  "session:recap": (payload: {
    text: string;
    senderName: string;
    checkRequests?: CheckRequest[];
  }) => void;
  "dm:thinking": (active: boolean) => void;
  "combat:state": (active: boolean) => void;
  "encounter:generating": () => void;
  "encounter:ready": (enemies: EnemyStatBlock[]) => void;
  "token:moved": (pos: TokenPosition) => void;
  "combat:turn": (data: { actorName: string }) => void;
  "combat:initiative": (entry: TurnOrderEntry) => void;
  "combat:turn:order": (entries: TurnOrderEntry[]) => void;
  "combat:attack:result": (result: AttackResult) => void;
  "combat:attack:blocked": (data: { reason: string }) => void;
  "combat:spell:attack:result": (result: SpellAttackResult) => void;
  "combat:spell:save:result": (result: SpellSaveResult) => void;
  "creature:update": (data: {
    id: string;
    currentHp: number;
    maxHp: number;
    effects: string[];
  }) => void;
  "combat:victory": (data: CombatVictory) => void;
  "combat:player:damage": (data: {
    characterId: string;
    characterName: string;
    damage: number;
    currentHp: number;
    maxHp: number;
  }) => void;
  /** Fired by applyDamageToPlayer/applyDamageToCreature — the one signal every damage source
   * (weapon hit, spell hit, spell-save damage, recurring ticks) sends for client-side visual
   * feedback (float + flash), instead of each caller having to remember to draw its own. */
  "combat:damage:dealt": (data: {
    targetId: string;
    targetName: string;
    damage: number;
  }) => void;
  /** The acting player's remaining action economy, pushed on refill and after every spend. */
  "combat:player:resources": (data: {
    characterId: string;
    actionsRemaining: number;
    bonusActionsRemaining: number;
    reactionsRemaining: number;
  }) => void;
  "combat:player:slots": (data: {
    characterId: string;
    currentSpellSlots1: number;
    maxSpellSlots1: number;
  }) => void;
  "consumable:heal:result": (data: {
    characterId: string;
    characterName: string;
    healAmount: number;
    currentHp: number;
    maxHp: number;
  }) => void;
  "combat:death:save": (data: {
    characterName: string;
    roll: number;
    isNatural20: boolean;
    isNatural1: boolean;
    success: boolean;
    successes: number;
    failures: number;
    stable: boolean;
    dead: boolean;
  }) => void;
  "combat:defeat": () => void;
  "combat:player:dead": (data: {
    characterId: string;
    characterName: string;
  }) => void;
  /**
   * Sent to a single player mid-attack-resolution, offering a reaction that would change the
   * outcome (Shield). The attack is NOT broadcast until this resolves or times out, so the
   * client never sees a hit that later becomes a miss.
   */
  "combat:reaction:offer": (data: ReactionOffer) => void;
  /** Withdraws a pending offer — it timed out, or the window closed for another reason. */
  "combat:reaction:close": (data: { requestId: string }) => void;
  "combat:log": (data: { text: string; timestamp: number }) => void;
  "players:characters": (map: Record<string, string>) => void;
  "character:inventory:add": (items: unknown[]) => void;
  "character:inventory:remove": (data: {
    itemId: string;
    quantity: number;
  }) => void;
  "character:equipment:update": (data: {
    characterId: string;
    slot: "head" | "body" | "gloves" | "boots" | "mainHand" | "offHand";
    itemId: string | null;
  }) => void;
  "dungeon:generating": () => void;
  "dungeon:loaded": (dungeon: Dungeon) => void;
  "dungeon:cleared": () => void;
  "quest:update": (data: { quests: Quest[]; act: number }) => void;
  "clock:update": (data: { worldTimeSecs: number }) => void;
  "rest:open": () => void;
  "rest:result": (payload: RestResultBroadcast) => void;
  "rest:progress": (payload: { allCommitted: boolean }) => void;
}

export interface ClientToServerEvents {
  "player:join": (payload: {
    name: Player;
    id: string;
    campaignId: string;
  }) => void;
  "roll:check": (payload: {
    campaignId: string;
    characterId: string;
    stat: string;
    skill?: string;
  }) => void;
  "roll:save": (payload: {
    campaignId: string;
    characterId: string;
    stat: string;
  }) => void;
  "chat:message": (payload: { text: string; senderName: string }) => void;
  "session:start": (payload: { campaignId: string }) => void;
  "session:end": (payload: { campaignId: string }) => void;
  "token:move": (pos: TokenPosition) => void;
  "combat:turn:end": () => void;
  "combat:initiative:roll": (entry: TurnOrderEntry) => void;
  "combat:attack": (payload: {
    attackerId: string;
    attackerName: string;
    targetId: string;
    weapon: Weapon;
    // Present when bundling a one-shot self-buff smite spell (e.g. Divine Smite) into this
    // same attack — cast (bonus action) and attack (action) resolved together, one hit.
    bonusSpell?: Spell;
  }) => void;
  "combat:spell:attack": (payload: {
    casterId: string;
    casterName: string;
    targetId: string;
    spell: Spell;
    slotLevel: number;
  }) => void;
  "combat:spell:cast": (payload: {
    casterId: string;
    casterName: string;
    spell: Spell;
    slotLevel: number;
    targetIds: string[];
  }) => void;
  "character:equipment:update": (payload: {
    characterId: string;
    slot: "head" | "body" | "gloves" | "boots" | "mainHand" | "offHand";
    itemId: string | null;
  }) => void;
  "consumable:heal": (payload: {
    characterId: string;
    characterName: string;
  }) => void;
  "consumable:used": (payload: { characterId: string; itemId: string }) => void;
  "combat:reaction:respond": (payload: {
    requestId: string;
    accepted: boolean;
  }) => void;
  "combat:condition:add": (payload: { targetId: string; name: Condition }) => void;
  "combat:condition:remove": (payload: { targetId: string; name: Condition }) => void;
  "rest:open": () => void;
  "rest:choice": (payload: {
    campaignId: string;
    characterId: string;
    resting: boolean;
    restType: "short" | "long";
    hitDiceSpent: number;
  }) => void;
  "rest:cancel": (payload: { campaignId: string; characterId: string }) => void;
}
