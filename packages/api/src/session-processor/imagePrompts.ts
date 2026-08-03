import { calcAC } from 'shared';
import type { ChatPayload, Character, EnemyStatBlock, AttackResult, WorldState, NemesisRecord } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { logError } from '../logger.ts';

const FALLBACK_ENEMY: EnemyStatBlock = {
  id: 'fallback-1', name: 'Brigand', cr: 0.125, hp: 11, ac: 12, speed: 30,
  stats: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  attacks: [{ name: 'Scimitar', bonus: 3, damage: '1d6+1' }],
};

export async function generateEncounterEnemies(
  messages: ChatPayload[],
  characters: Character[],
  adapter: StoryProviderAdapter,
  availableNemeses: NemesisRecord[] = [],
  combatants: string[] = [],
): Promise<EnemyStatBlock[]> {
  const partyLines = characters.length
    ? characters.map(c => `- ${c.name}, level ${c.level ?? 1} ${c.class} (${c.species}), AC ${calcAC(c)}, HP ${c.currentHp ?? c.maxHp ?? '?'}/${c.maxHp ?? '?'}, equipped: ${(c.inventory ?? []).map(i => i.name).join(', ') || 'basic gear'}`).join('\n')
    : '- Unknown adventurers (assume level 1–2)';

  const transcript = messages.slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');

  const nemesisBlock = availableNemeses.length
    ? `\nReturning nemeses available for this encounter (recurring enemies the party has met before):\n${availableNemeses.map(n => `- ${n.name}: exact stat block ${JSON.stringify(n.statBlock)}`).join('\n')}\nIf narratively fitting given the recent transcript, you may include one of these as one of the enemies — reuse its stat block exactly, do not alter the numbers. Do not force it if there's no good reason for them to appear.\n`
    : '';

  const combatantBlock = combatants.length
    ? `\nThe narrative DM has already established these exact combatants in the scene: ${combatants.join(', ')}.\nGenerate one stat block per entry listed, matching what it describes (species, role, apparent equipment) — do not invent additional or different creatures, and do not drop any entry.\nException: if an entry is a named creature that matches one of the returning nemeses listed below, use that exact stat block instead of generating a new one — do not alter its numbers to fit the party.\n`
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
${nemesisBlock}${combatantBlock}
Rules: 1-3 enemies, MEDIUM difficulty scaled to the party's ACTUAL current state below — real level, AC, and current HP, not an assumed standard 4-person party. A party of one gets a correspondingly lighter encounter than a party of four; a party already down HP from a prior fight gets a lighter encounter than a party at full HP. Use official 5e monster stat blocks as reference for the base numbers, then adjust to fit the party size and state given.${combatants.length ? '' : ' Base the enemies on whoever/whatever is described as hostile in the recent transcript below — do not introduce a creature type unconnected to what has already been narrated.'}

Return ONLY valid JSON, no markdown fences, no explanation.`;

  try {
    const raw = await adapter.complete(`${systemPrompt}\n\nParty:\n${partyLines}\n\nRecent events:\n${transcript}`);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { enemies?: EnemyStatBlock[] };
    const enemies = parsed.enemies ?? [];
    return enemies.length ? enemies.map((e, i) => ({ ...e, id: e.id || `enemy-${i + 1}` })) : [FALLBACK_ENEMY];
  } catch (err) {
    logError('session-processor/imagePrompts:generateEncounterEnemies', err);
    return [FALLBACK_ENEMY];
  }
}

function flattenMessages(messages: { role: string; content: string }[]): string {
  return messages.map(m => m.content).join('\n\n');
}

async function llmJson<T>(messages: { role: string; content: string }[], adapter: StoryProviderAdapter): Promise<T | null> {
  try {
    const raw = await adapter.complete(`${flattenMessages(messages)}\n\nReturn ONLY valid JSON, no markdown fences, no explanation.`);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned) as T;
  } catch (err) { logError('session-processor/imagePrompts:llmJson', err); return null; }
}

async function llmText(messages: { role: string; content: string }[], adapter: StoryProviderAdapter): Promise<string | null> {
  try {
    const raw = await adapter.complete(flattenMessages(messages));
    return raw.trim() || null;
  } catch (err) { logError('session-processor/imagePrompts:llmText', err); return null; }
}

export async function generateCombatFlavour(result: AttackResult, adapter: StoryProviderAdapter): Promise<string | null> {
  const outcome = result.hit
    ? `HIT for ${result.damage} ${result.damageFormula ? `(${result.damageFormula})` : ''} damage.${result.targetDead ? ' Target is slain.' : ` ${result.targetName} has ${result.remainingHp} HP remaining.`}`
    : `MISS — the blow fails to land (rolled ${result.total} vs AC ${result.ac}).`;

  return llmText([
    {
      role: 'system',
      content: 'You are a punchy D&D combat narrator. Write ONE short sentence (max 15 words) describing the action. Style: visceral action verbs and impact sound effects — "looses an arrow, SMACK into the goblin\'s shoulder" — not flowery metaphor. No purple prose: no similes, no "light fading from eyes", no poetic mortality language, no internal feelings. Unless the target is slain, do NOT imply they are dying, fatally wounded, or near death — a hit is a hit, not a death scene. Never mention dice, numbers, or HP.',
    },
    {
      role: 'user',
      content: `${result.attackerName} attacks ${result.targetName} with their ${result.weaponName}. ${outcome}`,
    },
  ], adapter);
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
  adapter: StoryProviderAdapter,
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
  ], adapter);
}

export async function generateWorldState(worldMd: string, factionsMd: string, adapter: StoryProviderAdapter): Promise<WorldState | null> {
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
  ], adapter);
}

export async function tickWorldNarrative(
  state: WorldState,
  hoursElapsed: number,
  worldMd: string,
  newlyCompleted: string[],
  adapter: StoryProviderAdapter,
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
  ], adapter);
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
  adapter: StoryProviderAdapter,
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
Empty array if nothing qualifies — this should be the common case.

Return ONLY valid JSON, no markdown fences, no explanation.`;

  try {
    const raw = await adapter.complete(systemPrompt);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { candidates?: NemesisCandidate[] };
    return { candidates: parsed.candidates ?? [] };
  } catch (err) {
    logError('session-processor/imagePrompts:evaluateNemesisCandidates', err);
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
