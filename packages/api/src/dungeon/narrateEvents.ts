// Deterministic dungeon narration — the zero-LLM trunk. Room entry and search outcomes are
// assembled straight from what's already stored on the dungeon (room.description, room.dressing,
// discovered entities, hiddenDressing text), never rephrased and never embellished:
// room.description in particular is documented as static pre-authored text (see manifest.ts), so
// this concatenates rather than narrates. The closed-world LLM pathway
// (buildDungeonNarrationPrompt) only fires for turns these two functions can't fully cover.
import type { Dungeon, DungeonEntity, DungeonRoom } from 'shared';

/** A hiddenDressing entry — same discovery gate as DungeonEntity, but text-only. */
export type HiddenDressing = NonNullable<DungeonRoom['hiddenDressing']>[number];

// What a Perception/Investigation roll turned up: an entity, a hidden dressing detail, or nothing.
export type SearchFind = DungeonEntity | HiddenDressing | null;

function isEntity(found: DungeonEntity | HiddenDressing): found is DungeonEntity {
  return 'type' in found;
}

// Factual block for the party's first steps into a room: the pre-authored description, its ambient
// dressing, then whatever's already been discovered here (creatures spotted from the doorway, loot
// in plain sight). Returns null when the room carries none of the three — nothing to say, so the
// caller should stay silent or fall through to the LLM rather than post an empty message.
export function templateRoomEntry(dungeon: Dungeon, room: DungeonRoom): string | null {
  const lines: string[] = [];
  if (room.description) lines.push(room.description);
  lines.push(...(room.dressing ?? []));

  const here = dungeon.entities.filter(e =>
    e.discovered &&
    e.x >= room.x && e.x < room.x + room.width &&
    e.y >= room.y && e.y < room.y + room.height,
  );
  if (here.length) lines.push(`Here: ${here.map(e => `${e.name} (${e.type})`).join(', ')}.`);

  return lines.length ? lines.join('\n') : null;
}

// ponytail: fixed phrasings, one per outcome — a miss rotates over three so repeated failed
// searches don't read as a stuck record. Never states WHY something is there; that's lore, and
// lore is the LLM pathway's job (and only from seeded facts).
const MISSES = ['finds nothing.', 'turns up nothing here.', 'searches, and finds only silence.'];

export function templateSearchResult(characterName: string, found: SearchFind): string {
  if (!found) return `${characterName} ${MISSES[Math.floor(Math.random() * MISSES.length)]}`;
  if (!isEntity(found)) return `${characterName} notices ${found.text}`;

  switch (found.type) {
    case 'creature': return `${characterName} spots ${found.name} — it has not been noticed before now.`;
    case 'loot': return `${characterName} finds ${found.name}.`;
    case 'trap': return `${characterName} spots a trap: ${found.name}.`;
    case 'object': return `${characterName} makes out ${found.name}.`;
  }
}
