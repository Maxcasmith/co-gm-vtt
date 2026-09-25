import { PLOT_HOOK_TAGS, GENRE_SETTINGS, GENRE_TONES, GENRE_SETTING_DESCRIPTIONS, GENRE_TONE_DESCRIPTIONS } from 'shared';

type CampaignType = 'campaign' | 'one-shot' | 'dungeon-crawl';

// ── Shared lore instruction ───────────────────────────────────────────────────
// Appended to both prompts. Tells the model to honour named IPs when present
// without assuming every campaign is based on one.
const LORE_INSTRUCTION = `Where tags reference a named IP, setting, or genre (a game, film, book, historical era, etc.), draw from its established lore, proper nouns, named locations, and specific flavour — use the real names and details, not generic substitutes. For original or custom worlds, apply the same level of specificity using invented names and concrete details.`;

export function buildBackstoryCheckPrompt(
  worldLore: string,
  concept: { name: string; species: string; background: string; characterClass: string; backstory: string },
): string {
  return `You are a tabletop RPG session-zero advisor. Judge how well a player's character concept fits the TONE AND FEEL of the world below.

GM-ONLY WORLD LORE (the player has not seen this and must not learn it from you):
${worldLore || '(no world lore has been established yet — score based on internal consistency and genre fit only)'}

CHARACTER CONCEPT:
Name: ${concept.name || '(unnamed)'}
Species: ${concept.species || '(unspecified)'}
Background: ${concept.background || '(unspecified)'}
Class: ${concept.characterClass || '(unspecified)'}
Backstory: ${concept.backstory || '(none written yet)'}

Use the lore only to understand the world's genre, mood, register, technology/magic level, and cultures. Judge fit on:
- Tone and feel: does the backstory read like it belongs in this kind of world (its mood, its register, the kind of horror/wonder/grit it trades in)?
- Contradictions: does anything the player invented flatly contradict how the world works (e.g. a sunlit harbour city in a world with no sea)? Invented people, places, cults, gods, and history are GOOD — players adding lore is encouraged as long as it complements the world.
- Scale: is this a starting character, not already a legend or the world's saviour?
Do NOT penalise a backstory for not mentioning the world's factions, places, NPCs, or events. A backstory with no world references that matches the tone should score 70+.

Hard rules for everything you write (verdict, issues, suggestions):
- Never use a proper noun from the world lore.
- Never mention, hint at, or allude to the world's factions, NPCs, locations, history, secrets, or current events.
- Suggestions are about tone, framing, and hook strength (e.g. "lean the cult's language toward cold bureaucracy rather than fire-and-brimstone"), never about wiring the character into specific lore.

Return ONLY a single valid JSON object — no markdown fences, no explanation:

{
  "score": number (0-100, integer, how well the concept fits the world's tone and feel),
  "verdict": "string — one sentence summary of the fit",
  "issues": ["string — a tonal mismatch or contradiction, if any"],
  "suggestions": ["string — a concrete tone/framing change that would raise the score"]
}

If the concept already fits well, return an empty issues array and 1-2 small flavour suggestions rather than forcing problems that aren't there.`;
}

