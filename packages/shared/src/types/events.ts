import type { CheckRequest, RollResult, EnemyStatBlock, TokenPosition, TurnOrderEntry, AttackResult, SpellAttackResult, SpellSaveResult, CombatVictory } from "./combat.ts";
import type { Dungeon, DungeonEntity } from "./dungeon.ts";
import type { Quest } from "./world.ts";
import type { Weapon } from "./items.ts";
import type { Spell } from "./spells.ts";
import type { Condition, ActiveCondition } from "./conditions.ts";
import type { Manoeuvre } from "./tactics.ts";
import type { StoryboardQueuePayload } from "./storyboard.ts";

export type Player = string;

export interface ChatPayload {
  text: string;
  senderName: string;
  timestamp: number;
  checkRequests?: CheckRequest[];
}

export interface NotePayload {
  text: string;
  authorName: string;
  timestamp: number;
  /** Set when this note was pinned from the Adventure Log rather than typed directly — the
   * character who pinned it. `authorName` stays whoever originally wrote the pinned message. */
  pinnedBy?: string;
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
   * Opportunity") for display, not a real spell lookup. 'protect' (Protection Fighting Style):
   * impose Disadvantage on an attack against a nearby ally, decided before the d20 is rolled —
   * spellName is a synthetic label ("Protection") the same way 'opportunity' uses one. 'luck'
   * (origin feat Lucky): impose Disadvantage on an attack against yourself, same pre-roll timing
   * as 'protect' but self-targeted and spending a Luck Point instead of a reaction — spellName is
   * a synthetic label ("Lucky"). 'swap' (origin feat Alert): the offer to swap rolled Initiative
   * with the requester — attackerName repurposed as the requester's name, spellName a synthetic
   * label ("Alert Swap"). 'luckReroll' (origin feat Lucky, offensive half): the player's own
   * attack just missed — spend a Luck Point to reroll the d20, after the outcome is known.
   * attackerName repurposed as the player's own name, targetName the creature they attacked,
   * attackTotal/currentAc the missed roll and the AC it fell short of. Only 'defend' uses the AC
   * fields below. */
  kind: "defend" | "retaliate" | "opportunity" | "protect" | "luck" | "swap" | "luckReroll";
  attackTotal?: number;
  /** AC as it stands right now, and what it would become if the reaction is taken. */
  currentAc?: number;
  boostedAc?: number;
  /** 'protect' only: who the incoming attack is actually aimed at. */
  targetName?: string;
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
  resourceUses?: Record<string, number>;
  worldEvents?: string;
}

