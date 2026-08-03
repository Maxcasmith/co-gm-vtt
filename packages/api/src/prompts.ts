type CampaignType = 'campaign' | 'one-shot' | 'dungeon-crawl';

// ── Shared lore instruction ───────────────────────────────────────────────────
// Appended to both prompts. Tells the model to honour named IPs when present
// without assuming every campaign is based on one.
const LORE_INSTRUCTION = `Where tags reference a named IP, setting, or genre (a game, film, book, historical era, etc.), draw from its established lore, proper nouns, named locations, and specific flavour — use the real names and details, not generic substitutes. For original or custom worlds, apply the same level of specificity using invented names and concrete details.`;

export function buildBackstoryCheckPrompt(
  worldLore: string,
  concept: { name: string; species: string; background: string; characterClass: string; backstory: string },
): string {
  return `You are a tabletop RPG lore consistency judge. Score how well a player's character concept fits the established world below.

WORLD LORE:
${worldLore || '(no world lore has been established yet — score based on internal consistency and genre fit only)'}

CHARACTER CONCEPT:
Name: ${concept.name || '(unnamed)'}
Species: ${concept.species || '(unspecified)'}
Background: ${concept.background || '(unspecified)'}
Class: ${concept.characterClass || '(unspecified)'}
Backstory: ${concept.backstory || '(none written yet)'}

Judge fit on: does the backstory reference or contradict specific facts, factions, regions, history, or tone established in the lore; does the species/background/class combination make sense given the world's cultures and current conflicts; is the backstory's scale and stakes appropriate for a starting character (not already the world's savior or a named lore figure).

Return ONLY a single valid JSON object — no markdown fences, no explanation:

{
  "score": number (0-100, integer, how well the concept fits the world),
  "verdict": "string — one sentence summary of the fit",
  "issues": ["string — a specific contradiction or mismatch with the lore, if any"],
  "suggestions": ["string — a specific, concrete change to the backstory that would raise the score, referencing actual lore names/places/factions where possible"]
}

If the concept already fits well, return an empty issues array and 1-2 suggestions for small flavour improvements rather than forcing problems that aren't there.`;
}

export function buildBackstoryGeneratePrompt(
  worldLore: string,
  concept: { name: string; species: string; background: string; characterClass: string },
): string {
  return `You are a tabletop RPG writer. Write a character backstory grounded in the world below.

WORLD LORE:
${worldLore || '(no world lore has been established yet — invent grounded, genre-appropriate details)'}

CHARACTER CONCEPT:
Name: ${concept.name || '(unnamed — invent a fitting name)'}
Species: ${concept.species || '(unspecified — pick one that fits the world)'}
Background: ${concept.background || '(unspecified — pick one that fits the world)'}
Class: ${concept.characterClass || '(unspecified — pick one that fits the world)'}

Reference specific named places, factions, NPCs, or events from the world lore above where it makes sense — ground the character in this world, not a generic fantasy setting. Explain how their species/background/class combination came to be, and give them a personal stake in something already happening in the world (a grudge, a debt, a missing person, a faction tie). Keep them a starting adventurer, not a legend — no world-saving deeds, no famous names.

Write exactly 3 paragraphs of prose. No headers, no bullet points, no markdown, no preamble — return only the backstory text itself.`;
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
    "startingLocation": { "name": "string — a specific named place, not 'abandoned warehouse'", "description": "string — richly detailed, grounded in the world's specifics. This is where session 1 opens." }
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
    "startingLocation": { "name": "string — a specific named place that fits the world", "description": "string — richly detailed and grounded in the world's specifics. Enough to open play immediately." }
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
export function buildDungeonCrawlPremisePrompt(tags: string[]): string {
  return `You are a tabletop RPG designer. Based on these tags: ${tags.join(', ')} — name this dungeon crawl and write the premise for why a party of adventurers is about to enter it.

${LORE_INSTRUCTION}

Return ONLY a single valid JSON object — no markdown fences, no explanation:
{
  "title": "string — a short, evocative title for this adventure. Not just the tags restated.",
  "premise": "string — a single paragraph (3-5 sentences) covering who sent them or why they're going, what they're after or expect to find, and the tone/atmosphere the tags imply. Do not describe the dungeon's layout or contents — that's generated separately. Do not invent named NPCs, factions, or a wider world — this is scene-setting for the trip in, nothing more."
}`;
}
