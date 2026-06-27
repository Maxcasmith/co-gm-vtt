import type { Item, Weapon, Consumable, Ammunition, EnemyStatBlock, CheckRequest } from 'shared';
import { randomUUID } from 'crypto';

export type AcquiredItem = Item | Weapon | Consumable | Ammunition;

export type TagEffect =
  | { type: 'inventory_add'; player: string; items: AcquiredItem[] }
  | { type: 'party_join'; ally: EnemyStatBlock }
  | { type: 'combat_init' }
  | { type: 'scene_build'; locationName: string; detail: string }
  | { type: 'npc_build'; npcName: string; detail: string }
  | { type: 'dungeon_gen'; name: string; dungeonType: string }
  | { type: 'quest_add'; id: string; name: string; description: string }
  | { type: 'quest_update'; id: string; entry: string }
  | { type: 'quest_resolve'; id: string }
  | { type: 'clock'; secs: number };

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
  apiKey: string,
  model: string,
): Promise<AcquiredItem[]> {
  const template = TEMPLATES[tagType];
  if (!template || !itemNames.length) return [];

  const schema = `[\n  ${template}\n]`;
  const itemList = itemNames.map(n => `- ${n.trim()}`).join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a D&D 5e item formatter. Convert item names into structured JSON following the schema exactly.
Return ONLY valid JSON in the form: { "items": [ ...each item matching the schema... ] }
Schema for one item:\n${template}`,
          },
          { role: 'user', content: `Items to structure:\n${itemList}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0]?.message.content ?? '{}') as { items?: AcquiredItem[] };
    return parsed.items ?? [];
  } catch (err) {
    console.error('[tag-processor] item structuring failed:', err);
    return [];
  }
}

async function generateAllyStatBlock(
  name: string,
  description: string,
  apiKey: string,
  model: string,
): Promise<EnemyStatBlock | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Generate a D&D 5e stat block for an NPC ally. Keep them weak — CR 0.125 to 0.5 unless described as powerful.
Return ONLY valid JSON:
{
  "name": "string",
  "cr": 0.25,
  "hp": 8,
  "ac": 11,
  "speed": 30,
  "stats": { "str": 11, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 10 },
  "attacks": [{ "name": "string", "bonus": 2, "damage": "1d6" }]
}`,
          },
          { role: 'user', content: `Name: ${name}\nDescription: ${description}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0]?.message.content ?? '{}') as Partial<EnemyStatBlock>;
    if (!parsed.hp || !parsed.ac) return null;
    return { ...parsed, id: randomUUID(), name: parsed.name ?? name } as EnemyStatBlock;
  } catch (err) {
    console.error('[tag-processor] ally stat block generation failed:', err);
    return null;
  }
}

export async function processVdmResponse(
  text: string,
  apiKey: string,
  model: string,
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
      effects.push({ type: 'quest_add', id, name, description });
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

  const CLOCK_RE = /\[\[CLOCK:(\d+)\]\]/g;
  for (const match of [...text.matchAll(CLOCK_RE)]) {
    const secs = parseInt(match[1]!, 10);
    if (!isNaN(secs) && secs > 0) effects.push({ type: 'clock', secs });
  }

  const COMBAT_INIT_RE = /\[\[COMBAT_INIT\]\]/g;
  if (text.includes('[[COMBAT_INIT]]')) {
    console.log('[tag] COMBAT_INIT detected');
    effects.push({ type: 'combat_init' });
  }

  await Promise.all([
    ...tagMatches.map(async match => {
      const tagType = match[1];
      const player = match[2];
      const rawItems = match[3];
      if (!tagType || !player || !rawItems || !TEMPLATES[tagType]) return;
      const itemNames = rawItems.split(',').map(s => s.trim()).filter(Boolean);
      console.log(`[tag] ${tagType} for ${player}: ${itemNames.join(', ')}`);
      const items = await structureItems(tagType, itemNames, apiKey, model);
      if (items.length) effects.push({ type: 'inventory_add', player: player.trim(), items });
      else console.warn(`[tag] ${tagType} structuring returned no items`);
    }),
    ...partyJoinMatches.map(async match => {
      const name = match[1]?.trim();
      const description = match[2]?.trim();
      if (!name || !description) return;
      console.log(`[tag] PARTY_JOIN: ${name}`);
      const ally = await generateAllyStatBlock(name, description, apiKey, model);
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

  const strippedText = text.replace(TAG_RE, '').replace(PARTY_JOIN_RE, '').replace(SCENE_BUILD_RE, '').replace(NPC_BUILD_RE, '').replace(COMBAT_INIT_RE, '').replace(SPEAKING_AS_RE, '').replace(CHECK_RE, '').replace(SAVE_RE, '').replace(DUNGEON_GEN_RE, '').replace(QUEST_ADD_RE, '').replace(QUEST_UPDATE_RE, '').replace(QUEST_RESOLVE_RE, '').replace(CLOCK_RE, '').replace(/\s{2,}/g, ' ').trim();
  return { text: strippedText, effects, checkRequests, ...(speakingAs !== undefined ? { speakingAs } : {}) };
}
