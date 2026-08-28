import { calcAC, CREATURE_TYPES, ENEMY_ROLES } from 'shared';
import type { ChatPayload, Character, EnemyStatBlock, CreatureType, EnemyRole, AttackResult, SpellAttackResult, SpellSaveResult, WorldState, NemesisRecord, DungeonMaterialSpec, AbilityKey } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { logError } from '../logger.ts';
import { renderRoleTemplatesForPrompt } from '../combat/ai/roleTemplates.ts';

function normalizeCreatureType(t: unknown): CreatureType {
  return CREATURE_TYPES.includes(t as CreatureType) ? (t as CreatureType) : 'Humanoid';
}

// Unlike creatureType, an unrecognized/missing role stays undefined rather than defaulting —
// Creature/planGenerator already treat "no role" as plain melee-only (today's pre-role behavior).
function normalizeRole(r: unknown): EnemyRole | undefined {
  return ENEMY_ROLES.includes(r as EnemyRole) ? (r as EnemyRole) : undefined;
}

const FALLBACK_ENEMY: EnemyStatBlock = {
  id: 'fallback-1', name: 'Brigand', cr: 0.125, hp: 11, ac: 12, speed: 30,
  stats: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  attacks: [{ name: 'Scimitar', bonus: 3, damage: '1d6+1' }],
  creatureType: 'Humanoid',
  role: 'Infantry',
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
      "attacks": [{ "name": "Attack", "bonus": 3, "damage": "1d6+1" }],
      "creatureType": "one of: ${CREATURE_TYPES.join('|')}",
      "role": "one of: ${ENEMY_ROLES.join('|')}",
      "actions": "optional — only for roles whose kit needs more than attacks[], see role reference below"
    }
  ]
}
${nemesisBlock}${combatantBlock}
Rules: 1-3 enemies, MEDIUM difficulty scaled to the party's ACTUAL current state below — real level, AC, and current HP, not an assumed standard 4-person party. A party of one gets a correspondingly lighter encounter than a party of four; a party already down HP from a prior fight gets a lighter encounter than a party at full HP. Use official 5e monster stat blocks as reference for the base numbers, then adjust to fit the party size and state given.${combatants.length ? '' : ' Base the enemies on whoever/whatever is described as hostile in the recent transcript below — do not introduce a creature type unconnected to what has already been narrated.'}

Every enemy needs a role — pick whichever fits what's actually being narrated, and vary roles across a multi-enemy group rather than giving them all the same one:
${renderRoleTemplatesForPrompt()}

Return ONLY valid JSON, no markdown fences, no explanation.`;

  try {
    const raw = await adapter.complete(`${systemPrompt}\n\nParty:\n${partyLines}\n\nRecent events:\n${transcript}`);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { enemies?: EnemyStatBlock[] };
    const enemies = parsed.enemies ?? [];
    return enemies.length
      ? enemies.map((e, i) => {
        const { role: rawRole, ...rest } = e;
        const role = normalizeRole(rawRole);
        return { ...rest, id: e.id || `enemy-${i + 1}`, creatureType: normalizeCreatureType(e.creatureType), ...(role !== undefined ? { role } : {}) };
      })
      : [FALLBACK_ENEMY];
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

// improvisedAction: the player's own words for a freeform attack (e.g. chat.ts's
// "improvised action" stub weapon carries no real prop, so the flavour LLM would otherwise
// invent one out of thin air — grounding it in what was actually typed stops it hallucinating
// gear the character doesn't own, like a bottle when their weapon is a dagger).
export async function generateCombatFlavour(result: AttackResult | SpellAttackResult, adapter: StoryProviderAdapter, improvisedAction?: string): Promise<string | null> {
  const actionName = 'weaponName' in result ? result.weaponName : result.spellName;
  const outcome = result.hit
    ? `HIT for ${result.damage} ${result.damageFormula ? `(${result.damageFormula})` : ''} damage.${result.targetDead ? ' Target is slain.' : ` ${result.targetName} has ${result.remainingHp} HP remaining.`}`
    : `MISS — the blow fails to land (rolled ${result.total} vs AC ${result.ac}).`;
  const actionLine = improvisedAction
    ? `${result.attackerName} attacks ${result.targetName}, described as: "${improvisedAction}". Base the narration on exactly what's described — do not invent a different weapon or prop.`
    : `${result.attackerName} attacks ${result.targetName} with their ${actionName}.`;

  return llmText([
    {
      role: 'system',
      content: 'You are a punchy D&D combat narrator. Write ONE short sentence (max 15 words) describing the action. Style: visceral action verbs and impact sound effects — "looses an arrow, SMACK into the goblin\'s shoulder" — not flowery metaphor. No purple prose: no similes, no "light fading from eyes", no poetic mortality language, no internal feelings. Unless the target is slain, do NOT imply they are dying, fatally wounded, or near death — a hit is a hit, not a death scene. Never mention dice, numbers, or HP. Never use a gendered pronoun (he/him/she/her) for a character — use their name instead.',
    },
    {
      role: 'user',
      content: `${actionLine} ${outcome}`,
    },
  ], adapter);
}

