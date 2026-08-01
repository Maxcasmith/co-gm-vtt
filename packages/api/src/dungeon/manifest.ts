import type { StoryProviderAdapter } from '../providers/index.ts';
import { logError } from '../logger.ts';

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
  adapter: StoryProviderAdapter,
): Promise<DungeonManifest | null> {
  if (isGeneric(name)) return null;

  const prompt = `You are a dungeon architect. Given a location name and genre, produce 6-10 named rooms that authentically represent that location.
Return ONLY valid JSON, no markdown fences, no explanation:
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
Use location-authentic names (e.g. for RPD: "Evidence Room", "S.T.A.R.S. Office"). Match creature types to the genre.

Location: ${name}
Genre: ${dungeonType}`;

  try {
    const raw = await adapter.complete(prompt);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<DungeonManifest>;
    return parsed.rooms?.length ? { rooms: parsed.rooms } : null;
  } catch (err) {
    logError('dungeon/manifest:fetchManifest', err);
    return null;
  }
}