// Mirrors the canon lists in packages/client/src/character-creation/srd.ts (CLASSES/SPECIES/SKILLS/
// SPECIES_SUBSPECIES) — kept as a local copy since api does not import client code. Constrains the
// model to options the wizard actually supports, so every suggestion is one the player can
// immediately pick from the tiles. Outside development, only the SRD-playable subset
// (PLAYABLE_CLASSES/PLAYABLE_SPECIES) — Artificer and Aasimar exist but are hidden from players.
const SRD_ONLY = process.env.NODE_ENV !== 'development';
const CONCEPT_CLASSES = [...(SRD_ONLY ? [] : ['Artificer']), 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard'];
const CONCEPT_SPECIES = [...(SRD_ONLY ? [] : ['Aasimar']), 'Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath', 'Halfling', 'Human', 'Orc', 'Tiefling'];
const CONCEPT_SKILLS = ['Athletics', 'Acrobatics', 'Sleight of Hand', 'Stealth', 'Arcana', 'History', 'Investigation', 'Nature', 'Religion', 'Animal Handling', 'Insight', 'Medicine', 'Perception', 'Survival', 'Deception', 'Intimidation', 'Performance', 'Persuasion'];
const CONCEPT_SUBSPECIES: Record<string, string[]> = {
  Dragonborn: ['Chromatic', 'Gem', 'Metallic'],
  Elf: ['Drow', 'High Elf', 'Wood Elf'],
  Gnome: ['Forest Gnome', 'Rock Gnome'],
  Tiefling: ['Abyssal', 'Chthonic', 'Infernal'],
};
// Classes whose Spellcasting feature is actually active at character level 1 in 2024 rules. Rogue
// (Arcane Trickster) and Fighter (Eldritch Knight) only gain spells at level 3 via subclass, and
// Barbarian/Monk never get spells at all — so none of those satisfy a "casts spells from level 1"
// requirement, however tempting the flavor fit.
const CONCEPT_LEVEL_ONE_CASTERS = [...(SRD_ONLY ? [] : ['Artificer']), 'Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'];

export function buildCharacterConceptPrompt(concept: string): string {
  return `You are a tabletop RPG session-zero advisor helping a total beginner turn a character fantasy into an actual D&D 2024 (5.5e) character build.

PLAYER'S CONCEPT (their own words):
${concept}

Step 1 — before choosing anything, list out any explicit HARD mechanical requirements the player stated (e.g. "spells from level 1", "must dual-wield", "must wear heavy armor"). Every one of the 3 builds below must satisfy every hard requirement using rules and features that actually apply AT CHARACTER LEVEL 1 — a subclass feature gained later (e.g. Rogue's Arcane Trickster or Fighter's Eldritch Knight, both level 3) does NOT satisfy a "from level 1" requirement. If the concept requires casting spells from level 1, only choose from these classes, which are the only ones with an active Spellcasting feature at level 1: ${CONCEPT_LEVEL_ONE_CASTERS.join(', ')}.

Then suggest exactly 3 distinct, concrete builds that could bring this concept to life. Each build must use only real D&D 2024 options so the player can pick it straight from the character creator:
- class: exactly one of: ${CONCEPT_CLASSES.join(', ')}
- species: exactly one of: ${CONCEPT_SPECIES.join(', ')}
- subspecies: required and must be exactly one of that species's lineages if it has any (${Object.entries(CONCEPT_SUBSPECIES).map(([sp, subs]) => `${sp}: ${subs.join('/')}`).join('; ')}); otherwise null. Never credit a trait that only one lineage grants (e.g. a bonus cantrip, a specific resistance) to the species in general — name the exact lineage that grants it and put it here.
- skills: 2-4 from: ${CONCEPT_SKILLS.join(', ')}
- spells: 2-4 real D&D 2024 spell names that fit the class and concept (empty array if the class/build has no spells, e.g. a non-caster Fighter or Barbarian build)

Write for someone who has never played D&D before — plain English, no unexplained jargon. "reason" must justify BOTH the class AND the species/lineage choice specifically against this concept (not generic flavor text, not just restating the concept) — if a species is arbitrary and isn't earning its place (no trait, culture, or flavor reason tying it to the concept), pick Human instead of a random exotic species.

Make the 3 builds meaningfully different from each other (different class, or same class played a very different way) so the player has a real choice.

Return ONLY a single valid JSON object — no markdown fences, no explanation:
{
  "summary": "string — one warm sentence reflecting back what kind of character they're imagining",
  "options": [
    { "class": "string", "species": "string", "subspecies": "string or null", "skills": ["string"], "spells": ["string"], "reason": "string" }
  ]
}`;
}

export const BACKSTORY_HOOKS = ['tragedy', 'mystery', 'ambition', 'schooling or training'] as const;

// Shared by generate + rewrite. The world lore is GM-only — backstories set the character's
// starting point in the world's tone, and the VDM ties them into specifics later in play.
const BACKSTORY_CONTENT_RULES = `Structure:
- First: who the character was before the event that set them on their path — home, people, daily life, what they cared about.
- Then: the event that is still unresolved, or the reason that called them to adventure.

Rules:
- The world lore is GM-only. Use it only to match the world's tone, mood, register, and technology/magic level. Never use its proper nouns, and never mention its factions, NPCs, locations, history, secrets, or current events.
- Invent the character's own people, places, and history freely — these are open threads the GM will later tie into the world.
- Anything about where they are headed next stays light and vague. This is where their story begins, not ends.
- End on an open thread: an unanswered question, a person still out there, a promise not yet kept.
- A starting adventurer, not a legend — no world-saving deeds, no famous names.
- No headers, no bullet points, no markdown, no preamble — return only the backstory text itself.`;

export function buildBackstoryGeneratePrompt(
  worldLore: string,
  concept: { name: string; species: string; background: string; characterClass: string },
  hook: typeof BACKSTORY_HOOKS[number],
): string {
  return `You are a tabletop RPG writer. Write a short character backstory that fits the tone and feel of the world below.

GM-ONLY WORLD LORE:
${worldLore || '(no world lore has been established yet — invent grounded, genre-appropriate details)'}

CHARACTER CONCEPT:
Name: ${concept.name || '(unnamed — invent a fitting name)'}
Species: ${concept.species || '(unspecified — pick one that fits the world)'}
Background: ${concept.background || '(unspecified — pick one that fits the world)'}
Class: ${concept.characterClass || '(unspecified — pick one that fits the world)'}

The event that sets them on their path is built on this hook: ${hook}.

${BACKSTORY_CONTENT_RULES}

Write EXACTLY 2 paragraphs of prose — paragraph 1 is who they were before, paragraph 2 is the unresolved event or call to adventure.`;
}

export function buildBackstoryRewritePrompt(
  worldLore: string,
  concept: { name: string; species: string; background: string; characterClass: string; backstory: string },
  suggestions: string[],
): string {
  return `You are a tabletop RPG editor. Rewrite a player's character backstory so it better fits the tone and feel of the world below, applying the suggestions given.

GM-ONLY WORLD LORE:
${worldLore || '(no world lore has been established yet — keep the tone genre-appropriate)'}

CHARACTER CONCEPT:
Name: ${concept.name || '(unnamed)'}
Species: ${concept.species || '(unspecified)'}
Background: ${concept.background || '(unspecified)'}
Class: ${concept.characterClass || '(unspecified)'}

PLAYER'S BACKSTORY:
${concept.backstory}

SUGGESTIONS TO APPLY:
${suggestions.map(s => `- ${s}`).join('\n')}

This is the player's story. Keep EVERY piece of player information and every plot point — all named people, places, events, relationships, and motivations they wrote. Do not drop, replace, or contradict any of them. Condense wording and adjust tone and framing only; where a suggestion would require removing player content, reframe that content instead. Names the player wrote themselves stay, even if they also appear in the lore — just don't add any new ones from it.

${BACKSTORY_CONTENT_RULES}

Write between 2 and 4 paragraphs of prose.`;
}

export function buildBackstoryExtractPrompt(
  worldLore: string,
  character: { name: string; species: string; background: string; class: string; backstory?: string },
): string {
  return `You are a tabletop RPG world-builder. A new player character has just joined the campaign. Read their backstory and extract concrete world content from it, so the character feels like they already belong in this world rather than being bolted on.

WORLD LORE (current):
${worldLore || '(no world lore established yet)'}

NEW PARTY MEMBER:
Name: ${character.name}
Species: ${character.species}
Background: ${character.background}
Class: ${character.class}
Backstory: ${character.backstory || '(none provided)'}

Only extract what the backstory actually introduces — do not invent unrelated content. If it names a person (family, companion, rival, mentor, even an animal), that's an NPC. If it names a place the character is from, passed through, or is headed toward, that's a location. If it implies something the party will need to act on (a missing person, a promise, a search, a debt, an unresolved thread), that's a quest, written from the party's perspective as a hook to pursue. If the backstory is empty or too thin to extract anything, return empty arrays — do not fabricate content to fill them.

Return ONLY a single valid JSON object — no markdown fences, no explanation:

{
  "worldEntry": "string — 2-4 sentences, in-world journal/historical voice, recording this character's arrival and tying it to the lore above where it fits. Appended to the world document verbatim.",
  "npcs": [
    { "name": "string", "role": "string — their relation to the character, e.g. 'niece', 'hunting hound', 'estranged mentor'", "race": "string", "occupation": "string", "personality": "string — 2-3 specific traits", "motivation": "string", "secret": "string, or empty if none", "factionAffiliation": "string or null" }
  ],
  "locations": [
    { "name": "string", "description": "string — grounded, specific, consistent with the world lore's tone and geography" }
  ],
  "quests": [
    { "id": "kebab-slug", "name": "string — short, player-facing", "description": "string — 1-2 sentences, what the party knows or is being asked to do" }
  ]
}`;
}

// Classifies a new campaign into the fixed setting/tone sets that key the reusable tile art (see
// dungeon/genreTiles.ts). Only ever used for tile lookup — never shapes story or narration.
export function buildGenreClassificationPrompt(tags: string[]): string {
  const settings = GENRE_SETTINGS.map(s => `- ${s}: ${GENRE_SETTING_DESCRIPTIONS[s]}`).join('\n');
  const tones = GENRE_TONES.map(t => `- ${t}: ${GENRE_TONE_DESCRIPTIONS[t]}`).join('\n');
  return `Classify a tabletop RPG world by what its locations physically look like, so matching floor art can be reused. Campaign tags: ${tags.join(', ')}

SETTING (the era and technology the floors and walls come from):
${settings}

TONE (how those surfaces are treated):
${tones}

Rules:
- Judge by what the world described by the tags is actually like, never by matching words — a tag like "Brothers Grim" does not make a world grim.
- grim vs horror: if the main threat is people or circumstance, grim. If it is something unnatural or monstrous, horror.
- War or conflict alone is not grim — grim needs actual grit, bleakness, or hardship. A heroic war with knights and dragons is standard.
- Named IPs, films, games, and historical eras count: place them where their real look belongs.
- You must choose from the lists above. If nothing fits well, pick the closest and say so in fit/fitNote.

Return ONLY a single valid JSON object — no markdown fences, no explanation:
{
  "setting": "one of: ${GENRE_SETTINGS.join('|')}",
  "tone": "one of: ${GENRE_TONES.join('|')}",
  "fit": "good or poor — poor if the closest options are a stretch",
  "fitNote": "string — only when fit is poor: one line on what the world's look needs that no option covers"
}`;
}

export function buildConceptsPrompt(tags: string[], type: CampaignType): string {
  if (type === 'one-shot') {
    return `You are a tabletop RPG designer. Generate exactly 3 distinct one-shot adventure concepts inspired by these tags: ${tags.join(', ')}.

Each concept must be self-contained — playable and resolvable in a single 3–4 hour session. Name the setting and its central conflict or tension — what's wrong, who's driving it. Avoid vague atmosphere — be concrete about the conflict. Do NOT reveal the inciting event, plot twists, or how the session resolves — that's for players to discover at the table, not a spoiler on a concept card.

${LORE_INSTRUCTION}

Return ONLY a JSON array — no markdown, no explanation:
[
  { "name": "string — punchy title that signals the tone", "description": "string — 2 sentences: the setting and its central conflict — enough to hook a player, not what happens or how it resolves" },
  { "name": "...", "description": "..." },
  { "name": "...", "description": "..." }
]`;
  }

  return `You are a world-building expert for tabletop RPGs. Generate exactly 3 distinct sandbox world concepts inspired by these tags: ${tags.join(', ')}.

Each concept is pure world-building: the setting itself — its tone, genre, geography, culture, and atmosphere. What kind of place this is, what it looks and feels like to stand in it.

${LORE_INSTRUCTION}

Return ONLY a JSON array — no markdown, no explanation:
[
  { "name": "string — title that signals the world's tone and genre", "description": "string — 2 sentences of pure world-building: the setting, its atmosphere, and defining flavour" },
  { "name": "...", "description": "..." },
  { "name": "...", "description": "..." }
]`;
}

export function buildWorldGenPrompt(tags: string[], conceptName: string, conceptDescription: string, type: CampaignType): string {
  if (type === 'one-shot') {
    return `You are a tabletop RPG designer. Build a tight, self-contained one-shot adventure setting based on this concept.

Concept: "${conceptName}" — ${conceptDescription}
Tags: ${tags.join(', ')}

${LORE_INSTRUCTION}

Return ONLY a single valid JSON object — no markdown fences, no explanation:

{
  "world": {
    "name": "string",
    "overview": "string — 1 paragraph: what this world is, what is actively breaking down, and why today specifically is the moment everything changes. Use proper nouns.",
    "history": "string — 2–3 specific named events (with actors and consequences) that explain how the crisis came to be",
    "currentState": "string — the inciting incident: name exactly what just happened, where, and to whom. This is the trigger that pulls players in.",
    "hooks": ["string — a concrete situation players could stumble into in the first hour", "string — another hook", "string — a third hook"],
    "countdown": "string — one bad outcome that will occur within a day or two of in-game time unless players intervene; name who is driving it and what the consequence is"
  },
  "geography": {
    "regions": [
      { "name": "string", "description": "string", "keyLocations": [{ "name": "string", "description": "string" }] }
    ],
    "startingLocation": { "name": "string — a specific named place, not 'abandoned warehouse'", "description": "string — reference notes on the place, not a narrated scene. Two short parts, each on its own line: 'Arrival:' the specific room or spot the party first stands in and only what is directly perceivable from there; 'Elsewhere here:' other rooms, floors, and what is going on behind closed doors — kept separate so the DM reveals them only when the party goes there. Grounded in the world's specifics. Session 1 opens at the Arrival spot." }
  },
  "factions": [
    { "name": "string", "description": "string", "goals": "string", "methods": "string" }
  ],
  "npcs": [
    {
      "name": "string", "role": "string", "race": "string", "occupation": "string",
      "personality": "string — 2–3 specific traits that would visibly show up at the table",
      "motivation": "string — what they want and the personal reason behind it",
      "secret": "string — a piece of hidden information that, if revealed to players, would directly alter another NPC's behaviour or a faction's plans",
      "factionAffiliation": "string or null",
      "crossFactionTie": "string or null — a named relationship or tension with someone outside their own faction"
    }
  ],
  "scenario": {
    "objective": "string — the clear, concrete goal players must achieve to end the session successfully",
    "climax": "string — the specific confrontation or revelation that ends the adventure",
    "resolution": "string — what a successful outcome looks like and what one thing is deliberately left open"
  },
  "acts": [
    { "act": 1, "conditions": ["string — concrete, observable story event that must occur to advance (e.g. 'The villain's identity revealed to the players')"] },
    { "act": 2, "conditions": ["string — final act completion condition"] }
  ],
  "initialQuests": [
    { "id": "kebab-slug", "name": "Quest Name", "description": "string — 1-2 sentences, player-facing, what the party knows or is being asked to do" }
  ],
  "startingTime": "HH:MM — the in-world time when play begins (e.g. '09:00' for morning, '20:30' for evening)"
}

Requirements: 4–6 factions, 8–12 NPCs. Keep scope tight — one location cluster, one central conflict, one session. Every element should directly serve the scenario objective. Do NOT pad with backstory that has no bearing on the session. initialQuests: 4–8 hooks the DM will surface during play.

This document is for the DM's eyes only — climax, resolution, and secrets are meant to be discovered at the table, not disclosed to players ahead of play.`;
  }

  return `You are a master world-builder for tabletop RPGs. Build a rich, specific sandbox world based on this concept.

Concept: "${conceptName}" — ${conceptDescription}
Tags: ${tags.join(', ')}

The concept above is flavour only — it names no conflict. Invent the specific central conflict, tension, and stakes now, from scratch, consistent with that flavour.

${LORE_INSTRUCTION}

Return ONLY a single valid JSON object — no markdown fences, no explanation:

{
  "world": {
    "name": "string",
    "overview": "string — 2–3 paragraphs: what this world is (with specific proper nouns), what is actively breaking down or in conflict right now, and what makes this an interesting moment for outsiders to arrive. Avoid generic mood-setting — give concrete detail.",
    "history": "string — 3–5 specific named events (with actors, locations, and consequences) that explain how the world arrived at its current state. Use proper nouns throughout.",
    "currentState": "string — the immediate pressure: one concrete thing actively happening that players will encounter or must respond to in their first session. Name the actors and the stakes.",
    "hooks": ["string — a specific situation players could stumble into without being pushed", "string — another hook with a named person or place", "string — a third hook that cuts across faction lines"],
    "countdown": "string — one bad outcome that will occur within a week of in-game time unless someone intervenes; name who is driving it, how far along they are, and what happens if it succeeds"
  },
  "geography": {
    "regions": [
      { "name": "string", "description": "string", "keyLocations": [{ "name": "string", "description": "string" }, { "name": "string", "description": "string" }, { "name": "string", "description": "string" }] },
      { "name": "string", "description": "string", "keyLocations": [{ "name": "string", "description": "string" }, { "name": "string", "description": "string" }, { "name": "string", "description": "string" }] },
      { "name": "string", "description": "string", "keyLocations": [{ "name": "string", "description": "string" }, { "name": "string", "description": "string" }, { "name": "string", "description": "string" }] },
      { "name": "string", "description": "string", "keyLocations": [{ "name": "string", "description": "string" }, { "name": "string", "description": "string" }, { "name": "string", "description": "string" }] }
    ],
    "startingLocation": { "name": "string — a specific named place that fits the world", "description": "string — reference notes on the place, not a narrated scene. Two short parts, each on its own line: 'Arrival:' the specific room or spot the party first stands in and only what is directly perceivable from there; 'Elsewhere here:' other rooms, floors, and what is going on behind closed doors — kept separate so the DM reveals them only when the party goes there. Grounded in the world's specifics. Enough to open play immediately." }
  },
  "factions": [
    { "name": "string", "description": "string", "goals": "string — what they are actively doing right now, not just what they want long-term", "methods": "string" }
  ],
  "npcs": [
    {
      "name": "string", "role": "string", "race": "string", "occupation": "string",
      "personality": "string — 2–3 specific traits that would visibly show up when players interact with them",
      "motivation": "string — what they want and the specific personal reason behind it",
      "secret": "string — a piece of hidden information that, if revealed to players, would directly change another NPC's behaviour or a faction's plans. Not backstory — actionable hidden information.",
      "factionAffiliation": "string or null",
      "crossFactionTie": "string or null — a named relationship, debt, or tension with a specific person outside their own faction"
    }
  ],
  "acts": [
    { "act": 1, "conditions": ["string — a concrete, observable scene-level event signalling the opening arc is complete"] },
    { "act": 2, "conditions": ["string — the escalation arc's turning point has occurred"] },
    { "act": 3, "conditions": ["string — the climax arc is resolved"] }
  ],
  "initialQuests": [
    { "id": "kebab-slug", "name": "Quest Name", "description": "string — 1-2 sentences, player-facing, what the party knows or is being asked to do" }
  ],
  "startingTime": "HH:MM — the in-world time when play begins (e.g. '09:00' for morning, '20:30' for evening)"
}

Requirements: at least 6 factions, at least 12 NPCs. Include at least 2 NPCs with no faction affiliation or whose loyalty is genuinely divided. Factions should have conflicting goals that create natural drama without the GM needing to force it. initialQuests: 6–10 opening hooks written as pending story beats the DM will surface in early sessions.

Do NOT generate a plot or overarching story — the players will create that. Generate world state, not narrative. Every NPC and faction should be pursuable independently.`;
}

// Dungeon crawl: no world, no factions, no NPC roster — the dungeon itself is the content.
// Just a title (not the raw tag list) and enough premise for the DM to open the scene.
// The title is the user's own, fixed at the client's rename step before any of this runs — so it's
// stated here rather than invented. Asking the model to name the adventure too was pure waste: the
// route overwrote whatever it returned with the user's name immediately (see routes/campaigns.ts),
// and the premise was composed to fit a title that then got swapped out from under it.
export function buildDungeonCrawlPremisePrompt(tags: string[], title: string): string {
  return `You are a tabletop RPG designer. Based on these tags: ${tags.join(', ')} — write the premise for why a party of adventurers is about to enter this dungeon crawl.

The adventure is already titled "${title}" — do not rename it or suggest another title. Write the premise so it fits that title.

${LORE_INSTRUCTION}

Return ONLY a single valid JSON object — no markdown fences, no explanation:
{
  "premise": "string — a single paragraph (3-5 sentences) covering who sent them or why they're going, what they're after or expect to find, and the tone/atmosphere the tags imply. Do not describe the dungeon's layout or contents — that's generated separately. Do not invent named NPCs, factions, or a wider world — this is scene-setting for the trip in, nothing more."
}`;
}

// Runs AFTER buildDungeonCrawlPremisePrompt (that title/premise stay as the short campaign-record
// blurb, untouched) and BEFORE the dungeon itself is generated. This is a separate, longer, more
// dramatic piece with a different job: read in full by the player in the game lobby before they
// ever click in, AND handed to the dungeon manifest as story context so the rooms/threats/loot the
// generator invents actually serve this specific scenario instead of just the bare genre tags.
export function buildDungeonScenarioSynopsisPrompt(tags: string[], title: string, shortPremise: string): string {
  return `You are a tabletop RPG scenario writer opening a dungeon-crawl session. Write the scenario synopsis a player reads before the game begins — the "why are we here, what's actually going on" text.

Adventure title: "${title}"
Short premise (already established, do not contradict it — expand on it): ${shortPremise}
Tags: ${tags.join(', ')}

${LORE_INSTRUCTION}

Write it like the back-of-the-book blurb for this scenario, not a story recap — a short, punchy scene-setter that tells the reader where they are and why, then gets out of the way. Second person plural, present tense — "you" and "your". Ground it in the concrete state of the world and the concrete reason the party is here, but keep it general: describe the situation, not a specific remembered event, conversation, or named bystander who supposedly caused it (no invented trucker, informant, dying stranger, or similar one-off character — that reads as recapping something that "already happened," which is exactly what this isn't). Vivid is good, purple is fine in small doses, but every sentence needs a concrete fact underneath it, not just mood. End on the tension that pulls play forward, not a resolved feeling.

Do not name, class, or background any player character, companion, or specific NPC — the party doesn't exist yet and decides who they are at character creation, not here. Do not describe the dungeon's rooms or layout — that's generated separately, from this text. Do not invent a wider world, factions, or lore beyond this one scenario.

Keep it short and easy to read: 3-4 short paragraphs, plain grammar, no run-ons. Trim anything that isn't setting or stakes.

Return ONLY a single valid JSON object — no markdown fences, no explanation:
{
  "synopsis": "string — 3-4 short paragraphs, second person plural, present tense. Read in full by players before the game starts and also used to guide the dungeon's design, so it must be concrete about the situation, not just atmosphere — but it should read like jacket-copy flavor text, not a recap of events that already happened to this specific party."
}`;
}

// Fully replaces the manifest's own free-form goal invention (same "predefinedChain... over the
// ones it was explicitly told were already decided" precedent manifest.ts already applies for
// mid-campaign dungeon entry — see fetchManifest's predefinedChain handling) — deliberately ONE
// opening stage; the manifest call itself decides its trigger and authors the entire rest of the
// chain, so a fresh dungeon-crawl campaign opens on a single strong thread pulled straight from
// the scenario instead of several disconnected hooks.
export function buildDungeonScenarioGoalPrompt(synopsis: string, dungeonType: string, existingIds: string[]): string {
  const existingIdList = existingIds.join(', ') || 'none';
  return `You are generating the single goal that gives this tabletop RPG dungeon crawl (genre: ${dungeonType}) a reason to exist beyond "explore it."

Scenario synopsis (the party's situation right now — the goal must follow directly from this, not invent a new thread):
${synopsis}

Generate exactly ONE concrete, player-facing goal — what the party is here to find, stop, rescue, or retrieve. It must be the single strongest, most direct throughline the synopsis already implies, not a generic "explore the dungeon", "defeat the boss", or "find the exit" (those are tracked separately by the game itself).
Use a kebab-case ID not in this list: ${existingIdList}

Return ONLY a single valid JSON object — no markdown fences, no explanation:
{ "id": "kebab-slug", "name": "Short, evocative quest title (2-6 words) — not a restatement of the description, a proper name for it, e.g. 'The Missing Cartographer', 'Silence the Ritual'.", "description": "2-3 short bullet points, one per line, each starting with '- ' — concrete, distinct beats of ONLY this opening objective. This is stage one of a longer chain the dungeon itself will author around it once this one resolves — never describe the final confrontation, the escape, or how the whole thing ultimately resolves; that's later stages' job, not this one's. Say only what the party needs to find or do first. This becomes the dungeon's design brief, so name what's being sought/stopped/rescued." }`;
}

// ── Plot hook pool (admin-authored, normalized here into a reusable skeleton) ─────────────────────
// This runs once, at authoring time, when the admin submits or edits raw arc text in the Plot Hooks
// resource tab. It is NOT the reflavor step — reflavor (turning the skeleton back into a concrete,
// campaign-specific quest, with a freshly invented vehicle) happens later, per-campaign, in
// session-processor's plot hook candidate prompt. This prompt's only job is stripping a hand-written
// arc down to its reusable skeleton, so that later step always starts from the same clean shape.
export function buildPlotHookNormalizePrompt(rawText: string): string {
  return `You are a tabletop RPG story analyst. An admin has written a plot arc they think is compelling and want reused across many future campaigns, in many different genres. Your job is to abstract it into a reusable SKELETON — never to summarize or rewrite it as prose.

RAW ARC (as written by the admin):
${rawText}

The skeleton must be stripped of every concrete noun — no character names, no faction names, no place names, no specific monster or threat type. Keep only each beat's narrative FUNCTION — what role it plays in the arc — so the exact same skeleton could later be reflavored into a completely different genre and be unrecognizable on the surface while telling structurally the same story.

Example of the level of abstraction required: a "rats infesting the basement, the mayor wants them exterminated" arc does NOT get stored as "clear out the rats" — it gets stored as a beat like "an authority figure asks the party to exterminate a low-status pest/threat living beneath a settlement", because that same beat could later become a ratfolk uprising, a fungal outbreak, or a horde of graveyard revenants depending on the campaign it's reflavored into. Do the same level of abstraction for every beat below.

Tags: choose ONLY from this fixed list — ${PLOT_HOOK_TAGS.join(', ')}. Include a tag only if it is central to the arc's actual dramatic engine, never for a theme the arc merely brushes past. When in doubt, leave it out — a false tag on this device means it gets selected for campaigns it doesn't actually fit. Never invent a tag outside this list, and never include a genre/setting tag (fantasy, horror, sci-fi, etc.) — genre is decided per-campaign at reflavor time, not stored here.

structuralRequirements: short plain-English phrases naming the entity roles this arc needs to exist (e.g. "an authority figure or faction the party can trust or oppose", "a settlement or community at risk") — roles, never named entities.

Return ONLY a single valid JSON object — no markdown fences, no explanation:
{
  "title": "string — short admin-facing label for this arc, 2-6 words, describing its shape not its flavor (e.g. 'Trusted Protector Turns Persecutor')",
  "tags": ["string — zero or more, only from the fixed list above"],
  "structuralRequirements": ["string — a needed entity role, as plain English"],
  "beats": [
    { "order": 1, "function": "string — this beat's narrative function only, no concrete nouns" }
  ]
}`;
}
