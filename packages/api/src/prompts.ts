type CampaignType = 'campaign' | 'one-shot';

// ── Shared lore instruction ───────────────────────────────────────────────────
// Appended to both prompts. Tells the model to honour named IPs when present
// without assuming every campaign is based on one.
const LORE_INSTRUCTION = `Where tags reference a named IP, setting, or genre (a game, film, book, historical era, etc.), draw from its established lore, proper nouns, named locations, and specific flavour — use the real names and details, not generic substitutes. For original or custom worlds, apply the same level of specificity using invented names and concrete details.`;

export function buildConceptsPrompt(tags: string[], type: CampaignType): string {
  if (type === 'one-shot') {
    return `You are a tabletop RPG designer. Generate exactly 3 distinct one-shot adventure concepts inspired by these tags: ${tags.join(', ')}.

Each concept must be self-contained — playable and resolvable in a single 3–4 hour session. Name a specific inciting event (who did what, where, when) and the central dramatic question players must answer. Avoid vague atmosphere — be concrete.

${LORE_INSTRUCTION}

Return ONLY a JSON array — no markdown, no explanation:
[
  { "name": "string — punchy title that signals the tone", "description": "string — 2 sentences: the specific inciting event and the central question players must resolve" },
  { "name": "...", "description": "..." },
  { "name": "...", "description": "..." }
]`;
  }

  return `You are a world-building expert for tabletop RPGs. Generate exactly 3 distinct sandbox world concepts inspired by these tags: ${tags.join(', ')}.

Each concept must name a specific central conflict or irony — the thing that makes this world interesting to drop players into right now. Avoid vague atmosphere. Be concrete about the tension.

${LORE_INSTRUCTION}

Return ONLY a JSON array — no markdown, no explanation:
[
  { "name": "string — title that signals the world's tone and genre", "description": "string — 2 sentences: what defines this world and what central conflict or irony makes it compelling to play in" },
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
  }
}

Requirements: 2–3 factions, 4–6 NPCs. Keep scope tight — one location cluster, one central conflict, one session. Every element should directly serve the scenario objective. Do NOT pad with backstory that has no bearing on the session.`;
  }

  return `You are a master world-builder for tabletop RPGs. Build a rich, specific sandbox world based on this concept.

Concept: "${conceptName}" — ${conceptDescription}
Tags: ${tags.join(', ')}

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
      { "name": "string", "description": "string", "keyLocations": [{ "name": "string", "description": "string" }] }
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
  ]
}

Requirements: at least 3 factions, at least 6 NPCs. Include at least 2 NPCs with no faction affiliation or whose loyalty is genuinely divided. Factions should have conflicting goals that create natural drama without the GM needing to force it.

Do NOT generate a plot or overarching story — the players will create that. Generate world state, not narrative. Every NPC and faction should be pursuable independently.`;
}
