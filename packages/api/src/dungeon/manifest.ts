import type { EnemyStatBlock, DungeonTheme } from 'shared';
import { DUNGEON_THEMES } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { logError } from '../logger.ts';

export interface ManifestHazard {
  name: string;
  hideDC: number;
}

export interface ManifestRoom {
  name: string;
  size: 'small' | 'medium' | 'large';
  role?: 'entrance' | 'exit';
  creatures?: EnemyStatBlock[];
  traps?: ManifestHazard[];
  loot?: ManifestHazard[];
  key?: string; // single-char id for the organic grid prompt — assigned here, never left to the LLM
  theme?: DungeonTheme; // for procedural floor/wall/prop rendering — clamped to DUNGEON_THEMES on parse
}

export interface DungeonManifest {
  rooms: ManifestRoom[];
}

// Single generic words get no LLM call — falls back to a hand-authored generic layout
const GENERIC_RE = /^(dungeon|cave|crypt|tomb|cavern|ruins|tunnel|maze|lair|cellar|basement)$/i;

function isGeneric(name: string): boolean {
  return GENERIC_RE.test(name.trim());
}

const GENERIC_ROOMS: ManifestRoom[] = [
  { name: 'Entrance', size: 'medium', role: 'entrance', theme: 'stone' },
  { name: 'Guard Room', size: 'small', theme: 'armory', creatures: [{ id: 'guard-1', name: 'Guard', cr: 0.25, hp: 11, ac: 12, speed: 30, stats: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, attacks: [{ name: 'Spear', bonus: 3, damage: '1d6+1' }] }] },
  { name: 'Storage Room', size: 'small', theme: 'stone', loot: [{ name: 'Supplies', hideDC: 8 }] },
  { name: 'Junction', size: 'small', theme: 'cave' },
  { name: 'Vault', size: 'medium', theme: 'stone', traps: [{ name: 'Trapped Chest', hideDC: 15 }], loot: [{ name: 'Treasure Chest', hideDC: 12 }] },
  { name: 'Inner Chamber', size: 'large', theme: 'throne', creatures: [{ id: 'boss-1', name: 'Boss', cr: 1, hp: 27, ac: 14, speed: 30, stats: { str: 15, dex: 13, con: 14, int: 10, wis: 11, cha: 12 }, attacks: [{ name: 'Greatsword', bonus: 5, damage: '2d6+3' }] }], role: 'exit' },
];

// A-Z, deterministic — up to 26 rooms, well past the largest room range we ask for (20).
function assignKeys(rooms: ManifestRoom[]): ManifestRoom[] {
  return rooms.map((room, i) => ({ ...room, key: String.fromCharCode(65 + (i % 26)) }));
}

export async function fetchManifest(
  name: string,
  dungeonType: string,
  adapter: StoryProviderAdapter,
  storyContext = '',
  roomRange: [number, number] = [6, 10],
  onToken: (t: string) => void = () => {},
): Promise<DungeonManifest> {
  if (isGeneric(name)) return { rooms: assignKeys(GENERIC_ROOMS) };

  const contextBlock = storyContext
    ? `\nRecent story context (what's actually happening — use this to decide what belongs in each room, not just the genre label):\n${storyContext}\n`
    : '';

  const [minRooms, maxRooms] = roomRange;
  const prompt = `You are a dungeon architect. Given a location name and genre, produce ${minRooms}-${maxRooms} named rooms that authentically represent that location.
Return ONLY valid JSON, no markdown fences, no explanation:
{
  "rooms": [
    {
      "name": "string — room name specific to this location",
      "size": "small|medium|large",
      "role": "entrance|exit — omit for a normal room. Mark exactly as many entrance/exit rooms as make sense for this location (usually one of each, sometimes more).",
      "theme": "one of: ${DUNGEON_THEMES.join('|')} — pick whichever best fits this room's actual purpose. Keep themes consistent with one coherent setting across the whole dungeon — don't mix incompatible eras or genres (e.g. a laboratory next to a throne room in a medieval crypt).",
      "creatures": [{
        "id": "string, unique per creature",
        "name": "string",
        "cr": 0.25,
        "hp": 11,
        "ac": 12,
        "speed": 30,
        "stats": { "str": 11, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 10 },
        "attacks": [{ "name": "string", "bonus": 3, "damage": "1d6+1" }]
      }],
      "traps": [{ "name": "string — trap description", "hideDC": 14 }],
      "loot": [{ "name": "string — item or treasure", "hideDC": 8 }]
    }
  ]
}
Omit "creatures"/"traps"/"loot" for rooms that don't have any — not every room needs them. Use location-authentic room names (e.g. for RPD: "Evidence Room", "S.T.A.R.S. Office"). Match creature types and stat blocks (use official 5e monster stat blocks as reference) to the genre. hideDC ranges 1-22 (higher = harder to spot); scale it to how well-concealed the trap/item narratively is. If the story context implies a non-hostile purpose (e.g. sneaking in to gather information), it's fine for rooms to have no creatures at all — don't force combat that doesn't fit.
${contextBlock}
Location: ${name}
Genre: ${dungeonType}`;

  try {
    const raw = await adapter.stream(prompt, onToken);
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<DungeonManifest>;
    const rooms: ManifestRoom[] = (parsed.rooms?.length ? parsed.rooms : GENERIC_ROOMS).map(r => {
      const { theme, ...rest } = r;
      return DUNGEON_THEMES.includes(theme as DungeonTheme) ? { ...rest, theme: theme as DungeonTheme } : rest;
    });
    return { rooms: assignKeys(rooms) };
  } catch (err) {
    logError('dungeon/manifest:fetchManifest', err);
    return { rooms: assignKeys(GENERIC_ROOMS) };
  }
}
