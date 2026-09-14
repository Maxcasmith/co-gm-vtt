import type { Item, Weapon, Consumable, Ammunition, EnemyStatBlock, CheckRequest, CurrencyDenomination } from 'shared';
import { randomUUID } from 'crypto';
import type { StoryProviderAdapter } from './providers/index.ts';
import { logError } from './logger.ts';
import { toSlug } from './combat/dice.ts';

export type AcquiredItem = Item | Weapon | Consumable | Ammunition;

export type TagEffect =
  | { type: 'inventory_add'; player: string; items: AcquiredItem[] }
  | { type: 'party_join'; ally: EnemyStatBlock }
  | { type: 'combat_init'; combatants: string[] }
  | { type: 'scene_build'; locationName: string; detail: string }
  | { type: 'npc_build'; npcName: string; detail: string }
  | { type: 'dungeon_gen'; name: string; dungeonType: string }
  | { type: 'dungeon_exit' }
  | { type: 'door_unlock'; characterName: string }
  | { type: 'item_used'; characterName: string; itemName: string }
  | { type: 'quest_add'; id: string; name: string; description: string; relatedNpc?: string }
  | { type: 'quest_update'; id: string; entry: string }
  | { type: 'quest_resolve'; id: string }
  | { type: 'clock'; secs: number }
  | { type: 'nemesis_create'; boundTo: string; name: string; detail: string; statBlock?: EnemyStatBlock }
  | { type: 'nemesis_retire'; name: string }
  | { type: 'ally_xp'; allyName: string; amount: number }
  | { type: 'ally_learn'; allyName: string; attackName: string; bonus: number; damageFormula: string }
  | { type: 'currency_add'; player: string; denom: CurrencyDenomination; amount: number }
  | { type: 'currency_remove'; player: string; denom: CurrencyDenomination; amount: number }
  | { type: 'spell_cast'; player: string; spellName: string };

interface ProcessResult {
  text: string;
  effects: TagEffect[];
  speakingAs?: string;
  checkRequests: CheckRequest[];
}

const TAG_RE = /\[\[([A-Z_]+):([^:[\]]+):([^\]]+)\]\]/g;

const TEMPLATES: Record<string, string> = {
  PICKED_UP_WEAPON: `{
  "id": "string — kebab-case unique id",
  "type": "weapon",
  "name": "string",
  "description": "string",
  "quantity": 1,
  "damage": "string — e.g. 1d6",
  "damageType": "string — e.g. slashing",
  "attackBonus": 0,
  "range": 5,
  "properties": [],
  "isFinesse": false
}`,
  PICKED_UP_HEALING: `{
  "id": "string — kebab-case unique id",
  "type": "consumable",
  "name": "string",
  "description": "string",
  "quantity": 1,
  "effect": "string — e.g. heals 2d4+2 HP",
  "actionCost": "action"
}`,
  PICKED_UP_AMMO: `{
  "id": "string — kebab-case unique id",
  "type": "ammunition",
  "name": "string",
  "description": "string",
  "quantity": 20
}`,
  PICKED_UP_ITEM: `{
  "id": "string — kebab-case unique id",
  "type": "item",
  "name": "string",
  "description": "string",
  "quantity": 1
}`,
};

async function structureItems(
  tagType: string,
  itemNames: string[],
  adapter: StoryProviderAdapter,
): Promise<AcquiredItem[]> {
  const template = TEMPLATES[tagType];
  if (!template || !itemNames.length) return [];

  const itemList = itemNames.map(n => `- ${n.trim()}`).join('\n');
  const prompt = `You are a D&D 5e item formatter. Convert item names into structured JSON following the schema exactly.
Return ONLY valid JSON, no markdown fences, no explanation, in the form: { "items": [ ...each item matching the schema... ] }
Schema for one item:\n${template}

Items to structure:\n${itemList}`;

  try {
    const raw = await adapter.complete(prompt);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { items?: AcquiredItem[] };
    return parsed.items ?? [];
  } catch (err) {
    logError('tag-processor:structureItems', err);
    return [];
  }
}

