import type { EnemyStatBlock, TokenPosition, Weapon, Spell, Consumable, TurnOrderEntry, AttackResult, SpellAttackResult, SpellSaveResult, SpellSaveOutcome, CombatVictory, CheckRequest, RollResult, Dungeon, ReactionOffer, Condition } from 'shared';

// ── Payload types ─────────────────────────────────────────────────────────────
//
// Each event has exactly one payload interface defined here.
// To add an event: define the payload, then add it to VTTEventMap.

export interface ChatMessageSentPayload {
  text: string;
  senderName: string;
  timestamp: number;
}

export interface SheetItemInspectedPayload {
  /** Broad category of the item — drives how the canvas and other listeners respond. */
  itemType: 'ability' | 'skill' | 'feature' | 'spell' | 'equipment';
  /** Stable machine key (e.g. "athletics", "second-wind") — use for lookups, not display. */
  itemKey: string;
  /** Human-readable name for display. */
  itemName: string;
  /** Current value or modifier where relevant (e.g. "+4", "1d10"). */
  value?: string | number;
}

export interface SheetOpenedPayload {
  characterId: string;
}

// ponytail: empty payload — payload shape reserved for future use (e.g. close reason)
export type SheetClosedPayload       = Record<string, never>;
export type RestOpenPayload          = Record<string, never>;
export type RestRequestPayload       = Record<string, never>;
export interface RestChoicePayload { resting: boolean; restType: 'short' | 'long'; hitDiceSpent: number }
export type RestCancelPayload         = Record<string, never>;
export interface RestProgressPayload { allCommitted: boolean }
export type EncounterGeneratingPayload = Record<string, never>;
export interface EncounterReadyPayload { enemies: EnemyStatBlock[] }

export interface CombatStatePayload { active: boolean }
export type TargetingStartPayload =
  | { kind: 'weapon'; weapon: Weapon; actionType: 'action' | 'bonusAction' | 'reaction'; bonusSpell?: Spell }
  | { kind: 'spell'; spell: Spell; casterId: string; actionType: 'action' | 'bonusAction' | 'reaction'; slotLevel?: number; chosenDamageType?: string; chosenCommand?: string; chosenSkill?: string; casterLevel?: number };
