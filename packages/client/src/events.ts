import type { EnemyStatBlock, TokenPosition, Weapon, Consumable, TurnOrderEntry, AttackResult, CombatVictory } from 'shared';

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
export type MapGeneratingPayload     = Record<string, never>;
export type EncounterGeneratingPayload = Record<string, never>;
export interface EncounterReadyPayload { enemies: EnemyStatBlock[] }

export interface CombatStatePayload { active: boolean }
export interface MapGeneratedPayload { mapId: string; campaignId: string }
export interface TargetingStartPayload { weapon: Weapon; actionType: 'action' | 'bonusAction' }
export type TargetingCancelPayload = Record<string, never>;
export interface CombatAttackPayload { attackerName: string; attackerId: string; targetId: string; targetName: string; weapon: Weapon }
export interface CombatAttackResultPayload extends AttackResult {}
export interface CreatureUpdatePayload { id: string; currentHp: number; maxHp: number; effects: string[] }
export interface CombatVictoryPayload extends CombatVictory {}
export interface PlayerDamagePayload { characterId: string; characterName: string; damage: number; currentHp: number; maxHp: number }
export interface RestResultPayload { currentHp: number; maxHp: number; hpGained?: number; worldEvents?: string }
export interface DeathSavePayload { characterName: string; roll: number; isNatural20: boolean; isNatural1: boolean; success: boolean; successes: number; failures: number; stable: boolean; dead: boolean }
export type CombatDefeatPayload = Record<string, never>;
export interface PlayerDeadPayload { characterId: string; characterName: string }
export interface ConsumableUsedPayload { item: Consumable; characterId: string }
export interface CombatTurnPayload { actorName: string }
export type CombatTurnEndPayload = Record<string, never>
export interface CombatInitiativePayload { entry: TurnOrderEntry }
export interface CombatInitiativeRollPayload { entry: TurnOrderEntry }
export interface CombatTurnOrderPayload { entries: TurnOrderEntry[] }
export interface MovementUsedPayload  { ft: number }
export interface MovementGainedPayload { ft: number }

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
}

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
  'vtt:rest:open':              RestOpenPayload;
  'vtt:combat:state':           CombatStatePayload;
  'vtt:map:generating':         MapGeneratingPayload;
  'vtt:map:generated':          MapGeneratedPayload;
  'vtt:encounter:generating':   EncounterGeneratingPayload;
  'vtt:encounter:ready':        EncounterReadyPayload;
  'vtt:token:move':             TokenPosition;
  'vtt:token:moved':            TokenPosition;
  'vtt:targeting:start':        TargetingStartPayload;
  'vtt:targeting:cancel':       TargetingCancelPayload;
  'vtt:combat:attack':          CombatAttackPayload;
  'vtt:combat:attack:result':   CombatAttackResultPayload;
  'vtt:creature:update':        CreatureUpdatePayload;
  'vtt:combat:victory':         CombatVictoryPayload;
  'vtt:combat:player:damage':   PlayerDamagePayload;
  'vtt:rest:result':            RestResultPayload;
  'vtt:combat:death:save':      DeathSavePayload;
  'vtt:combat:defeat':          CombatDefeatPayload;
  'vtt:combat:player:dead':     PlayerDeadPayload;
  'vtt:consumable:used':        ConsumableUsedPayload;
  'vtt:combat:turn':            CombatTurnPayload;
  'vtt:combat:turn:end':        CombatTurnEndPayload;
  'vtt:combat:initiative':      CombatInitiativePayload;
  'vtt:combat:initiative:roll': CombatInitiativeRollPayload;
  'vtt:combat:turn:order':      CombatTurnOrderPayload;
  'vtt:movement:used':          MovementUsedPayload;
  'vtt:movement:gained':        MovementGainedPayload;
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
