import type { ChatPayload, Character, EnemyStatBlock, AttackResult, WorldState } from 'shared';

const PARSE_MODEL = 'gpt-4o-mini';
const API_BASE = 'https://api.openai.com/v1';

interface LocationContext {
  location: string;
  locationType: string;
  architecture: string;
  atmosphere: string;
  timeOfDay: string;
  weather: string;
  currentSituation: string;
  keyFeatures: string;
  mood: string;
}

const FALLBACK_CONTEXT: LocationContext = {
  location: 'Unknown location',
  locationType: 'interior',
  architecture: 'medieval fantasy',
  atmosphere: 'tense and atmospheric',
  timeOfDay: 'night',
  weather: 'clear',
  currentSituation: 'An encounter is beginning',
  keyFeatures: 'tables, barrels, doorways providing cover',
  mood: 'dangerous and foreboding',
};

export async function parseLocationContext(messages: ChatPayload[], apiKey: string): Promise<LocationContext> {
  const transcript = messages
    .slice(-20)
    .map(m => `[${m.senderName}]: ${m.text}`)
    .join('\n');

  const systemPrompt = `You are extracting location context from a D&D session transcript to generate a battle map.
Return ONLY valid JSON with these exact keys:
{
  "location": "name or description of the location",
  "locationType": "interior/exterior/dungeon/wilderness/urban/etc",
  "architecture": "architectural style and materials",
  "atmosphere": "general feel of the space",
  "timeOfDay": "dawn/morning/midday/afternoon/dusk/night",
  "weather": "weather conditions (if exterior)",
  "currentSituation": "what is happening right now in one sentence",
  "keyFeatures": "notable tactical features — furniture, cover, terrain, exits",
  "mood": "lighting and emotional tone"
}
If a field cannot be determined, make a reasonable inference from context. Never return null values.`;

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: PARSE_MODEL,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Session transcript:\n${transcript}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0]?.message.content ?? '{}') as Partial<LocationContext>;
    return { ...FALLBACK_CONTEXT, ...parsed };
  } catch (err) {
    console.error('[imagePrompts] location parse failed, using fallback:', err);
    return FALLBACK_CONTEXT;
  }
}

const FALLBACK_ENEMY: EnemyStatBlock = {
  id: 'fallback-1', name: 'Brigand', cr: 0.125, hp: 11, ac: 12, speed: 30,
  stats: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  attacks: [{ name: 'Scimitar', bonus: 3, damage: '1d6+1' }],
};

export async function generateEncounterEnemies(
  messages: ChatPayload[],
  characters: Character[],
  apiKey: string,
  model = PARSE_MODEL,
): Promise<EnemyStatBlock[]> {
  const partyLines = characters.length
    ? characters.map(c => `- ${c.name}, ${c.class} (${c.species}), equipped: ${(c.inventory ?? []).map(i => i.name).join(', ') || 'basic gear'}`).join('\n')
    : '- Unknown adventurers (assume level 1–2)';

  const transcript = messages.slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');

  const systemPrompt = `You are a D&D 5e DM generating a combat encounter. Return ONLY valid JSON:
{
  "enemies": [
    {
      "id": "enemy-1",
      "name": "string",
      "cr": 0.25,
      "hp": 11,
      "ac": 13,
      "speed": 30,
      "stats": { "str": 11, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 10 },
      "attacks": [{ "name": "Attack", "bonus": 3, "damage": "1d6+1" }]
    }
  ]
}
Rules: 1-3 enemies, MEDIUM difficulty for this party, use official 5e monster stat blocks as reference.`;

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Party:\n${partyLines}\n\nRecent events:\n${transcript}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0]?.message.content ?? '{}') as { enemies?: EnemyStatBlock[] };
    const enemies = parsed.enemies ?? [];
    return enemies.length ? enemies.map((e, i) => ({ ...e, id: e.id || `enemy-${i + 1}` })) : [FALLBACK_ENEMY];
  } catch (err) {
    console.error('[imagePrompts] enemy gen failed, using fallback:', err);
    return [FALLBACK_ENEMY];
  }
}

async function llmJson<T>(messages: { role: string; content: string }[], apiKey: string, model: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 400, response_format: { type: 'json_object' }, messages }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    return JSON.parse(data.choices[0]?.message.content ?? 'null') as T;
  } catch { return null; }
}

async function llmText(messages: { role: string; content: string }[], apiKey: string, model: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: 120, messages }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message.content?.trim() ?? null;
  } catch { return null; }
}

export async function generateCombatFlavour(result: AttackResult, apiKey: string, model: string): Promise<string | null> {
  const outcome = result.hit
    ? `HIT for ${result.damage} ${result.damageFormula ? `(${result.damageFormula})` : ''} damage.${result.targetDead ? ' Target is slain.' : ` ${result.targetName} has ${result.remainingHp} HP remaining.`}`
    : `MISS — the blow fails to land (rolled ${result.total} vs AC ${result.ac}).`;

  return llmText([
    {
      role: 'system',
      content: 'You are a vivid D&D combat narrator. Write a single punchy sentence (max 40 words) describing the combat action. Be cinematic. Vary your style — sometimes brutal, sometimes graceful. Never mention dice or numbers.',
    },
    {
      role: 'user',
      content: `${result.attackerName} attacks ${result.targetName} with their ${result.weaponName}. ${outcome}`,
    },
  ], apiKey, model);
}

export interface ImprovisedActionResult {
  type: 'attack' | 'question';
  answer: string;
  dc?: number;
  stat?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  damageFormula?: string;
  damageType?: string;
  targetId?: string;
}