export type TargetingCancelPayload = Record<string, never>;
export interface CombatAttackPayload { attackerName: string; attackerId: string; targetId: string; targetName: string; weapon: Weapon; bonusSpell?: Spell }
export interface CombatAttackResultPayload extends AttackResult {}
export interface CombatSpellAttackPayload { casterName: string; casterId: string; targetIds: string[]; spell: Spell; slotLevel: number; chosenDamageType?: string }
export interface CombatSpellAttackResultPayload extends SpellAttackResult {}
export interface CombatSpellCastPayload { casterName: string; casterId: string; spell: Spell; slotLevel: number; targetIds: string[]; chosenDamageType?: string; chosenCommand?: string; chosenSkill?: string; originGx?: number; originGy?: number }
export interface CombatSpellSaveResultPayload extends SpellSaveResult {}
export interface CombatEffectAuraStartPayload { casterId: string; casterName: string; color: string; style?: 'fire' | undefined }
export interface CombatEffectAuraEndPayload { casterId: string; casterName: string }
export interface CombatEffectImpactPayload { targetId: string; targetName: string; color: string; style?: 'fire' | undefined }
export interface CreatureUpdatePayload { id: string; currentHp: number; maxHp: number; effects: string[] }
export interface CombatVictoryPayload extends CombatVictory {}
export interface PlayerDamagePayload { characterId: string; characterName: string; damage: number; currentHp: number; maxHp: number; tempHp: number }
export interface PlayerTempHpPayload { characterId: string; characterName: string; tempHp: number }
export interface PlayerHealPayload { characterId: string; characterName: string; healAmount: number; currentHp: number; maxHp: number; sourceName: string }
export interface DamageDealtPayload { targetId: string; targetName: string; damage: number }
export interface CombatConcentrationPayload { targetId: string; targetName: string; spellName: string | null }
export interface PlayerSlotsPayload { characterId: string; currentSpellSlots1: number; maxSpellSlots1: number }
export interface RestResultPayload { resting: boolean; restType: 'short' | 'long'; currentHp?: number; maxHp?: number; hpGained?: number; currentSpellSlots1?: number; maxSpellSlots1?: number; worldEvents?: string }
export interface DeathSavePayload { characterName: string; roll: number; isNatural20: boolean; isNatural1: boolean; success: boolean; successes: number; failures: number; stable: boolean; dead: boolean }
export type CombatDefeatPayload = Record<string, never>;
export interface PlayerDeadPayload { characterId: string; characterName: string }
export interface ConsumableUsedPayload { item: Consumable; characterId: string }
export interface ConsumableHealPayload { characterId: string; characterName: string; healDice?: string }
export interface ConsumableHealResultPayload { characterId: string; characterName: string; healAmount: number; currentHp: number; maxHp: number }
export interface EquipmentUpdatePayload { characterId: string; slot: 'head' | 'body' | 'gloves' | 'boots' | 'mainHand' | 'offHand'; itemId: string | null }
export interface CombatTurnPayload { actorName: string; speedMultiplier?: number; speedBonusFt?: number; buffs?: string[] }
export type CombatTurnEndPayload = Record<string, never>
export interface ConditionEscapeAttemptPayload { targetId: string; name: Condition }
export interface ElevationSetPayload { targetId: string; elevationFt: number }
export interface DisengagePayload { actorId: string }
export interface CombatInitiativePayload { entry: TurnOrderEntry }
export interface CombatInitiativeRollPayload { entry: TurnOrderEntry }
export interface CombatTurnOrderPayload { entries: TurnOrderEntry[] }
export interface MovementUsedPayload  { ft: number }
/** Server is holding an attack open, waiting to hear whether this player spends their reaction. */
export type ReactionOfferPayload = ReactionOffer;
export interface ReactionClosePayload { requestId: string }
/** Server-authoritative action economy for one character, pushed on refill and after each spend. */
export interface PlayerResourcesPayload {
  characterId: string;
  actionsRemaining: number;
  bonusActionsRemaining: number;
  reactionsRemaining: number;
}
export interface MovementGainedPayload { ft: number }
export interface ViewportChangedPayload { x: number; y: number; zoom: number }
export type CombatActionSpentPayload = Record<string, never>
export type CombatBonusActionSpentPayload = Record<string, never>
export type CombatReactionSpentPayload = Record<string, never>
export interface CombatLogTextPayload { kind: 'text'; text: string; timestamp: number }
export interface CombatLogAttackPayload {
  kind: 'attack';
  timestamp: number;
  attackerName: string;
  weaponName: string;
  d20: number;
  statBonus: number;
  statName: string;
  weaponBonus: number;
  total: number;
  ac: number;
  hit: boolean;
  damage?: number;
  damageRoll?: number;
  damageType?: string;
  damageFormula?: string;
  bonusSpellName?: string;
  bonusDamage?: number;
  bonusDamageType?: string;
  targetName: string;
}
export interface CombatLogSpellAttackPayload {
  kind: 'spell-attack';
  timestamp: number;
  attackerName: string;
  spellName: string;
  d20: number;
  statBonus: number;
  statName: string;
  total: number;
  ac: number;
  hit: boolean;
  damage?: number;
  damageRoll?: number;
  damageType?: string;
  damageFormula?: string;
  targetName: string;
}
export interface CombatLogSpellSavePayload {
  kind: 'spell-save';
  timestamp: number;
  casterName: string;
  spellName: string;
  dc: number;
  outcomes: SpellSaveOutcome[];
}
export type CombatLogPayload = CombatLogTextPayload | CombatLogAttackPayload | CombatLogSpellAttackPayload | CombatLogSpellSavePayload;

export interface RollRequestPayload {
  characterId: string;
  campaignId: string;
  /** Lowercase stat key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' */
  stat: string;
  /** Specific skill name (e.g. 'Acrobatics') — present for skill checks, absent for raw stat checks */
  skill?: string;
}

export interface ChatMessageReceivedPayload {
  text: string;
  senderName: string;
  timestamp: number;
  variant?: 'recap';
  checkRequests?: CheckRequest[];
}

export type RollResultPayload = RollResult;

// ── Event registry ────────────────────────────────────────────────────────────
//
// Single source of truth: every VTT event name maps to its payload type.
// TypeScript will catch unknown event names and mismatched payloads at compile time.

