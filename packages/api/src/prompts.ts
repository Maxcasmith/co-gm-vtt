type CampaignType = 'campaign' | 'one-shot';

export function buildConceptsPrompt(tags: string[], type: CampaignType): string {
  if (type === 'one-shot') {
    return `You are a tabletop RPG designer. Generate exactly 3 distinct one-shot adventure concepts inspired by these tags: ${tags.join(', ')}.

Each concept must be self-contained — playable and resolvable in a single 3–4 hour session. The description should hint at a clear inciting incident and a possible dramatic resolution.

Return ONLY a JSON array — no markdown, no explanation:
[
  { "name": "string — punchy, evocative title", "description": "string — 2 sentences: the inciting situation and the central dramatic question the players must resolve" },
  { "name": "...", "description": "..." },
  { "name": "...", "description": "..." }
]`;
  }

  return `You are a world-building expert for tabletop RPGs. Generate exactly 3 distinct sandbox world concepts inspired by these tags: ${tags.join(', ')}.

Return ONLY a JSON array — no markdown, no explanation:
[
  { "name": "string — evocative world name", "description": "string — 2 sentences, vague and atmospheric, hint at the world's central tension" },
  { "name": "...", "description": "..." },
  { "name": "...", "description": "..." }
]`;
}

export function buildWorldGenPrompt(tags: string[], conceptName: string, conceptDescription: string, type: CampaignType): string {
  if (type === 'one-shot') {
    return `You are a tabletop RPG designer. Build a tight, self-contained one-shot adventure setting based on this concept.

Concept: "${conceptName}" — ${conceptDescription}
Tags: ${tags.join(', ')}

Return ONLY a single valid JSON object — no markdown fences, no explanation:

{
  "world": {
    "name": "string",
    "overview": "string — 1 paragraph establishing the world and why today is the day everything changes",
    "history": "string — 2–3 sentences of relevant backstory that explains the current crisis",
    "currentState": "string — the inciting incident that draws the players in right now"
  },
  "geography": {
    "regions": [
      { "name": "string", "description": "string", "keyLocations": [{ "name": "string", "description": "string" }] }
    ],
    "startingLocation": { "name": "string", "description": "string — richly detailed, this is where the session opens" }
  },
  "factions": [
    { "name": "string", "description": "string", "goals": "string", "methods": "string" }
  ],
  "npcs": [
    {
      "name": "string", "role": "string", "race": "string", "occupation": "string",
      "personality": "string", "motivation": "string", "secret": "string",
      "factionAffiliation": "string or null"
    }
  ],
  "scenario": {
    "objective": "string — the clear goal the players must achieve to end the session successfully",
    "climax": "string — the dramatic confrontation or revelation that ends the adventure",
    "resolution": "string — what a successful outcome looks like, and what is left open"
  }
}

Requirements: 2–3 factions, 4–6 NPCs. Keep scope tight — one location cluster, one central conflict, one session. Every element should directly serve the scenario objective.`;
  }

  return `You are a master world-builder for tabletop RPGs. Build a rich sandbox world based on this concept.

Concept: "${conceptName}" — ${conceptDescription}
Tags: ${tags.join(', ')}

Return ONLY a single valid JSON object — no markdown fences, no explanation:

{
  "world": {
    "name": "string",
    "overview": "string — 3 paragraphs",
    "history": "string — key events shaping the present",
    "currentState": "string — what is happening right now, tensions simmering"
  },
  "geography": {
    "regions": [
      { "name": "string", "description": "string", "keyLocations": [{ "name": "string", "description": "string" }] }
    ],
    "startingLocation": { "name": "string", "description": "string — detailed enough to open play" }
  },
  "factions": [
    { "name": "string", "description": "string", "goals": "string", "methods": "string" }
  ],
  "npcs": [
    {
      "name": "string", "role": "string", "race": "string", "occupation": "string",
      "personality": "string", "motivation": "string", "secret": "string",
      "factionAffiliation": "string or null"
    }
  ]
}

Requirements: at least 3 factions, at least 6 NPCs. World should feel lived-in with morally complex factions and conflicting goals. Do NOT generate a plot or story — the players will create that.`;
}