export async function generateSpellSaveFlavour(result: SpellSaveResult, adapter: StoryProviderAdapter): Promise<string | null> {
  const outcomeLines = result.outcomes.map(o => {
    // A failed save with no immediate damage (e.g. Tasha's Caustic Brew — no on-cast damage,
    // just a lingering effect that ticks next turn) still needs to read as a failure, not a
    // no-op — 'is affected' was vague enough that narration sometimes came out sounding like
    // everyone saved.
    const fate = o.targetDead ? 'is slain' : o.saved ? 'resists the effect' : o.damage != null ? `takes ${o.damage} damage` : 'fails to resist and is affected';
    return `${o.targetName} ${fate}`;
  }).join('; ');

  return llmText([
    {
      role: 'system',
      content: 'You are a punchy D&D combat narrator. Write ONE short sentence (max 20 words) describing a spell taking effect on its target(s). Style: visceral action verbs and impact — not flowery metaphor. No purple prose: no similes, no "light fading from eyes", no poetic mortality language, no internal feelings. Unless a target is slain, do NOT imply they are dying, fatally wounded, or near death. Never mention dice, numbers, DCs, or HP. Never use a gendered pronoun (he/him/she/her) for a character — use their name instead.',
    },
    {
      role: 'user',
      content: `${result.casterName} casts ${result.spellName}. ${outcomeLines}.`,
    },
  ], adapter);
}

export interface ImprovisedActionResult {
  type: 'attack' | 'use_item' | 'aoe_damage' | 'question';
  answer: string;
  dc?: number;
  stat?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  damageFormula?: string;
  damageType?: string;
  targetId?: string;
  itemId?: string;
  radiusFt?: number;
  originObjectId?: string;
  originGx?: number;
  originGy?: number;
  saveAbility?: AbilityKey;
}