export interface VTTEventMap {
  'vtt:chat:message-sent':      ChatMessageSentPayload;
  'vtt:chat:message-received':  ChatMessageReceivedPayload;
  'vtt:sheet:item-inspected':   SheetItemInspectedPayload;
  'vtt:sheet:opened':           SheetOpenedPayload;
  'vtt:sheet:closed':           SheetClosedPayload;
  'vtt:roll:check':             RollRequestPayload;
  'vtt:roll:save':              RollRequestPayload;
  'vtt:roll:result':            RollResultPayload;
  'vtt:rest:open':              RestOpenPayload;
  'vtt:rest:request':           RestRequestPayload;
  'vtt:rest:choice':            RestChoicePayload;
  'vtt:rest:cancel':            RestCancelPayload;
  'vtt:rest:progress':          RestProgressPayload;
  'vtt:combat:state':           CombatStatePayload;
  'vtt:encounter:generating':   EncounterGeneratingPayload;
  'vtt:encounter:ready':        EncounterReadyPayload;
  'vtt:token:move':             TokenPosition;
  'vtt:token:moved':            TokenPosition;
  'vtt:targeting:start':        TargetingStartPayload;
  'vtt:targeting:cancel':       TargetingCancelPayload;
  'vtt:combat:attack':          CombatAttackPayload;
  'vtt:combat:attack:result':   CombatAttackResultPayload;
  'vtt:combat:spell:attack':        CombatSpellAttackPayload;
  'vtt:combat:spell:attack:result': CombatSpellAttackResultPayload;
  'vtt:combat:spell:cast':          CombatSpellCastPayload;
  'vtt:combat:spell:save:result':   CombatSpellSaveResultPayload;
  'vtt:combat:effect:aura:start': CombatEffectAuraStartPayload;
  'vtt:combat:effect:aura:end':   CombatEffectAuraEndPayload;
  'vtt:combat:effect:impact':     CombatEffectImpactPayload;
  'vtt:creature:update':        CreatureUpdatePayload;
  'vtt:combat:victory':         CombatVictoryPayload;
  'vtt:combat:player:damage':   PlayerDamagePayload;
  'vtt:combat:player:tempHp':   PlayerTempHpPayload;
  'vtt:combat:player:heal':     PlayerHealPayload;
  'vtt:combat:damage:dealt':    DamageDealtPayload;
  'vtt:combat:concentration':   CombatConcentrationPayload;
  'vtt:combat:player:slots':    PlayerSlotsPayload;
  'vtt:rest:result':            RestResultPayload;
  'vtt:combat:death:save':      DeathSavePayload;
  'vtt:combat:defeat':          CombatDefeatPayload;
  'vtt:combat:player:dead':     PlayerDeadPayload;
  'vtt:consumable:used':        ConsumableUsedPayload;
  'vtt:consumable:heal':        ConsumableHealPayload;
  'vtt:consumable:heal:result': ConsumableHealResultPayload;
  'vtt:equipment:update':       EquipmentUpdatePayload;
  'vtt:combat:turn':            CombatTurnPayload;
  'vtt:combat:turn:end':        CombatTurnEndPayload;
  'vtt:condition:escape:attempt': ConditionEscapeAttemptPayload;
  'vtt:combat:elevation:set': ElevationSetPayload;
  'vtt:combat:disengage': DisengagePayload;
  'vtt:combat:initiative':      CombatInitiativePayload;
  'vtt:combat:initiative:roll': CombatInitiativeRollPayload;
  'vtt:combat:turn:order':      CombatTurnOrderPayload;
  'vtt:combat:player:resources': PlayerResourcesPayload;
  'vtt:combat:reaction:offer':  ReactionOfferPayload;
  'vtt:combat:reaction:close':  ReactionClosePayload;
  'vtt:movement:used':          MovementUsedPayload;
  'vtt:movement:gained':        MovementGainedPayload;
  'vtt:combat:action:spent':    CombatActionSpentPayload;
  'vtt:combat:bonusAction:spent': CombatBonusActionSpentPayload;
  'vtt:combat:reaction:spent':    CombatReactionSpentPayload;
  'vtt:combat:log':             CombatLogPayload;
  'vtt:dungeon:loaded':         Dungeon;
  'vtt:viewport:changed':       ViewportChangedPayload;
}

// ── Core API ──────────────────────────────────────────────────────────────────

/** Fire a VTT event with a fully-typed payload. */
export function dispatch<K extends keyof VTTEventMap>(
  type: K,
  detail: VTTEventMap[K],
): void {
  window.dispatchEvent(new CustomEvent(type, { detail, bubbles: false }));
}

/**
 * Subscribe to a VTT event.
 * Returns an unsubscribe function — drop it directly into useEffect's return:
 *
 *   useEffect(() => on('vtt:chat:message-sent', handler), []);
 */
export function on<K extends keyof VTTEventMap>(
  type: K,
  handler: (detail: VTTEventMap[K]) => void,
): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<VTTEventMap[K]>).detail);
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}
