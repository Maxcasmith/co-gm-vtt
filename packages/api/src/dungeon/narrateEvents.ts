// Deterministic dungeon narration — the zero-LLM trunk. Room entry and search outcomes are
// assembled straight from what's already stored on the dungeon (room.description, room.dressing,
// discovered entities, hiddenDressing text), never rephrased and never embellished:
// room.description in particular is documented as static pre-authored text (see manifest.ts), so
// this concatenates rather than narrates. The closed-world LLM pathway
// (buildDungeonNarrationPrompt) only fires for turns these two functions can't fully cover.
import type { DungeonEntity, DungeonRoom } from 'shared';

/** A hiddenDressing entry — same discovery gate as DungeonEntity, but text-only. */
export type HiddenDressing = NonNullable<DungeonRoom['hiddenDressing']>[number];

// What a Perception/Investigation roll turned up: an entity, a hidden dressing detail, or nothing.
export type SearchFind = DungeonEntity | HiddenDressing | null;

function isEntity(found: DungeonEntity | HiddenDressing): found is DungeonEntity {
  return 'type' in found;
}

// Factual block for the party's first steps into a room: the pre-authored description and its
// ambient dressing. Deliberately no roll-call of what's in the room — a "crate, crate, shelving and
// crate are here." list read as a debug dump players skipped past; the map shows the furniture, and
// creatures announce themselves when they join a fight. Returns null when the room has neither, so
// the caller stays silent rather than posting an empty message.
export function templateRoomEntry(room: DungeonRoom): string | null {
  const lines = [...(room.description ? [room.description] : []), ...(room.dressing ?? [])];
  return lines.length ? lines.join('\n') : null;
}

// ponytail: fixed phrasings, one per outcome — a miss rotates over three so repeated failed
// searches don't read as a stuck record. Never states WHY something is there; that's lore, and
// lore is the LLM pathway's job (and only from seeded facts).
const MISSES = ['finds nothing.', 'turns up nothing here.', 'searches, and finds only silence.'];

// Belt-and-suspenders: the manifest prompt instructs traps' flavor "name" to never contain a DC
// or skill (see dungeon/manifest.ts), but that's a model instruction, not a guarantee — strip a
// leaked "(DC 14 Athletics ...)"-shaped aside before it ever reaches a player.
function stripMechanics(text: string): string {
  return text.replace(/\(?\bDC\s*\d+[^.()]*\)?/gi, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim();
}

export function templateSearchResult(characterName: string, found: SearchFind): string {
  if (!found) return `${characterName} ${MISSES[Math.floor(Math.random() * MISSES.length)]}`;
  if (!isEntity(found)) return `${characterName} notices ${found.text}`;

  switch (found.type) {
    case 'creature': return `${characterName} spots ${found.name} — it has not been noticed before now.`;
    case 'loot': return `${characterName} finds ${found.name}.`;
    // Explicitly "before it triggers" — this is a Perception/Investigation spot, not a trigger.
    // Read on its own ("spots a trap: the door slams shut") it sounded like the trap had already
    // gone off, which then read as a second, unexplained trigger once the real one fired later.
    case 'trap': return `${characterName} spots a trap before it triggers: ${stripMechanics(found.name)}.`;
    case 'object': return `${characterName} makes out ${found.name}.`;
    // Doors are never hidden (discovered: true, no hideDC — see toggleDoor's doc), so this never
    // actually fires; here only to keep the switch exhaustive.
    case 'door': return `${characterName} makes out a door.`;
    // Stairs are also always discovered: true, no hideDC — see useStairs' doc. Never fires either.
    case 'stairs': return `${characterName} makes out a stairwell.`;
  }
}
