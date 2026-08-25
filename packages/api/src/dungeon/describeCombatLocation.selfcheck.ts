// Standalone check for describeCombatLocation — no test framework in this repo, so this is the
// one runnable check: `tsx src/dungeon/describeCombatLocation.selfcheck.ts` from packages/api.
// Fixture mirrors the real bug: Ballroom and Atrium Lobby only connect through a 1-row gap
// (neither room's bounding box), so a creature killed right in that gap resolves via nearest-room
// fallback — this is exactly the case where the aftermath needs an explicit anchor, since the
// DM's own narration otherwise leans on whatever room dominated recent chat history.
import { describeCombatLocation } from './index.ts';
import type { Dungeon } from 'shared';

const dungeon: Dungeon = {
  id: 'fixture',
  name: 'Fixture Ship',
  width: 90,
  height: 90,
  cells: Array.from({ length: 90 }, () => new Array(90).fill(1)),
  rooms: [
    { id: 'atrium', name: 'Atrium Lobby', x: 59, y: 45, width: 11, height: 11 },
    { id: 'ballroom', name: 'Ballroom', x: 64, y: 57, width: 12, height: 12 },
  ],
  entities: [],
};

// No defeated creatures — nothing to anchor to, empty string (caller appends nothing).
if (describeCombatLocation(dungeon, []) !== '') throw new Error('no positions should produce no anchor line');

// Killed well inside the Ballroom's own bounding box — anchors to Ballroom directly.
const inBallroom = describeCombatLocation(dungeon, [{ gx: 70, gy: 63 }]);
if (!inBallroom.includes('Ballroom')) throw new Error(`expected Ballroom in: "${inBallroom}"`);
if (inBallroom.includes('Atrium')) throw new Error(`should not mention Atrium for a clean in-room kill: "${inBallroom}"`);

// Killed in the connecting gap row (y=56 — outside both rooms' bounding boxes) — this is the real
// bug's mechanism: nearest-centroid math puts it closer to Atrium Lobby than Ballroom.
const inGap = describeCombatLocation(dungeon, [{ gx: 65, gy: 56 }]);
if (!inGap.includes('Atrium Lobby')) throw new Error(`expected the gap position to resolve toward Atrium Lobby, got: "${inGap}"`);
if (!inGap.includes('anchor the aftermath')) throw new Error(`missing the explicit anchor instruction: "${inGap}"`);

// Multiple defeated creatures in the same room — dedupes to one room name, not a repeated list.
const multiSameRoom = describeCombatLocation(dungeon, [{ gx: 66, gy: 60 }, { gx: 72, gy: 65 }]);
if ((multiSameRoom.match(/Ballroom/g) ?? []).length !== 1) throw new Error(`expected one Ballroom mention, got: "${multiSameRoom}"`);

console.log('describeCombatLocation selfcheck: OK — anchors to the actual kill location (including the Ballroom/Atrium doorway gap), not the player\'s token.');
