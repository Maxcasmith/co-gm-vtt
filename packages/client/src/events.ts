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
export type SheetClosedPayload = Record<string, never>;

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
