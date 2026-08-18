import type { CheckRequest, RollResult, EnemyStatBlock, TokenPosition, TurnOrderEntry, AttackResult, SpellAttackResult, SpellSaveResult, CombatVictory } from "./combat.ts";
import type { Dungeon, DungeonEntity } from "./dungeon.ts";
import type { Quest } from "./world.ts";
import type { Weapon } from "./items.ts";
import type { Spell } from "./spells.ts";
import type { Condition, ActiveCondition } from "./conditions.ts";

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

export interface ReactionOfferOption {
  spellName: string;
  /** Who is attacking, and with what — for the prompt copy. */
  attackerName: string;
  sourceName: string;
  /** 'defend' (Shield): boost AC against an incoming hit. 'retaliate' (Hellish Rebuke): cast
   * back at whoever just dealt damage, after the fact. 'opportunity': a plain Attack of
   * Opportunity, not spell-cast at all — spellName is a synthetic label ("Attack of
   * Opportunity") for display, not a real spell lookup. Only 'defend' uses the AC fields below. */
  kind: "defend" | "retaliate" | "opportunity";
  attackTotal?: number;
  /** AC as it stands right now, and what it would become if the reaction is taken. */
  currentAc?: number;
  boostedAc?: number;
}

/**
 * One trigger event (a hit landing, damage taken) can make more than one of a player's known
 * reaction spells eligible at once — the sidebar shows every eligible option side by side
 * rather than prompting for each spell one at a time.
 */
export interface ReactionOffer {
  /** Correlates the offer with the client's response; also the key the server waits on. */
  requestId: string;
  options: ReactionOfferOption[];
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
  /** speedMultiplier is only present when reduced below 1 (Wardaway) — omitted means full/normal speed. */
  "combat:turn": (data: { actorName: string; speedMultiplier?: number; speedBonusFt?: number; buffs?: string[] }) => void;
  "combat:initiative": (entry: TurnOrderEntry) => void;
  "combat:turn:order": (entries: TurnOrderEntry[]) => void;
  "combat:attack:result": (result: AttackResult) => void;
  "combat:attack:blocked": (data: { reason: string }) => void;
  "combat:spell:attack:result": (result: SpellAttackResult) => void;
  "combat:spell:save:result": (result: SpellSaveResult) => void;
  /** Full replacement list, broadcast to everyone (matches chat's own broad emit here) whenever applyCondition/clearCondition touches targetId — lets any client keep a live view of who has what without polling. */
  "character:condition:update": (data: { targetId: string; conditions: ActiveCondition[] }) => void;
  "combat:elevation:update": (data: { targetId: string; elevationFt: number }) => void;
  /** Sent to one player's own socket only — a mid-turn movement grant that isn't the Dash button (Zephyr Strike's "speed +30ft on that attack, hit or miss"). */
  "movement:granted": (data: { ft: number }) => void;
  "combat:condition:escape:result": (result: {
    targetId: string; targetName: string; name: Condition; skill: string;
    roll: number; bonus: number; total: number; dc: number; succeeded: boolean;
  }) => void;
  /** Sent to the investigator's own socket only — RAW's "you see through it" is knowledge specific to them, not public. */
  "combat:illusion:investigate:result": (result: {
    targetId: string; targetName: string;
    tags: { tagName: string; succeeded: boolean; roll: number; bonus: number; total: number; dc: number }[];
  }) => void;
  /** A self-buff (Searing/Thunderous Smite) is now armed on this token, waiting for its next weapon hit — starts its looping aura ring. */
  "combat:effect:aura:start": (data: { casterId: string; casterName: string; color: string; style?: 'fire' | undefined }) => void;
  /** The armed buff was spent on a hit, or expired unused at end of turn — stops its aura ring. */
  "combat:effect:aura:end": (data: { casterId: string; casterName: string }) => void;
  /** A one-shot burst on the target the instant an armed buff's weapon hit lands. */
  "combat:effect:impact": (data: { targetId: string; targetName: string; color: string; style?: 'fire' | undefined }) => void;
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
    tempHp: number;
  }) => void;
  /** Fired by grantTempHpToPlayer — set semantics, not additive (see setTempHp). */
  "combat:player:tempHp": (data: {
    characterId: string;
    characterName: string;
    tempHp: number;
  }) => void;
  /** Fired by applyHealingToPlayer — spell/effect healing (Cure Wounds, Healing Word, ...). */
  "combat:player:heal": (data: {
    characterId: string;
    characterName: string;
    healAmount: number;
    currentHp: number;
    maxHp: number;
    sourceName: string;
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
  /** Fired by startConcentrating/breakConcentration — spellName is null when concentration ends. */
  "combat:concentration": (data: {
    targetId: string;
    targetName: string;
    spellName: string | null;
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
    /** One entry per attack roll — darts (Jim's Magic Missile), blasts (Spellfire Flare), or the
     * plain single-target case (most attack spells) all go through the same array. */
    targetIds: string[];
    spell: Spell;
    slotLevel: number;
    /** Caster's pick when the spell's onHit damage declares damageTypeOptions (Chromatic Orb). Chaos Bolt derives its type from the roll instead, see rollChainableDamage. */
    chosenDamageType?: string;
  }) => void;
  "combat:spell:cast": (payload: {
    casterId: string;
    casterName: string;
    spell: Spell;
    slotLevel: number;
    targetIds: string[];
    chosenDamageType?: string;
    /** Caster's pick when the spell declares commandOptions (Command's Approach/Drop/Flee/Grovel/Halt), or a free-text one-word entry. */
    chosenCommand?: string;
    /** Caster's pick when the spell declares skillOptions (Guidance's chosen skill). */
    chosenSkill?: string;
    /** placesTrap spells only — the grid cell the caster targeted. */
    originGx?: number;
    originGy?: number;
  }) => void;
  "character:equipment:update": (payload: {
    characterId: string;
    slot: "head" | "body" | "gloves" | "boots" | "mainHand" | "offHand";
    itemId: string | null;
  }) => void;
  "consumable:heal": (payload: {
    characterId: string;
    characterName: string;
    /** Dice formula for the amount healed — omit for Potion of Healing's default (2d4+4). */
    healDice?: string;
  }) => void;
  "consumable:used": (payload: { characterId: string; itemId: string }) => void;
  "combat:reaction:respond": (payload: {
    requestId: string;
    /** Which option's spellName was picked, or null to decline/take the hit. */
    spellName: string | null;
  }) => void;
  "combat:condition:add": (payload: { targetId: string; name: Condition }) => void;
  "combat:condition:remove": (payload: { targetId: string; name: Condition }) => void;
  /** Player-initiated escape attempt against a recurringDamage hook's escapeSkillCheck (Ensnaring Strike/Entangle's Restrained) — spends the actor's action. */
  "combat:condition:escape": (payload: { targetId: string; name: Condition }) => void;
  /** Sets a token's height off the ground — dropping it 10+ft triggers fall damage (see applyElevationChange, runtime.ts), gated by any 'Falling'-named damageResistance hook (Feather Fall). */
  "combat:elevation:set": (payload: { targetId: string; elevationFt: number }) => void;
  /** Rolls investigatorId's Investigation against every illusionTag targetId carries (Disguise Self) — result comes back privately via combat:illusion:investigate:result, not broadcast. */
  "combat:illusion:investigate": (payload: { targetId: string; investigatorId: string }) => void;
  /** Marks actorId's movement as not provoking Opportunity Attacks for the rest of this turn (Participant.disengaging, cleared on their next refillResources). */
  "combat:disengage": (payload: { actorId: string }) => void;
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