export async function resolveImprovisedAction(
  context: {
    playerName: string; playerClass: string; message: string; enemies: EnemyStatBlock[]; recentChat: string;
    inventory: { id: string; name: string; quantity: number }[];
    knownSpells: string[];
    objects: { id: string; name: string }[];
    roomBounds?: { x: number; y: number; width: number; height: number };
  },
  adapter: StoryProviderAdapter,
): Promise<ImprovisedActionResult | null> {
  const enemyList = context.enemies.map(e => `${e.name} (id: ${e.id}, HP: ${e.hp}, AC: ${e.ac})`).join(', ');
  const inventoryList = context.inventory.map(i => `${i.name} (id: ${i.id}, qty: ${i.quantity})`).join(', ') || 'none';
  const knownSpellsList = context.knownSpells.join(', ') || 'none';
  const objectList = context.objects.map(o => `${o.name} (id: ${o.id})`).join(', ') || 'none';
  const roomBoundsLine = context.roomBounds
    ? `Room grid bounds (only relevant if targeting something NOT in the Objects list): x ${context.roomBounds.x}-${context.roomBounds.x + context.roomBounds.width}, y ${context.roomBounds.y}-${context.roomBounds.y + context.roomBounds.height}`
    : '';

  return llmJson<ImprovisedActionResult>([
    {
      role: 'system',
      content: `You are a D&D 5e DM running a live combat encounter. A player says something during their turn.
Determine if it is: (A) an improvised attack on a creature, (B) using/consuming an item from their inventory, (C) an area-of-effect action against a location or object (igniting something explosive, burning a structure, etc.), or (D) a question or statement requiring a DM response.

Enemies present: ${enemyList}
Inventory: ${inventoryList}
Known spells: ${knownSpellsList}
Objects in the room: ${objectList}
${roomBoundsLine}

Respond with JSON only:
{ "type": "attack"|"use_item"|"aoe_damage"|"question", "answer": "narrative text (always required)", "dc": <save/attack DC>, "stat": "str|dex|con|int|wis|cha", "damageFormula": "XdY+Z", "damageType": "bludgeoning|piercing|slashing|fire|...", "targetId": "<enemy id if attack>", "itemId": "<inventory id if use_item>", "radiusFt": <blast radius if aoe_damage>, "originObjectId": "<object id if aoe_damage targets something in Objects list>", "originGx": <grid x if aoe_damage has no matching object>, "originGy": <grid y if aoe_damage has no matching object>, "saveAbility": "str|dex|con|int|wis|cha" }

If type is "use_item", only use an id that appears in Inventory above — never invent one. If type is "aoe_damage" and the target matches something in Objects, set originObjectId to its id and do NOT invent originGx/originGy. Only fall back to originGx/originGy (within Room grid bounds) when nothing in Objects matches. If the player names a specific spell by name (e.g. "I cast firebolt") that does NOT appear in Known spells above, this is invalid — return type "question" with an answer explaining they don't know that spell, and do not resolve any attack/damage for it. Improvised (non-spell) actions are unaffected by this check. If type is "question", only "type" and "answer" are needed. Be fair but decisive on DCs.`,
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

// materials must already be padded to exactly 16 entries (see dungeon/tilesets.ts's padMaterials)
// — a real DungeonMaterialSpec per used slot, plus a repeated one (marked `variantOf`) for any
// slot beyond the real count, cycling round-robin through the real materials so the crop grid
// stays a fixed 4x4 regardless of how many distinct materials this dungeon's rooms actually asked
// for, while every slot still renders as a genuine (if variant) texture instead of dead space.
export function buildDynamicTilesetPrompt(theme: string, materials: (DungeonMaterialSpec & { variantOf?: number })[]): string {
  const lines = materials.map((m, i) => m.variantOf
    ? `${i + 1}. **${m.key}** — a variant of #${m.variantOf}: the same material, must merge and tile seamlessly with it, but with a bit of extra visual variety (different crack/wear/stain pattern, slight tonal shift) so it doesn't read as an exact duplicate. ${m.description}`
    : `${i + 1}. **${m.key}** — ${m.description}`);

  // Explicit grid layout as a literal table (not just a numbered list) — the model was
  // misreading numbered-list order as loose ordering rather than fixed grid position, producing
  // materials in the wrong cells. Spelling out row/column position directly removes that ambiguity.
  const gridRows: string[] = [];
  for (let r = 0; r < 4; r++) {
    const cells = materials.slice(r * 4, r * 4 + 4).map(m => m.key);
    gridRows.push(`Row ${r + 1}: ${cells.join(' | ')}`);
  }
  const gridTable = gridRows.join('\n');

  return `Generate a **2D top-down seamless texture atlas** for a dungeon crawler.

# THEME

**${theme}**

The theme must strongly influence colour palette, material condition (wear, grime, damage), detailing, and interpretation of every material — but NEVER lighting. Do not render mood, atmosphere, or ambience as darkening, shadow, or vignette anywhere in the texture. A "${theme}" surface must still be lit completely flat and neutral — the theme lives entirely in what the material looks like, never in how it's lit.

The textures should clearly feel as though they belong to the specified theme through colour and material detail alone.

# OUTPUT

Create a single texture atlas:

* **4 columns**
* **4 rows**
* **16 textures**
* Each texture is **1:1 square**
* Every texture occupies exactly the same amount of space
* Complete atlas aspect ratio: **1:1**
* Target atlas size: **1024 × 1024**
* Target texture size: **256 × 256**

No gaps or padding between textures.

# GRID LAYOUT (exact position — this is a literal map of the atlas, not a loose ordering)

Each cell below MUST contain exactly the material named at that position. Do not reorder, shift, merge, or drop any cell.

${gridTable}

# MATERIALS (detail for each — numbers match left-to-right, top-row-down reading order of the grid above)

${lines.join('\n\n')}

Each material must be immediately recognizable while being visually interpreted through **${theme}**. A variant slot must still clearly read as the same material as the one it's a variant of.

# TEXTURE REQUIREMENTS

Every texture must be a **flat, top-down material surface** designed for use as a repeating game texture.

Each individual texture must be **seamlessly tileable on both axes**.

The left edge must naturally continue into the right edge.

The top edge must naturally continue into the bottom edge.

Treat each texture as a sample of a larger continuous surface, **not as an individual physical tile or panel** — even a plank/board/brick material must have its planks/boards/bricks running continuously through the edges of the cell into whatever's next to it, not one complete plank/board/brick centered in its own cell with a shadow around it.

Brightness must be perfectly even across the ENTIRE texture, corner to corner — the center and the edges/corners of every texture must be the exact same brightness. This is the single most important rule: even a faint darkening toward the edges (a vignette, ambient occlusion, or a drop shadow implying a separate panel) will make the atlas look like a grid of distinct tiles instead of one continuous surface once cropped and repeated — which defeats the entire purpose of this atlas.

There must be:

* NO borders
* NO bevels
* NO frames
* NO outlines
* NO gaps
* NO padding
* NO edge shadows
* NO edge highlights
* NO vignette
* NO ambient occlusion darkening the edges or corners of a texture
* NO visible square boundaries
* NO perspective
* NO directional scene lighting
* NO text or labels

Use consistent, neutral, diffuse, shadowless top-down lighting, identical in brightness everywhere in the image.

The materials should touch directly with no separators, in the exact order listed above.

# PRIORITIES

1. Perfectly even brightness corner-to-corner — no vignette, no edge/corner darkening, no per-tile shadow
2. Seamless repetition
3. Strong **${theme}** identity (through colour/material only, never lighting)
4. Correct left-to-right, top-to-bottom order as listed above
5. Square 1:1 individual textures
6. Clearly distinguishable materials
7. Cohesive art direction`;
}

export interface CreaturePortraitEntry {
  name: string;
  appearance: string;
  isBoss?: boolean;
}

// Always exactly 16 slots (4x4) — entries beyond the caller's list are padded with a blank black
// filler cell so the grid/crop math stays fixed regardless of how many creatures a given batch
// actually has (see dungeon/creaturePortraits.ts, which never sends more than 16).
export function buildCreaturePortraitPrompt(entries: CreaturePortraitEntry[]): string {
  const real = entries.slice(0, 16);
  const lines = real.map((e, i) => {
    const bossNote = e.isBoss ? ' (boss — render largest/most imposing of the set)' : '';
    return `${i + 1}. **${e.name}**${bossNote} — ${e.appearance}`;
  });
  if (real.length < 16) {
    const from = real.length + 1;
    const rangeLabel = from === 16 ? '16' : `${from}-16`;
    lines.push(`${rangeLabel}. Blank magenta square (hex approximately #FF00FF, flat and solid, no gradient) — this portrait is just blank magenta, no art, no red background. The purpose of this portrait is to keep the crop grid of the others consistent.`);
  }

  return `Generate a **2D character portrait atlas** for a dungeon crawler's enemy tokens.

# OUTPUT

Create a single portrait atlas:

* **4 columns**
* **4 rows**
* **16 portraits**
* Every cell is an **exact 1:1 square: width equals height, precisely, no exceptions** — never a rectangle, never taller than wide or wider than tall
* Every cell is exactly the same size as every other cell
* Complete atlas aspect ratio: **1:1**
* Atlas size: **1024 × 1024** — an exact square, so 1024 ÷ 4 = 256 in both directions
* Individual cell size: **256 × 256**, exactly — equal width and height

# GRID LINES

Draw a thin, solid, flat black line, about 4% of one cell's width thick, running along every *interior* boundary between cells — both the vertical lines between columns and the horizontal lines between rows, forming a literal 4×4 grid of exact squares over the whole atlas. Center the line exactly on the boundary, half its thickness in each of the two cells it separates. Every cell enclosed by these lines must measure exactly 256 × 256 — identical width and height, on a perfectly even 4×4 spacing with no cell larger or smaller than another. This grid is a cropping guide and will be cut out afterward — it is not part of the final art.

Do **not** draw this line, or any line, along the four outer edges of the atlas (the very top, bottom, left, and right of the whole 1024×1024 image). There is a line between cell 1 and cell 2, but no line above cell 1, below cell 13, left of cell 1, or right of cell 4/8/12/16 — those four sides of the atlas are the plain background, uninterrupted, right up to the image's own edge. Only the 3 internal vertical lines and 3 internal horizontal lines exist.

Every portrait's artwork — its full extent on all sides, including hair, horns, raised weapons, or tall headwear — must stay entirely on its own side of these lines. Treat each grid line as a hard wall: no part of a portrait may touch, cross, or be drawn over it.

# BACKGROUND

Every single portrait must sit on the exact same **flat, solid, saturated red background** (hex approximately #E01414, no gradient, no texture, no vignette, no shadow falloff) — identical red value in all 16 cells, edge to edge, so each portrait can be cleanly key-cropped later.

# CREATURES (in order — left to right, top row, then each row down)

${lines.join('\n\n')}

# PORTRAIT REQUIREMENTS

Each portrait is a **bust/head-and-shoulders framing**, front-facing or three-quarter view, centered in its cell.

Every portrait, regardless of the creature's natural size or proportions, must be scaled down as needed so its full extent — including hair, horns, raised weapons, or tall headwear — fits entirely inside its own single square cell, centered, with a small margin on every side. Never enlarge a bust to the point where any part touches or crosses into a neighboring cell.

No environment, no scenery, no props beyond what's held/worn by the creature itself.

Consistent lighting direction and art style across all 16 — same rendering technique, same level of detail, same color saturation — so they read as one cohesive set, not 16 unrelated images.

There must be:

* NO frame, border, or line of any kind around the outer edge of the atlas — the grid lines exist ONLY between cells, never along the top, bottom, left, or right edge of the whole image
* NO text or labels
* NO numbering
* NO part of any portrait extending past its own cell's grid line into a neighboring cell — shrink the portrait to fit instead

# PRIORITIES

1. Every cell is an exact 1:1 square, all 16 the same size, laid out on an even 4×4 grid
2. The thin black grid line is present and unbroken on every cell boundary
3. Instantly readable creature silhouette/identity at small size
4. Every portrait fits entirely within its own grid-lined cell with margin on all sides — no overflow into neighboring cells
5. Exact same flat red background in every cell
6. Consistent art style and lighting across all 16 portraits
7. Correct left-to-right, top-to-bottom order as listed above`;
}

export interface PropSpriteEntry {
  name: string;
  description: string;
}

// Always exactly 36 slots (6x6) — the grid the prop atlas pipeline uses (see dungeon/props.ts),
// padded with a blank filler cell so crop math stays fixed regardless of batch size, same pattern
// as buildCreaturePortraitPrompt. `transparent` selects a real alpha-channel background (gpt-image
// family, via the provider's `background: 'transparent'` param) vs. a flat magenta chroma-key
// background that dungeon/props.ts strips out afterward (dall-e models, which have no real
// transparency option).
export function buildPropSpritePrompt(entries: PropSpriteEntry[], transparent: boolean, atlasSize: number): string {
  const real = entries.slice(0, 36);
  const lines = real.map((e, i) => `${i + 1}. **${e.name}** — ${e.description}`);
  if (real.length < 36) {
    const from = real.length + 1;
    const rangeLabel = from === 36 ? '36' : `${from}-36`;
    lines.push(`${rangeLabel}. Blank ${transparent ? 'transparent' : 'magenta'} square — this sprite is just blank. The purpose of this sprite is to keep the crop grid of the others consistent.`);
  }
  const tileSize = Math.round(atlasSize / 6);

  const backgroundSection = transparent
    ? `# BACKGROUND

Every single sprite must have a **fully transparent background** (real alpha channel, not a solid color) — no ground plane, no shadow cast onto anything, no scenery. Just the isolated object floating on transparency, identical treatment in all 36 cells.`
    : `# BACKGROUND

Every single sprite must sit on the exact same **flat, solid, saturated magenta background** (hex approximately #FF00FF, no gradient, no texture, no vignette, no shadow falloff onto the background) — identical magenta value in all 36 cells, edge to edge, so each sprite can be cleanly chroma-keyed out later. The object itself must never contain this exact magenta color anywhere in its own materials/design.`;

  return `Generate a **2D object/prop sprite atlas** for a dungeon crawler's map furniture and decor.

# OUTPUT

Create a single sprite atlas:

* **6 columns**
* **6 rows**
* **36 sprites**
* Every cell is an **exact 1:1 square: width equals height, precisely, no exceptions** — never a rectangle, never taller than wide or wider than tall
* Every cell is exactly the same size as every other cell
* Complete atlas aspect ratio: **1:1**
* Atlas size: **${atlasSize} × ${atlasSize}** — an exact square, so ${atlasSize} ÷ 6 = ${tileSize} in both directions
* Individual cell size: **${tileSize} × ${tileSize}**, exactly — equal width and height

# GRID LINES

Draw a thin, solid, flat black line, about 4% of one cell's width thick, running along every *interior* boundary between cells — both the vertical lines between columns and the horizontal lines between rows, forming a literal 6×6 grid of exact squares over the whole atlas. Center the line exactly on the boundary, half its thickness in each of the two cells it separates. Every cell enclosed by these lines must measure exactly ${tileSize} × ${tileSize} — identical width and height, on a perfectly even 6×6 spacing with no cell larger or smaller than another. This grid is a cropping guide and will be cut out afterward — it is not part of the final art.

Do **not** draw this line, or any line, along the four outer edges of the atlas (the very top, bottom, left, and right of the whole 2048×2048 image). There is a line between cell 1 and cell 2, but no line above cell 1, below cell 36, left of cell 1, or right of cell 6/12/18/24/30/36 — those four sides of the atlas are the plain background, uninterrupted, right up to the image's own edge. Only the 5 internal vertical lines and 5 internal horizontal lines exist.

Every object's artwork — its full extent on all four sides, including tall or thin parts — must stay entirely on its own side of these lines. Treat each grid line as a hard wall: no part of an object may touch, cross, or be drawn over it.

${backgroundSection}

# PROPS (in order — left to right, top row, then each row down)

${lines.join('\n\n')}

# SPRITE REQUIREMENTS

Each sprite is the **complete object**, viewed from a three-quarter top-down angle matching a tabletop VTT token (the same angle a miniature would be viewed from on a table).

Every object, regardless of its natural shape, must be scaled down as needed so its full extent — including any long, tall, or thin parts — fits entirely inside its own single square cell, centered, with a small margin on every side. An elongated object (a ladder, a spear, a table) is drawn smaller within its cell, never enlarged to the point of touching or crossing into a neighboring cell.

No environment, no other objects, no characters — just the one named object per cell.

Consistent lighting direction and art style across all 36 — same rendering technique, same level of detail, same color saturation — so they read as one cohesive set, not 36 unrelated images.

There must be:

* NO frame, border, or line of any kind around the outer edge of the atlas — the grid lines exist ONLY between cells, never along the top, bottom, left, or right edge of the whole image
* NO text or labels
* NO numbering
* NO shadow of any kind${transparent ? ' beyond a small contact shadow directly under the object' : ' — not even a small contact shadow. A shadow fading into the magenta background stops being pure magenta, which breaks clean chroma-keying and leaves a visible ring around the object. The object must sit directly on the flat magenta with nothing under it'}
* NO part of any object extending past its own cell's grid line into a neighboring cell — shrink the object to fit instead

# PRIORITIES

1. Every cell is an exact 1:1 square, all 36 the same size, laid out on an even 6×6 grid
2. The thin black grid line is present and unbroken on every cell boundary
3. Instantly readable object silhouette/identity at small size
4. Every object fits entirely within its own grid-lined cell with margin on all sides — no overflow into neighboring cells
5. ${transparent ? 'Fully transparent background in every cell' : 'Exact same flat magenta background in every cell'}
6. Consistent art style and lighting across all 36 sprites
7. Correct left-to-right, top-to-bottom order as listed above`;
}

export interface StoryboardSubject {
  name: string;
  species?: string;
  class?: string;
  backstory?: string;
}

// A matched visual/narration pair for one storyboard panel — produced together by
// buildStoryboardBeatsPrompt so the image atlas and the voiceover are guaranteed to agree on what
// each panel actually shows, instead of the image call and a separate caption call each condensing
// the same raw backstory independently and landing on different, sometimes redundant, beats.
export interface StoryboardBeat {
  visual: string;
  narration: string;
}

// Single condensation pass — read once, split once. Runs BEFORE buildStoryboardPrompt; its
// "visual" fields become that prompt's per-panel breakdown, and its "narration" fields become the
// slide captions directly, with no second independent read of the backstory. Fixes two problems
// confirmed live: redundant slides (two panels that were really the same beat) and captions that
// described something other than what the image actually showed — both symptoms of the old
// image-call and caption-call each choosing beats on their own.
export function buildStoryboardBeatsPrompt(character: StoryboardSubject, count: number): string {
  const roleLine = [character.species, character.class].filter(Boolean).join(' ');
  return `You are breaking a tabletop RPG character's backstory into exactly ${count} key moments for a cold-open cutscene storyboard (Resident Evil 2/3 style) — a sequence of panels with a first-person voiceover.

CHARACTER: ${character.name}${roleLine ? `, a ${roleLine}` : ''}

BACKSTORY:
${(character.backstory ?? '').slice(0, 2400)}

Identify the ${count} MOST IMPORTANT, VISUALLY DISTINCT moments in this backstory, in chronological order — the turning points that actually matter, not incidental detail.

Each moment must:
* Depict a clearly different scene, action, location, or turning point than every other moment — never split one real beat into two, and never promote a minor detail to its own moment when it isn't essential to the arc
* Together cover the full arc: start near the character's origin/ordinary world and end on the moment their story arrives at the present, right before the game begins
* Be something that can be drawn as ONE concrete scene — a specific action, place, and moment, not an abstract feeling or a summary of a whole stretch of time

For each moment, produce a matched pair:
* "visual": a concrete scene description for an image generator — subject, action, setting, mood, 1-2 sentences, no dialogue, no text-in-image
* "narration": a first-person voiceover line spoken by ${character.name}, describing EXACTLY what's shown in that same "visual" — never narrating something the image doesn't depict. 1-3 short sentences, never a full paragraph.

Narration style — grounded storytelling, not a police report and not a poem. Write like someone who actually lived it, telling it well: concrete events, real stakes, some natural rhythm and weight to the sentences — but every line still has to sound like something a real person would actually say out loud, not a novelist reaching for effect. Avoid ornamental metaphor/simile that stands IN PLACE of the fact ("the old wood began", "bleed quietly enough", "the fog swallowed the road") — but a plain image tied directly to something actually in the scene (a locked gate, a burned house, a name on a grave) is fine and often stronger than the bare fact alone. Vary sentence length for rhythm — don't force every line into the same flat subject-verb-object shape. The events should carry the emotional weight; the wording supports them, it doesn't perform instead of them.

Respond with ONLY a JSON array of exactly ${count} objects, no other text:
[{ "visual": "...", "narration": "..." }, ...]`;
}

export function buildStoryboardPrompt(
  character: StoryboardSubject,
  appearanceDescription: string,
  beats: string[], // one "visual" description per panel, already condensed — see buildStoryboardBeatsPrompt
  cols: number,
  rows: number,
  atlasW: number,
  atlasH: number,
  tileW: number,
  tileH: number,
): string {
  const count = cols * rows;
  const roleLine = [character.species, character.class].filter(Boolean).join(' ');
  // Literal per-position table, not just a numbered list — same fix buildDynamicTilesetPrompt uses
  // for materials: a numbered list reads as loose ordering to the model, a table reads as fixed
  // grid position.
  const panelTable = beats.map((b, i) => `Panel ${i + 1}: ${b}`).join('\n');
  return `Create a **cinematic opening storyboard** for a tabletop RPG character, in the style of a survival-horror game's cold-open cutscene (like Resident Evil 2/3's title sequence) — a grid of moody, painterly panels that tell the character's backstory up to the start of the game.

# CHARACTER

Name: ${character.name}${roleLine ? `\n${roleLine}` : ''}
Appearance: ${appearanceDescription}

# PANELS (exact position — this is a literal map of the atlas, not a loose ordering)

Each cell below MUST depict exactly the moment described at that position, and nothing else. Do not reorder, merge, split, or drop any panel; do not add a moment that isn't listed.

${panelTable}

# OUTPUT

Create a single storyboard atlas:

* **${cols} columns, ${rows} rows** (${count} panels total, read left-to-right then top-to-bottom, in the order listed above)
* Every cell is exactly the same size as every other cell
* Complete atlas size: **${atlasW} × ${atlasH}** pixels, exactly — this is the actual canvas you are rendering, not a suggestion
* Individual cell size: **${tileW} × ${tileH}** pixels, exactly — ${atlasW} ÷ ${cols} = ${tileW}, ${atlasH} ÷ ${rows} = ${tileH}
* Each panel is a self-contained cinematic scene depicting exactly its own listed moment, composed to fill its own ${tileW}×${tileH} cell — never composed as if the cell were square or a different shape than stated
* The character (matching the appearance described above) should appear consistently across every panel they're present in — same face, hair, build, clothing style

# STYLE

Dark, painterly, moody illustration — heavy shadow, restrained desaturated palette, dramatic single-source lighting. Same rendering technique, same level of detail, same color grade across all ${count} panels, so they read as one cohesive sequence rather than unrelated images.

# RULES

* NO text, lettering, numbers, or captions anywhere in the image — the story is told entirely through the imagery, captions are added separately afterward
* NO frame or border around the outer edge of the atlas
* A thin dark divider line between panels is fine but not required
* Every panel fits entirely within its own ${tileW}×${tileH} cell — nothing overflows into a neighboring panel, nothing composed for a different aspect ratio than the cell actually is
* Panels progress in a clear visual chronology from the character's past toward the present moment the game begins`;
}

// Dungeon-crawl worlds only — the opening cold-open cutscene for the SCENARIO itself, not any one
// character (the party doesn't exist yet when this generates). Same COLS/ROWS/atlas math and same
// beats-then-image two-pass pipeline as the character pair above (see runScenarioStoryboardPipeline
// in dungeon/storyboard.ts) — deliberately mirrored, just without a character to describe or keep
// consistent, and with an explicit ban on drawing anyone meant to represent the party.
export interface ScenarioStoryboardSubject {
  title: string;
  synopsis: string;
}

export function buildScenarioStoryboardBeatsPrompt(subject: ScenarioStoryboardSubject, count: number): string {
  return `You are breaking a tabletop RPG dungeon-crawl scenario into exactly ${count} key moments for a cold-open cutscene storyboard (Resident Evil 2/3 style) — a sequence of panels with a second-person voiceover.

SCENARIO: ${subject.title}

SYNOPSIS:
${subject.synopsis.slice(0, 2400)}

Identify the ${count} MOST IMPORTANT, VISUALLY DISTINCT moments this synopsis implies, in chronological order — the turning points that lead up to the party arriving at the dungeon's threshold, right before the game begins.

Each moment must:
* Depict a clearly different scene, action, or turning point than every other moment — never split one real beat into two
* Together cover the arc implied by the synopsis, ending on the moment of arrival at the dungeon
* Be something that can be drawn as ONE concrete scene — a specific action, place, and moment, not an abstract feeling
* NEVER depict a figure meant to represent the party or any player character — no protagonist, no silhouette standing in for "you". Show environment, threats/monsters, objects, wreckage, POV-style framing (hands, a door, a weapon) instead. The party is never on screen.

For each moment, produce a matched pair:
* "visual": a concrete scene description for an image generator — subject, action, setting, mood, 1-2 sentences, no dialogue, no text-in-image, no protagonist figure
* "narration": a second-person voiceover line describing EXACTLY what's shown in that same "visual" — "you" and "your", present or immediate-past tense, never narrating something the image doesn't depict. 1-3 short sentences, never a full paragraph.

Narration style — grounded and dramatic, not a police report and not a poem. Concrete events, real stakes, some natural rhythm and weight — but every line still has to sound like something that could be said out loud, not a novelist reaching for effect. A plain image tied directly to something actually in the scene (a locked gate, a burning street, a name on a sign) is fine and often stronger than the bare fact alone. Vary sentence length for rhythm.

Respond with ONLY a JSON array of exactly ${count} objects, no other text:
[{ "visual": "...", "narration": "..." }, ...]`;
}

export function buildScenarioStoryboardPrompt(
  subject: ScenarioStoryboardSubject,
  beats: string[], // one "visual" description per panel, already condensed — see buildScenarioStoryboardBeatsPrompt
  cols: number,
  rows: number,
  atlasW: number,
  atlasH: number,
  tileW: number,
  tileH: number,
): string {
  const count = cols * rows;
  const panelTable = beats.map((b, i) => `Panel ${i + 1}: ${b}`).join('\n');
  return `Create a **cinematic opening storyboard** for a tabletop RPG dungeon-crawl scenario, in the style of a survival-horror game's cold-open cutscene (like Resident Evil 2/3's title sequence) — a grid of moody, painterly panels that tell the lead-up to the party's arrival.

# SCENARIO

Title: ${subject.title}

# PANELS (exact position — this is a literal map of the atlas, not a loose ordering)

Each cell below MUST depict exactly the moment described at that position, and nothing else. Do not reorder, merge, split, or drop any panel; do not add a moment that isn't listed.

${panelTable}

# OUTPUT

Create a single storyboard atlas:

* **${cols} columns, ${rows} rows** (${count} panels total, read left-to-right then top-to-bottom, in the order listed above)
* Every cell is exactly the same size as every other cell
* Complete atlas size: **${atlasW} × ${atlasH}** pixels, exactly — this is the actual canvas you are rendering, not a suggestion
* Individual cell size: **${tileW} × ${tileH}** pixels, exactly — ${atlasW} ÷ ${cols} = ${tileW}, ${atlasH} ÷ ${rows} = ${tileH}
* Each panel is a self-contained cinematic scene depicting exactly its own listed moment, composed to fill its own ${tileW}×${tileH} cell — never composed as if the cell were square or a different shape than stated

# RULE — NO PROTAGONIST

No panel may depict a figure meant to represent the party or a player character — not a silhouette, not a faceless shape, nothing standing in for "you". The party's appearance isn't decided yet. Show environment, threats/monsters, objects, wreckage, and POV-style framing (a hand on a door, a weapon held up) instead — every panel is something the party could be seeing or the aftermath of something that happened to them, never a picture of them.

# STYLE

Dark, painterly, moody illustration — heavy shadow, restrained desaturated palette, dramatic single-source lighting. Same rendering technique, same level of detail, same color grade across all ${count} panels, so they read as one cohesive sequence rather than unrelated images.

# RULES

* NO text, lettering, numbers, or captions anywhere in the image — the story is told entirely through the imagery, captions are added separately afterward
* NO frame or border around the outer edge of the atlas
* A thin dark divider line between panels is fine but not required
* Every panel fits entirely within its own ${tileW}×${tileH} cell — nothing overflows into a neighboring panel, nothing composed for a different aspect ratio than the cell actually is
* Panels progress in a clear visual chronology, ending on the moment of arrival at the dungeon`;
}

export interface WorldMapLocation {
  name: string;
  description: string;
}

// Per-entry cap (not a whole-blob slice) — so the list scales with however many locations the
// world actually has instead of silently dropping entries once the joined text got long, the way
// a single slice(0, N) over the whole blob used to (same failure buildCreaturePortraitPrompt /
// buildPropSpritePrompt avoid by enumerating fixed entries instead of a free-text summary).
export function buildWorldMapPrompt(worldMd: string, locations: WorldMapLocation[], tags: string[]): string {
  const tagLine = tags.length ? tags.join(', ') : 'dark fantasy';
  const locationLines = locations.map((l, i) => `${i + 1}. **${l.name}** — ${l.description.slice(0, 200) || 'no further detail given'}`);

  return `Create a FANTASY WORLD MAP in the style of classic RPG cartography. This map must be scoped exclusively to the world described below — no generic fantasy tropes that contradict the setting. Every visual choice (palette, terrain, iconography, atmosphere) must reflect the specific tone and themes of this campaign.

CAMPAIGN TAGS (these define the mood, genre, and visual identity of this world — the map must embody them):
${tagLine}

STYLE RULES (MANDATORY):
- Hand-drawn or painterly top-down world map aesthetic (like classic D&D sourcebook maps)
- Illustrated terrain features: mountains, forests, coastlines, rivers, deserts — styled to match the campaign tags above
- Colour palette, linework, and overall aesthetic derived from the campaign tags — not generic parchment if the setting doesn't call for it
- Decorative compass rose in a style matching the world's tone
- Rich, dense detail — no empty areas
- No grid, no UI, no text labels, no borders

WORLD CONTEXT

${worldMd.slice(0, 1500)}

LOCATIONS (exactly ${locations.length} total — every single one below MUST appear on the map as its own marked landmark or settlement with a small illustrative icon matching its description. Do not omit, merge, or substitute any entry, and do not add a location that isn't listed.)

${locationLines.join('\n')}

PRIORITIES
1. Every one of the ${locations.length} listed locations is present and individually identifiable on the map — completeness beats density
2. Palette, terrain, and iconography faithfully reflect the campaign tags and world context above
3. Rich, cohesive, hand-drawn cartography aesthetic with no empty/dead space`;
}