export async function resolveImprovisedAction(
  context: { playerName: string; playerClass: string; message: string; enemies: EnemyStatBlock[]; recentChat: string },
  apiKey: string,
  model: string,
): Promise<ImprovisedActionResult | null> {
  const enemyList = context.enemies.map(e => `${e.name} (id: ${e.id}, HP: ${e.hp}, AC: ${e.ac})`).join(', ');
  return llmJson<ImprovisedActionResult>([
    {
      role: 'system',
      content: `You are a D&D 5e DM running a live combat encounter. A player says something during their turn.
Determine if it is: (A) an improvised attack/environmental action, or (B) a question or statement requiring a DM response.

Enemies present: ${enemyList}

Respond with JSON only:
{ "type": "attack"|"question", "answer": "narrative text (always required)", "dc": <number if attack>, "stat": "str|dex|con|int|wis|cha", "damageFormula": "XdY+Z", "damageType": "bludgeoning|piercing|slashing|fire|...", "targetId": "<enemy id if attack>" }

If type is "question", only "type" and "answer" are needed. Be fair but decisive on DCs.`,
    },
    { role: 'user', content: `Recent events:\n${context.recentChat}\n\n${context.playerName} (${context.playerClass}) says: "${context.message}"` },
  ], apiKey, model);
}

export async function generateWorldState(worldMd: string, factionsMd: string, apiKey: string, model: string): Promise<WorldState | null> {
  return llmJson<WorldState>([
    {
      role: 'system',
      content: `You are creating a world state tracker for a D&D campaign. Based on the world lore and factions provided, generate a JSON object with this exact structure:
{
  "dayNumber": 1,
  "totalHoursElapsed": 0,
  "actors": [
    {
      "id": "kebab-case-id",
      "name": "Actor Name",
      "type": "bbeg",
      "ultimateGoal": "What they ultimately want to achieve",
      "totalDays": 30,
      "daysElapsed": 0,
      "milestones": [
        { "day": 7, "description": "First major step", "completed": false },
        { "day": 14, "description": "Second major step", "completed": false },
        { "day": 21, "description": "Third major step", "completed": false },
        { "day": 28, "description": "Final preparation", "completed": false }
      ],
      "currentStatus": "Present-tense description of what they are doing right now, at the start of the campaign",
      "status": "active"
    }
  ]
}
Rules:
- The BBEG gets type "bbeg" with totalDays: 30 and 4 milestones evenly spaced (days 7, 14, 21, 28)
- Each faction gets type "faction" with totalDays: 30 and 3 milestones
- milestones must be grounded in the faction's specific goals from the lore
- currentStatus is a brief (one sentence) present-tense description at campaign start
- totalDays is generous — players should have time to act
- Return valid JSON only`,
    },
    { role: 'user', content: `World lore:\n${worldMd}\n\nFactions:\n${factionsMd}` },
  ], apiKey, model);
}

export async function tickWorldNarrative(
  state: WorldState,
  hoursElapsed: number,
  worldMd: string,
  newlyCompleted: string[],
  apiKey: string,
  model: string,
): Promise<string | null> {
  const actorSummaries = state.actors
    .filter(a => a.status === 'active')
    .map(a => {
      const nextMilestone = a.milestones.find(m => !m.completed);
      return `${a.name} (${a.type}): Goal — ${a.ultimateGoal}. Currently: ${a.currentStatus}. Next milestone: ${nextMilestone?.description ?? 'none — approaching final goal'}`;
    })
    .join('\n');

  const completedLine = newlyCompleted.length
    ? `\nMilestones just reached during this rest: ${newlyCompleted.join('; ')}`
    : '';

  return llmText([
    {
      role: 'system',
      content: `You are a D&D narrator reporting what the world's antagonists and factions have been doing while the players rested. Write 2-3 ominous sentences. Be specific — name actors, reference their current goals. Make it feel like the world is moving without the players.`,
    },
    {
      role: 'user',
      content: `The players rested for ${hoursElapsed} hours (${(hoursElapsed / 24).toFixed(1)} days passed).\n\nActive actors:\n${actorSummaries}${completedLine}\n\nWorld context (brief): ${worldMd.slice(0, 400)}`,
    },
  ], apiKey, model);
}

export function buildBattleMapPrompt(ctx: LocationContext): string {
  return `Create a PREMIUM AAA VTT BATTLE MAP.

STYLE RULES (MANDATORY):
- Perfect orthographic top-down view (90° overhead)
- Tactical battle map, not concept art
- Professional Patreon-quality cartography
- Highly detailed textures and environmental storytelling
- Realistic architecture and terrain
- Atmospheric lighting that preserves readability
- Dense but believable clutter and props
- Clear focal points and tactical combat spaces
- Multiple routes, cover, chokepoints, and line-of-sight blockers
- Rich visual detail with no empty or unused areas
- Suitable for Foundry VTT, Roll20, and print play
- No characters, labels, UI elements, text, borders, perspective distortion, or grid lines

MAP CONTEXT

Genre: Dark fantasy tabletop RPG

Location: ${ctx.location}

Purpose: ${ctx.locationType} encounter space

Current Situation: ${ctx.currentSituation}

Mood & Atmosphere: ${ctx.mood}

Time: ${ctx.timeOfDay}

Weather: ${ctx.weather}

Architecture / Environment Style: ${ctx.architecture}

Key Encounter Elements: ${ctx.keyFeatures}

Atmosphere: ${ctx.atmosphere}

Map Size: MEDIUM

Final Requirement:
Visually express every piece of provided context through architecture, terrain, props, lighting, damage, wear, clutter, and environmental storytelling. Maintain strict top-down orthographic perspective, realistic scale, tactical usability, and premium battle-map quality throughout.`;
}
