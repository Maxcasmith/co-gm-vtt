import type { ChatPayload, Character, EnemyStatBlock, AttackResult, WorldState, NemesisRecord } from 'shared';

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

export async function parseLocationContext(messages: ChatPayload[], apiKey: string, locationMd?: string | null): Promise<LocationContext> {
  const transcript = messages
    .slice(-20)
    .map(m => `[${m.senderName}]: ${m.text}`)
    .join('\n');

  const knownLocationBlock = locationMd
    ? `\nKNOWN LOCATION (authoritative — the party is confirmed to be here):\n${locationMd}\n\nUse this to fill "location", "locationType", "architecture", "atmosphere" — these values MUST come from here when it provides them, not from the transcript. Only use the transcript for "currentSituation", "timeOfDay", "weather", "keyFeatures", "mood", or any field the location text leaves unclear.\n`
    : '';

  const systemPrompt = `You are extracting location context from a D&D session transcript to generate a battle map.
${knownLocationBlock}
Return ONLY valid JSON with these exact keys:
{
  "location": "name or description of the location",
  "locationType": "interior/exterior/dungeon/wilderness/urban/etc",
  "architecture": "architectural style and materials",
  "atmosphere": "general feel of the space",
  "timeOfDay": "dawn/morning/midday/afternoon/dusk/night",
  "weather": "weather conditions (if exterior)",
  "currentSituation": "the physical/environmental state of the scene in one sentence — damage, clutter, disturbed objects, tactical terrain. NEVER mention people, NPCs, monsters, or characters being present",
  "keyFeatures": "notable tactical features — furniture, cover, terrain, exits. NEVER mention people or creatures",
  "mood": "lighting and emotional tone"
}
If a field cannot be determined, make a reasonable inference from context. Never return null values. This describes an empty scene — no living creatures of any kind should appear in any field.`;

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
  availableNemeses: NemesisRecord[] = [],
): Promise<EnemyStatBlock[]> {
  const partyLines = characters.length
    ? characters.map(c => `- ${c.name}, ${c.class} (${c.species}), equipped: ${(c.inventory ?? []).map(i => i.name).join(', ') || 'basic gear'}`).join('\n')
    : '- Unknown adventurers (assume level 1–2)';

  const transcript = messages.slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');

  const nemesisBlock = availableNemeses.length
    ? `\nReturning nemeses available for this encounter (recurring enemies the party has met before):\n${availableNemeses.map(n => `- ${n.name}: exact stat block ${JSON.stringify(n.statBlock)}`).join('\n')}\nIf narratively fitting given the recent transcript, you may include one of these as one of the enemies — reuse its stat block exactly, do not alter the numbers. Do not force it if there's no good reason for them to appear.\n`
    : '';

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
${nemesisBlock}
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
- ABSOLUTELY NO people, NPCs, monsters, animals, or living figures of any kind anywhere in the image — a completely empty scene, ready for tokens to be placed
- No labels, UI elements, text, borders, perspective distortion, or grid lines

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
Visually express every piece of provided context through architecture, terrain, props, lighting, damage, wear, clutter, and environmental storytelling. Maintain strict top-down orthographic perspective, realistic scale, tactical usability, and premium battle-map quality throughout. The scene must be completely empty of people, NPCs, monsters, and animals — no living creatures anywhere in the image.`;
}

export interface NemesisCandidate {
  name: string;
  boundTo: string;
  detail: string;
}

export async function evaluateNemesisCandidates(
  transcript: ChatPayload[],
  roster: EnemyStatBlock[],
  statusLines: string[],
  existingNemeses: NemesisRecord[],
  characterNames: string[],
  apiKey: string,
  model: string,
): Promise<{ candidates: NemesisCandidate[] }> {
  if (!roster.length || !transcript.length) return { candidates: [] };

  const transcriptText = transcript.map(m => `[${m.senderName}]: ${m.text}`).join('\n');
  const rosterText = roster.map(e => `${e.name} (CR ${e.cr}, HP ${e.hp}, AC ${e.ac}, attacks: ${e.attacks.map(a => a.name).join(', ') || 'none'})`).join('\n');
  const statusText = statusLines.join('\n') || 'unknown';
  const activeNemeses = existingNemeses.filter(n => n.status === 'active');
  const existingText = activeNemeses.length
    ? activeNemeses.map(n => `${n.name} (bound to ${n.boundTo}, ${n.deathCount}/3 deaths survived)`).join('\n')
    : 'none';

  const systemPrompt = `You are analysing a just-finished D&D combat encounter to decide whether it produced a "nemesis" — a recurring enemy who can return later, escalated.

Original enemy roster for this fight:
${rosterText}

Final status (mechanically accurate — HP/alive-dead is reliable regardless of how the fight was narrated):
${statusText}

Existing active nemeses already bound to this party (a candidate matching one of these names is a RETURN, not a new creation):
${existingText}

Party members: ${characterNames.join(', ') || 'unknown'}

Full transcript of this encounter:
${transcriptText}

Most encounters should produce ZERO candidates. Do NOT propose a candidate just because an enemy survived, fled, or was hit — that describes most enemies in most fights and is not sufficient on its own.

Propose a candidate ONLY if the party's specific actions or the fight's narrative turned this one individual into someone distinct from the rest of the mob. Valid reasons include (not exhaustive):
- The party used a distinctive tactic on this one specific enemy (charmed it, dominated it, made it turn on its own allies)
- A uniquely memorable manner of near-death or death with a visible lasting consequence (burned, maimed, scarred) — this enemy can still return later if the world/campaign supports revival, resurrection, or simply wasn't fully finished off; note the visible consequence in "detail" so it can be referenced when they return
- The enemy was given a name, spoke, or had a personal exchange with a specific PC
- Disproportionate party attention or effort was spent on this one target specifically

An enemy having been hit, having fled, or merely being "one of the survivors" among several identical enemies is NOT sufficient on its own.

If the enemy doesn't have an established name, invent one that fits the scene.

boundTo should be a specific party member's name if the moment was personal to them, or "party" if it was a group confrontation.

Return ONLY valid JSON:
{
  "candidates": [
    { "name": "string", "boundTo": "string — a party member name or \\"party\\"", "detail": "string — 1-2 sentences: what made them distinct, including any visible lasting consequence" }
  ]
}
Empty array if nothing qualifies — this should be the common case.`;

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt }],
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0]?.message.content ?? '{}') as { candidates?: NemesisCandidate[] };
    return { candidates: parsed.candidates ?? [] };
  } catch (err) {
    console.error('[imagePrompts] nemesis evaluation failed:', err);
    return { candidates: [] };
  }
}

export function buildWorldMapPrompt(worldMd: string, locationsSummary: string, tags: string[]): string {
  const tagLine = tags.length ? tags.join(', ') : 'dark fantasy';
  return `Create a FANTASY WORLD MAP in the style of classic RPG cartography. This map must be scoped exclusively to the world described below — no generic fantasy tropes that contradict the setting. Every visual choice (palette, terrain, iconography, atmosphere) must reflect the specific tone and themes of this campaign.

CAMPAIGN TAGS (these define the mood, genre, and visual identity of this world — the map must embody them):
${tagLine}

STYLE RULES (MANDATORY):
- Hand-drawn or painterly top-down world map aesthetic (like classic D&D sourcebook maps)
- Illustrated terrain features: mountains, forests, coastlines, rivers, deserts — styled to match the campaign tags above
- Every named location listed below MUST appear on the map as a marked landmark or settlement with a small illustrative icon
- Colour palette, linework, and overall aesthetic derived from the campaign tags — not generic parchment if the setting doesn't call for it
- Decorative compass rose in a style matching the world's tone
- Rich, dense detail — no empty areas
- No grid, no UI, no text labels, no borders

WORLD CONTEXT

${worldMd.slice(0, 1200)}

LOCATIONS (each must be visually represented on the map)

${locationsSummary.slice(0, 1200)}`;
}