export interface ServerToClientEvents {
  "players:update": (players: Player[]) => void;
  "roll:result": (result: RollResult) => void;
  "chat:message": (payload: ChatPayload) => void;
  "chat:history": (messages: ChatPayload[]) => void;
  "note:added": (payload: NotePayload) => void;
  "note:history": (notes: NotePayload[]) => void;
  "session:state": (active: boolean) => void;
  "session:recap": (payload: {
    text: string;
    senderName: string;
    checkRequests?: CheckRequest[];
  }) => void;
  "dm:thinking": (active: boolean) => void;
  "storyboard:queue": (payload: StoryboardQueuePayload) => void;
  "combat:state": (active: boolean) => void;
  "encounter:generating": () => void;
  "encounter:ready": (enemies: EnemyStatBlock[]) => void;
  "token:moved": (pos: TokenPosition) => void;
  /** speedMultiplier is only present when reduced below 1 (Wardaway) — omitted means full/normal speed. */
  "combat:turn": (data: { actorId: string; actorName: string; speedMultiplier?: number; speedBonusFt?: number; buffs?: string[] }) => void;
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
    isCrit: boolean;
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
  /** Pushed after any AbilityDef spend (combat:ability:use) — mirrors combat:player:slots but for the generic resource pool (Rage charges, Second Wind, ...) instead of spell slots. */
  "combat:player:featureResources": (data: {
    characterId: string;
    resourceUses: Record<string, number>;
  }) => void;
  /** Origin feat Musician granted (or Lucky/roll spend consumed) this player's Heroic Inspiration — sent to their own socket only. */
  "character:inspiration:update": (data: { heroicInspiration: boolean }) => void;
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
  /**
   * A concentration-sustained curse (Hunter's Mark, Hex) target-locking or releasing one
   * creature — drives the "marked" token icon. `active: false` fires from the same
   * breakConcentration teardown that clears the caster's Concentrating condition, so a redirect
   * (recasting on a new target) always clears the old icon before the new one is offered.
   */
  "combat:mark": (data: {
    casterId: string;
    targetId: string;
    targetName: string;
    spellName: string;
    active: boolean;
  }) => void;
  /** Rage activating/ending on a creature — drives the "raging" token icon. */
  "combat:raging": (data: {
    targetId: string;
    targetName: string;
    active: boolean;
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
  "character:tactics:update": (data: { characterId: string; tactics: Manoeuvre[]; aiControlled: boolean }) => void;
  /** Broadcast to the whole room (unlike tactics:update above, which is private to the owner) so every client's party roster can show the AI pip / offline styling live. */
  "character:aiControlled:update": (data: { characterId: string; aiControlled: boolean }) => void;
  "character:currency:update": (data: { characterId: string }) => void;
  "dungeon:generating": () => void;
  "dungeon:loaded": (dungeon: Dungeon) => void;
  "dungeon:cleared": () => void;
  /** `final`: true only when this update closed out a dungeon's questChain's last stage — the whole questline is done, not just one stage of it. Unset/false for every intermediate stage and for non-chain quest updates. */
  "quest:update": (data: { quests: Quest[]; act: number; final?: boolean }) => void;
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
    /** Origin feat Lucky — spend a Luck Point for Advantage on this roll. */
    useLuckPoint?: boolean;
    /** Spend Heroic Inspiration for Advantage on this roll. */
    useInspiration?: boolean;
  }) => void;
  "roll:save": (payload: {
    campaignId: string;
    characterId: string;
    stat: string;
    /** Origin feat Lucky — spend a Luck Point for Advantage on this roll. */
    useLuckPoint?: boolean;
    /** Spend Heroic Inspiration for Advantage on this roll. */
    useInspiration?: boolean;
  }) => void;
  "spell:cast:exploration": (payload: {
    campaignId: string;
    characterId: string;
    spellName: string;
  }) => void;
  "chat:message": (payload: { text: string; senderName: string }) => void;
  "note:add": (payload: { text: string; authorName: string; pinnedBy?: string }) => void;
  "session:start": (payload: { campaignId: string }) => void;
  "session:end": (payload: { campaignId: string }) => void;
  "token:move": (pos: TokenPosition) => void;
  /** Toggles a door open/closed — a no-op server-side if it's locked or the requester isn't within 5ft of it. See toggleDoor. */
  "door:toggle": (payload: { campaignId: string; doorId: string; characterName: string }) => void;
  /** Warps the requester to the paired stairs entity's coordinates — a no-op server-side if the requester isn't within 5ft of it. See useStairs. */
  "stairs:use": (payload: { campaignId: string; stairsId: string; characterName: string }) => void;
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
    /** Origin feat Lucky — spend a Luck Point for Advantage on this roll. */
    useLuckPoint?: boolean;
    /** Spend Heroic Inspiration for Advantage on this roll. */
    useInspiration?: boolean;
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
  /** Generic "use ability" action (AbilityDef, abilities.ts) — Rage, Second Wind, Bardic Inspiration, ... — the counterpart to combat:attack/combat:spell:cast for class features that are neither. */
  "combat:ability:use": (payload: {
    casterId: string;
    casterName: string;
    abilityKey: string;
    /** Required when the AbilityDef's target is 'ally' (Bardic Inspiration) — who onUse/hooks apply to. Ignored for 'self' abilities. */
    targetId?: string;
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
  /** Lockpick — a real DEX ("Thieves' Tools") check rolled server-side against the nearest locked door in range. Result arrives as chat messages, not a dedicated event (see resolveLockpickAttempt). */
  "consumable:lockpick": (payload: { characterId: string; characterName: string }) => void;
  /** Trap Disarm Kit — same convention as consumable:lockpick, rolled against the nearest discovered trap in range. */
  "consumable:trapdisarm": (payload: { characterId: string; characterName: string }) => void;
  "character:tactics:update": (payload: { characterId: string; tactics: Manoeuvre[]; aiControlled: boolean }) => void;
  "combat:reaction:respond": (payload: {
    requestId: string;
    /** Which option's spellName was picked, or null to decline/take the hit. */
    spellName: string | null;
  }) => void;
  /** Origin feat Alert — request to swap your rolled Initiative with a willing ally's, once per combat. The ally is offered an accept/decline via combat:reaction:offer (kind 'swap'). */
  "combat:alert:swap": (payload: { campaignId: string; characterId: string; targetId: string }) => void;
  /** Origin feat Healer — Utilize action, expend a Healer's Kit use to tend an ally within 5ft. */
  "combat:healerKit:use": (payload: { casterId: string; casterName: string; targetId: string }) => void;
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
    /** Origin feat Crafter — one FAST_CRAFTING_TABLE name, only honored on a Long Rest. */
    craftedItem?: string;
    /** Origin feat Musician — play an instrument to grant Heroic Inspiration to nearby allies. */
    grantInspiration?: boolean;
  }) => void;
  "rest:cancel": (payload: { campaignId: string; characterId: string }) => void;
}
