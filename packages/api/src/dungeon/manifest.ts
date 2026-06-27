export interface ManifestRoom {
  name: string;
  size: 'small' | 'medium' | 'large';
  creatures?: string[];
  loot?: string[];
}

export interface DungeonManifest {
  rooms: ManifestRoom[];
}

// Single generic words get no LLM call — the generator handles them without narrative context
const GENERIC_RE = /^(dungeon|cave|crypt|tomb|cavern|ruins|tunnel|maze|lair|cellar|basement)$/i;

function isGeneric(name: string): boolean {
  return GENERIC_RE.test(name.trim());
}

export async function fetchManifest(
  name: string,
  dungeonType: string,
  apiKey: string,
  model: string,
): Promise<DungeonManifest | null> {
  if (isGeneric(name)) return null;

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
            content: `You are a dungeon architect. Given a location name and genre, produce 6-10 named rooms that authentically represent that location.
Return ONLY valid JSON:
{
  "rooms": [
    {
      "name": "string — room name specific to this location",
      "size": "small|medium|large",
      "creatures": ["creature type that would inhabit this room — omit if empty"],
      "loot": ["item or treasure found here — omit if empty"]
    }
  ]
}
Use location-authentic names (e.g. for RPD: "Evidence Room", "S.T.A.R.S. Office"). Match creature types to the genre.`,
          },
          { role: 'user', content: `Location: ${name}\nGenre: ${dungeonType}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const parsed = JSON.parse(data.choices[0]?.message.content ?? '{}') as Partial<DungeonManifest>;
    return parsed.rooms?.length ? { rooms: parsed.rooms } : null;
  } catch (err) {
    console.error('[dungeon:manifest] failed:', err);
    return null;
  }
}
