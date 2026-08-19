import { calcAC, CREATURE_TYPES, ENEMY_ROLES } from 'shared';
import type { ChatPayload, Character, EnemyStatBlock, CreatureType, EnemyRole, AttackResult, SpellAttackResult, SpellSaveResult, WorldState, NemesisRecord, DungeonMaterialSpec } from 'shared';
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

export async function generateCombatFlavour(result: AttackResult | SpellAttackResult, adapter: StoryProviderAdapter): Promise<string | null> {
  const actionName = 'weaponName' in result ? result.weaponName : result.spellName;
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
      content: `${result.attackerName} attacks ${result.targetName} with their ${actionName}. ${outcome}`,
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
      content: 'You are a punchy D&D combat narrator. Write ONE short sentence (max 20 words) describing a spell taking effect on its target(s). Style: visceral action verbs and impact — not flowery metaphor. No purple prose: no similes, no "light fading from eyes", no poetic mortality language, no internal feelings. Unless a target is slain, do NOT imply they are dying, fatally wounded, or near death. Never mention dice, numbers, DCs, or HP.',
    },
    {
      role: 'user',
      content: `${result.casterName} casts ${result.spellName}. ${outcomeLines}.`,
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

// materials must already be padded to exactly 16 entries (see dungeon/tilesets.ts's padMaterials)
// — a real DungeonMaterialSpec per used slot, plus a repeated one (marked `variantOf`) for any
// slot beyond the real count, cycling round-robin through the real materials so the crop grid
// stays a fixed 4x4 regardless of how many distinct materials this dungeon's rooms actually asked
// for, while every slot still renders as a genuine (if variant) texture instead of dead space.
export function buildDynamicTilesetPrompt(theme: string, materials: (DungeonMaterialSpec & { variantOf?: number })[]): string {
  const lines = materials.map((m, i) => m.variantOf
    ? `${i + 1}. **${m.key}** — a variant of #${m.variantOf}: the same material, must merge and tile seamlessly with it, but with a bit of extra visual variety (different crack/wear/stain pattern, slight tonal shift) so it doesn't read as an exact duplicate. ${m.description}`
    : `${i + 1}. **${m.key}** — ${m.description}`);

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

# MATERIALS (in order — left to right, top row, then each row down)

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
    lines.push(`${rangeLabel}. Blank black square — this portrait is just blank and black. The purpose of this portrait is to keep the crop grid of the others consistent`);
  }

  return `Generate a **2D character portrait atlas** for a dungeon crawler's enemy tokens.

# OUTPUT

Create a single portrait atlas:

* **4 columns**
* **4 rows**
* **16 portraits**
* Each portrait is **1:1 square**
* Every portrait occupies exactly the same amount of space
* Complete atlas aspect ratio: **1:1**
* Atlas size: **1024 × 1024**
* Individual portrait size: **256 × 256**

No gaps or padding between portraits.

# BACKGROUND

Every single portrait must sit on the exact same **flat, solid, saturated red background** (no gradient, no texture, no vignette, no shadow falloff) — identical red value in all 16 cells, edge to edge, so each portrait can be cleanly key-cropped later.

# CREATURES (in order — left to right, top row, then each row down)

${lines.join('\n\n')}

# PORTRAIT REQUIREMENTS

Each portrait is a **bust/head-and-shoulders framing**, front-facing or three-quarter view, centered in its cell.

No environment, no scenery, no props beyond what's held/worn by the creature itself.

Consistent lighting direction and art style across all 16 — same rendering technique, same level of detail, same color saturation — so they read as one cohesive set, not 16 unrelated images.

There must be:

* NO borders
* NO frames
* NO outlines around the cells
* NO gaps or padding between cells
* NO text or labels
* NO numbering

# PRIORITIES

1. Instantly readable creature silhouette/identity at small size
2. Exact same flat red background in every cell
3. Consistent art style and lighting across all 16 portraits
4. Correct left-to-right, top-to-bottom order as listed above
5. No borders, frames, or background variation`;
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
export function buildPropSpritePrompt(entries: PropSpriteEntry[], transparent: boolean): string {
  const real = entries.slice(0, 36);
  const lines = real.map((e, i) => `${i + 1}. **${e.name}** — ${e.description}`);
  if (real.length < 36) {
    const from = real.length + 1;
    const rangeLabel = from === 36 ? '36' : `${from}-36`;
    lines.push(`${rangeLabel}. Blank ${transparent ? 'transparent' : 'magenta'} square — this sprite is just blank. The purpose of this sprite is to keep the crop grid of the others consistent.`);
  }

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
* Each sprite is **1:1 square**
* Every sprite occupies exactly the same amount of space
* Complete atlas aspect ratio: **1:1**
* Atlas size: **2048 × 2048**
* Individual sprite size: **~341 × 341**

No gaps or padding between sprites.

${backgroundSection}

# PROPS (in order — left to right, top row, then each row down)

${lines.join('\n\n')}

# SPRITE REQUIREMENTS

Each sprite is the **complete object**, viewed from a three-quarter top-down angle matching a tabletop VTT token (the same angle a miniature would be viewed from on a table), centered and filling most of its cell with a small margin.

No environment, no other objects, no characters — just the one named object per cell.

Consistent lighting direction and art style across all 36 — same rendering technique, same level of detail, same color saturation — so they read as one cohesive set, not 36 unrelated images.

There must be:

* NO borders
* NO frames
* NO outlines around the cells
* NO gaps or padding between cells
* NO text or labels
* NO numbering
* NO cast shadow beyond a small contact shadow directly under the object (skip shadow entirely on transparent-background sprites)

# PRIORITIES

1. Instantly readable object silhouette/identity at small size
2. ${transparent ? 'Fully transparent background in every cell' : 'Exact same flat magenta background in every cell'}
3. Consistent art style and lighting across all 36 sprites
4. Correct left-to-right, top-to-bottom order as listed above
5. No borders, frames, or background variation`;
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