/**
 * Self-healing backstop for a missed PICKED_UP_* tag: the prompt makes the tag mandatory
 * alongside pickup narration, but that's an instruction, not a guarantee. Called only when
 * session.ts's own heuristic already flagged the response as pickup-shaped with no tag — this
 * does a second, narrow, single-purpose extraction pass (does this text actually describe a
 * definitive pickup, and of what) rather than trusting the first pass's compliance a second time.
 * A "no" here (any player is null) means the heuristic false-positived — a common, harmless case
 * (past tense reference to already-owned gear, "you could take X" hypotheticals, etc).
 */
export async function repairMissedPickup(
  text: string,
  adapter: StoryProviderAdapter,
): Promise<TagEffect | null> {
  const prompt = `A D&D game's narration text may or may not describe a player definitively receiving/picking up one or more physical items (not coins/currency — that's handled separately).
Return ONLY valid JSON, no markdown fences, no explanation: { "player": "exact player name, or null if no definitive pickup happened", "items": ["item name", ...] }
Only report a pickup that DEFINITELY happened in the text — not an item merely seen, described, or mentioned in passing. If unsure, return player: null.

Text: ${text}`;

  try {
    const raw = await adapter.complete(prompt);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { player?: string | null; items?: string[] };
    if (!parsed.player || !parsed.items?.length) return null;
    const items = await structureItems('PICKED_UP_ITEM', parsed.items, adapter);
    if (!items.length) return null;
    console.log(`[tag-repair] recovered missed pickup for ${parsed.player}: ${parsed.items.join(', ')}`);
    return { type: 'inventory_add', player: parsed.player, items };
  } catch (err) {
    logError('tag-processor:repairMissedPickup', err);
    return null;
  }
}

async function generateAllyStatBlock(
  name: string,
  description: string,
  adapter: StoryProviderAdapter,
): Promise<EnemyStatBlock | null> {
  const prompt = `Generate a D&D 5e stat block for an NPC ally. Keep them weak — CR 0.125 to 0.5 unless described as powerful.
Return ONLY valid JSON, no markdown fences, no explanation:
{
  "name": "string",
  "cr": 0.25,
  "hp": 8,
  "ac": 11,
  "speed": 30,
  "stats": { "str": 11, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 10 },
  "attacks": [{ "name": "string", "bonus": 2, "damage": "1d6" }]
}

Name: ${name}
Description: ${description}`;

  try {
    const raw = await adapter.complete(prompt);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<EnemyStatBlock>;
    if (!parsed.hp || !parsed.ac) return null;
    return { ...parsed, id: randomUUID(), name: parsed.name ?? name } as EnemyStatBlock;
  } catch (err) {
    logError('tag-processor:generateAllyStatBlock', err);
    return null;
  }
}

