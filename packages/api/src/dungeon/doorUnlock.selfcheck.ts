// Integration check for the two runtime door-unlock paths — no test framework in this repo, so
// this is the one runnable check: `tsx src/dungeon/doorUnlock.selfcheck.ts` from packages/api.
// Populates the in-memory `dungeons`/`tokenPositions` maps directly (both functions read live
// dungeon state, not storage) and writes real dungeon.json under a throwaway campaign slug, then
// deletes it whether the checks pass or throw.
import type { Dungeon } from 'shared';
import { deleteCampaign } from '../storage.ts';
import { dungeons, tokenPositions } from '../state.ts';
import { toggleDoor, unlockDoorNear } from './runtime.ts';

const SLUG = '__selfcheck-doorunlock__';

function freshDungeon(): Dungeon {
  return {
    id: 'fixture-dungeon',
    name: 'Fixture Vault',
    width: 10,
    height: 10,
    cells: Array.from({ length: 10 }, () => new Array(10).fill(1)),
    rooms: [],
    entities: [
      { id: 'key-1', type: 'loot', x: 5, y: 5, name: 'Vault Key', discovered: false, hideDC: -99, contents: ['a small brass key'] },
      { id: 'door-1', type: 'door', x: 0, y: 0, width: 1, height: 1, name: 'Door', discovered: true, doorState: 'locked', requiresKeyId: 'key-1', lockpickDC: 15 },
    ],
  };
}

async function main() {
  // ── toggleDoor: locked, key not yet discovered — must stay locked ──────────────────────────────
  dungeons.set(SLUG, freshDungeon());
  tokenPositions.set(SLUG, { Hades: { gx: 0, gy: 1 } }); // 5ft away
  await toggleDoor(SLUG, 'door-1', 'Hades');
  let door = dungeons.get(SLUG)!.entities.find(e => e.id === 'door-1')!;
  if (door.doorState !== 'locked') throw new Error(`expected a click with the key undiscovered to stay locked, got ${door.doorState}`);

  // ── toggleDoor: locked, key discovered, in range — unlocks AND opens in one click ───────────────
  dungeons.get(SLUG)!.entities.find(e => e.id === 'key-1')!.discovered = true;
  await toggleDoor(SLUG, 'door-1', 'Hades');
  door = dungeons.get(SLUG)!.entities.find(e => e.id === 'door-1')!;
  if (door.doorState !== 'open') throw new Error(`expected a click with the key discovered and in range to open, got ${door.doorState}`);

  // ── toggleDoor: locked, key discovered, but out of range — stays locked ─────────────────────────
  dungeons.set(SLUG, freshDungeon());
  dungeons.get(SLUG)!.entities.find(e => e.id === 'key-1')!.discovered = true;
  tokenPositions.set(SLUG, { Hades: { gx: 5, gy: 5 } }); // way past 5ft
  await toggleDoor(SLUG, 'door-1', 'Hades');
  door = dungeons.get(SLUG)!.entities.find(e => e.id === 'door-1')!;
  if (door.doorState !== 'locked') throw new Error(`expected an out-of-range click to stay locked even with the key discovered, got ${door.doorState}`);

  // ── unlockDoorNear: narrated path — opens a locked door in range regardless of key discovery ────
  dungeons.set(SLUG, freshDungeon()); // key still undiscovered
  tokenPositions.set(SLUG, { Hades: { gx: 0, gy: 1 } });
  await unlockDoorNear(SLUG, 'Hades');
  door = dungeons.get(SLUG)!.entities.find(e => e.id === 'door-1')!;
  if (door.doorState !== 'open') throw new Error(`expected the narrated path to open a locked door in range even with an undiscovered key, got ${door.doorState}`);

  // ── unlockDoorNear: nothing locked in range — no-op ─────────────────────────────────────────────
  dungeons.set(SLUG, freshDungeon());
  tokenPositions.set(SLUG, { Hades: { gx: 9, gy: 9 } });
  await unlockDoorNear(SLUG, 'Hades');
  door = dungeons.get(SLUG)!.entities.find(e => e.id === 'door-1')!;
  if (door.doorState !== 'locked') throw new Error(`expected no-op when nothing locked is in range, got ${door.doorState}`);
}

main()
  .then(() => console.log('doorUnlock selfcheck: OK — click requires proximity + discovered key, narrated unlock only needs proximity, both no-op otherwise.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => {
    dungeons.delete(SLUG);
    tokenPositions.delete(SLUG);
    await deleteCampaign(SLUG);
  });