export async function processVdmResponse(
  text: string,
  adapter: StoryProviderAdapter,
): Promise<ProcessResult> {
  const effects: TagEffect[] = [];
  const tagMatches = [...text.matchAll(TAG_RE)];

  const PARTY_JOIN_RE = /\[\[PARTY_JOIN:([^:[\]]+):([^\]]+)\]\]/g;
  const partyJoinMatches = [...text.matchAll(PARTY_JOIN_RE)];

  const SCENE_BUILD_RE = /\[\[SCENE_BUILD:([^:[\]]+):([^\]]+)\]\]/g;
  const sceneBuildMatches = [...text.matchAll(SCENE_BUILD_RE)];

  const NPC_BUILD_RE = /\[\[NPC_BUILD:([^:[\]]+):([^\]]+)\]\]/g;
  const npcBuildMatches = [...text.matchAll(NPC_BUILD_RE)];

  const SPEAKING_AS_RE = /\[\[SPEAKING_AS:([^\]]+)\]\]/;
  const speakingAsMatch = text.match(SPEAKING_AS_RE);
  const speakingAs = speakingAsMatch?.[1]?.trim();

  const CHECK_RE = /\[\[REQUEST_CHECK:([^|[\]]+)\|([^\]]+)\]\]/g;
  const SAVE_RE  = /\[\[REQUEST_SAVE:([^|[\]]+)\|([^\]]+)\]\]/g;
  const checkRequests: CheckRequest[] = [
    ...[...text.matchAll(CHECK_RE)].map(m => ({ player: m[1]!.trim(), skill: m[2]!.trim(), type: 'check' as const })),
    ...[...text.matchAll(SAVE_RE)].map(m =>  ({ player: m[1]!.trim(), skill: m[2]!.trim(), type: 'save'  as const })),
  ];

  const DUNGEON_GEN_RE = /\[\[DUNGEON_GEN:([^:[\]]+):([^\]]+)\]\]/g;
  const dungeonGenMatches = [...text.matchAll(DUNGEON_GEN_RE)];
  for (const match of dungeonGenMatches) {
    const name = match[1]?.trim();
    const dungeonType = match[2]?.trim();
    if (name && dungeonType) effects.push({ type: 'dungeon_gen', name, dungeonType });
  }

  const QUEST_ADD_RE = /\[\[QUEST_ADD:([^|[\]]+)\|([^|[\]]+)\|([^\]]+)\]\]/g;
  for (const match of [...text.matchAll(QUEST_ADD_RE)]) {
    const id = match[1]?.trim();
    const name = match[2]?.trim();
    const description = match[3]?.trim();
    if (id && name && description) {
      console.log(`[tag] QUEST_ADD: ${id}`);
      // If the DM tagged who it's speaking as this turn, that's a free, deterministic link to the
      // NPC who's actually giving this hook right now — no need to make the model name it twice.
      const relatedNpc = speakingAs ? toSlug(speakingAs) : undefined;
      effects.push({ type: 'quest_add', id, name, description, ...(relatedNpc ? { relatedNpc } : {}) });
    }
  }

  const QUEST_UPDATE_RE = /\[\[QUEST_UPDATE:([^|[\]]+)\|([^\]]+)\]\]/g;
  for (const match of [...text.matchAll(QUEST_UPDATE_RE)]) {
    const id = match[1]?.trim();
    const entry = match[2]?.trim();
    if (id && entry) {
      console.log(`[tag] QUEST_UPDATE: ${id}`);
      effects.push({ type: 'quest_update', id, entry });
    }
  }

  const QUEST_RESOLVE_RE = /\[\[QUEST_RESOLVE:([^\]]+)\]\]/g;
  for (const match of [...text.matchAll(QUEST_RESOLVE_RE)]) {
    const id = match[1]?.trim();
    if (id) {
      console.log(`[tag] QUEST_RESOLVE: ${id}`);
      effects.push({ type: 'quest_resolve', id });
    }
  }

  const DOOR_UNLOCK_RE = /\[\[DOOR_UNLOCK:([^\]]+)\]\]/g;
  for (const match of [...text.matchAll(DOOR_UNLOCK_RE)]) {
    const characterName = match[1]?.trim();
    if (characterName) {
      console.log(`[tag] DOOR_UNLOCK: ${characterName}`);
      effects.push({ type: 'door_unlock', characterName });
    }
  }

  const ITEM_USED_RE = /\[\[ITEM_USED:([^|[\]]+)\|([^\]]+)\]\]/g;
  for (const match of [...text.matchAll(ITEM_USED_RE)]) {
    const characterName = match[1]?.trim();
    const itemName = match[2]?.trim();
    if (characterName && itemName) {
      console.log(`[tag] ITEM_USED: ${characterName} uses ${itemName}`);
      effects.push({ type: 'item_used', characterName, itemName });
    }
  }

  const CLOCK_RE = /\[\[CLOCK:(\d+)\]\]/g;
  for (const match of [...text.matchAll(CLOCK_RE)]) {
    const secs = parseInt(match[1]!, 10);
    if (!isNaN(secs) && secs > 0) effects.push({ type: 'clock', secs });
  }

  const COMBAT_INIT_RE = /\[\[COMBAT_INIT(?::([^\]]*))?\]\]/g;
  const combatInitMatch = COMBAT_INIT_RE.exec(text);
  if (combatInitMatch) {
    const combatants = (combatInitMatch[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
    console.log('[tag] COMBAT_INIT detected', combatants);
    effects.push({ type: 'combat_init', combatants });
  }

  const DUNGEON_EXIT_RE = /\[\[DUNGEON_EXIT\]\]/g;
  if (text.includes('[[DUNGEON_EXIT]]')) {
    console.log('[tag] DUNGEON_EXIT detected');
    effects.push({ type: 'dungeon_exit' });
  }

  const NEMESIS_RETIRE_RE = /\[\[NEMESIS_RETIRE:([^\]]+)\]\]/g;
  for (const match of [...text.matchAll(NEMESIS_RETIRE_RE)]) {
    const name = match[1]?.trim();
    if (name) {
      console.log(`[tag] NEMESIS_RETIRE: ${name}`);
      effects.push({ type: 'nemesis_retire', name });
    }
  }

  const CURRENCY_DENOMS = new Set(['platinum', 'gold', 'electrum', 'silver', 'bronze']);
  // A non-fantasy setting narrates "dollars" or "credits" even though the prompt tells the model
  // to still tag with one of the five fixed denominations (see prompts.ts's Currency tags section)
  // — that's an instruction, not a guarantee. Falling back to 'gold' (the general-purpose bucket)
  // for anything unrecognized beats silently dropping the pickup the player was just told they got.
  // Case-insensitive too: a capitalized "Dollars"/"Gold" used to fail the match entirely and leak
  // the raw [[CURRENCY_ADD:...]] tag straight into the chat.
  const CURRENCY_ADD_RE = /\[\[CURRENCY_ADD:([^:[\]]+):(\d+):([a-z]+)\]\]/gi;
  for (const match of [...text.matchAll(CURRENCY_ADD_RE)]) {
    const player = match[1]?.trim();
    const amount = parseInt(match[2] ?? '', 10);
    const rawDenom = match[3]?.trim().toLowerCase();
    const denom = rawDenom && CURRENCY_DENOMS.has(rawDenom) ? rawDenom : 'gold';
    if (player && !isNaN(amount) && amount > 0) {
      console.log(`[tag] CURRENCY_ADD: ${player} +${amount} ${denom}${rawDenom !== denom ? ` (unrecognized denomination "${rawDenom}", defaulted)` : ''}`);
      effects.push({ type: 'currency_add', player, denom: denom as CurrencyDenomination, amount });
    }
  }

  const CURRENCY_REMOVE_RE = /\[\[CURRENCY_REMOVE:([^:[\]]+):(\d+):([a-z]+)\]\]/gi;
  for (const match of [...text.matchAll(CURRENCY_REMOVE_RE)]) {
    const player = match[1]?.trim();
    const amount = parseInt(match[2] ?? '', 10);
    const rawDenom = match[3]?.trim().toLowerCase();
    const denom = rawDenom && CURRENCY_DENOMS.has(rawDenom) ? rawDenom : 'gold';
    if (player && !isNaN(amount) && amount > 0) {
      console.log(`[tag] CURRENCY_REMOVE: ${player} -${amount} ${denom}${rawDenom !== denom ? ` (unrecognized denomination "${rawDenom}", defaulted)` : ''}`);
      effects.push({ type: 'currency_remove', player, denom: denom as CurrencyDenomination, amount });
    }
  }

  const CAST_SPELL_RE = /\[\[CAST_SPELL:([^:[\]]+):([^\]]+)\]\]/g;
  for (const match of [...text.matchAll(CAST_SPELL_RE)]) {
    const player = match[1]?.trim();
    const spellName = match[2]?.trim();
    if (player && spellName) {
      console.log(`[tag] CAST_SPELL: ${player} casts ${spellName}`);
      effects.push({ type: 'spell_cast', player, spellName });
    }
  }

  const ALLY_XP_RE = /\[\[ALLY_XP:([^:[\]]+):(\d+)\]\]/g;
  for (const match of [...text.matchAll(ALLY_XP_RE)]) {
    const allyName = match[1]?.trim();
    const amount = parseInt(match[2] ?? '', 10);
    if (allyName && !isNaN(amount) && amount > 0) {
      console.log(`[tag] ALLY_XP: ${allyName} +${amount}`);
      effects.push({ type: 'ally_xp', allyName, amount });
    }
  }

  const ALLY_LEARN_RE = /\[\[ALLY_LEARN:([^|[\]]+)\|([^|[\]]+)\|([^|[\]]+)\|([^\]]+)\]\]/g;
  for (const match of [...text.matchAll(ALLY_LEARN_RE)]) {
    const allyName = match[1]?.trim();
    const attackName = match[2]?.trim();
    const bonus = parseInt(match[3] ?? '', 10);
    const damageFormula = match[4]?.trim();
    if (allyName && attackName && !isNaN(bonus) && damageFormula) {
      console.log(`[tag] ALLY_LEARN: ${allyName} learned ${attackName}`);
      effects.push({ type: 'ally_learn', allyName, attackName, bonus, damageFormula });
    }
  }

  await Promise.all([
    ...tagMatches.map(async match => {
      const tagType = match[1];
      const player = match[2];
      const rawItems = match[3];
      if (!tagType || !player || !rawItems || !TEMPLATES[tagType]) return;
      const itemNames = rawItems.split(',').map(s => s.trim()).filter(Boolean);
      console.log(`[tag] ${tagType} for ${player}: ${itemNames.join(', ')}`);
      const items = await structureItems(tagType, itemNames, adapter);
      if (items.length) effects.push({ type: 'inventory_add', player: player.trim(), items });
      else console.warn(`[tag] ${tagType} structuring returned no items`);
    }),
    ...partyJoinMatches.map(async match => {
      const name = match[1]?.trim();
      const description = match[2]?.trim();
      if (!name || !description) return;
      console.log(`[tag] PARTY_JOIN: ${name}`);
      const ally = await generateAllyStatBlock(name, description, adapter);
      if (ally) effects.push({ type: 'party_join', ally });
      else console.warn(`[tag] PARTY_JOIN stat block generation failed for ${name}`);
    }),
    ...sceneBuildMatches.map(async match => {
      const locationName = match[1]?.trim();
      const detail = match[2]?.trim();
      if (!locationName || !detail) return;
      console.log(`[tag] SCENE_BUILD: ${locationName}`);
      effects.push({ type: 'scene_build', locationName, detail });
    }),
    ...npcBuildMatches.map(async match => {
      const npcName = match[1]?.trim();
      const detail = match[2]?.trim();
      if (!npcName || !detail) return;
      console.log(`[tag] NPC_BUILD: ${npcName}`);
      effects.push({ type: 'npc_build', npcName, detail });
    }),
  ]);

  let strippedText = text.replace(TAG_RE, '').replace(PARTY_JOIN_RE, '').replace(SCENE_BUILD_RE, '').replace(NPC_BUILD_RE, '').replace(COMBAT_INIT_RE, '').replace(DUNGEON_EXIT_RE, '').replace(DOOR_UNLOCK_RE, '').replace(ITEM_USED_RE, '').replace(SPEAKING_AS_RE, '').replace(CHECK_RE, '').replace(SAVE_RE, '').replace(DUNGEON_GEN_RE, '').replace(QUEST_ADD_RE, '').replace(QUEST_UPDATE_RE, '').replace(QUEST_RESOLVE_RE, '').replace(CLOCK_RE, '').replace(NEMESIS_RETIRE_RE, '').replace(ALLY_XP_RE, '').replace(ALLY_LEARN_RE, '').replace(CURRENCY_ADD_RE, '').replace(CURRENCY_REMOVE_RE, '').replace(CAST_SPELL_RE, '').replace(/\s{2,}/g, ' ').trim();
  // A tag sitting at the end of a sentence (the common case — models emit it after the prose it
  // corresponds to) gets eaten above along with the punctuation the model tucked inside it, e.g.
  // "...picks up a med kit[[PICKED_UP_HEALING:...]]" leaves "...picks up a med kit" with no period.
  if (strippedText && !/[.!?'"]$/.test(strippedText)) strippedText += '.';
  return { text: strippedText, effects, checkRequests, ...(speakingAs !== undefined ? { speakingAs } : {}) };
}
