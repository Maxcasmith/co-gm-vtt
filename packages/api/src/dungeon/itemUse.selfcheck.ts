// Integration check for resolveLockpickAttempt/resolveTrapDisarmAttempt — no test framework in
// this repo, so this is the one runnable check: `tsx src/dungeon/itemUse.selfcheck.ts` from
// packages/api. The roll itself is random, so success/failure is forced deterministically by
// setting the target's DC to an unbeatable extreme (-99 always passes, 100 never does) rather than
// controlling the dice — same trick dungeon.findPath.selfcheck.ts-style fixtures use for other
// randomized systems in this repo. Writes a real character.json under a throwaway campaign slug,
// registers a fixture dungeon (positions and all) in the live dungeon registry, removes it whether checks pass
// or throw.
import type { Dungeon } from 'shared';
import { deleteCampaign, writeCharacter } from '../storage.ts';
import { registerDungeon, unregisterDungeon, dungeonsIn } from '../state.ts';
import { setTrackLocations } from '../partyGroups.ts';
import { resolveLockpickAttempt, resolveTrapDisarmAttempt } from './runtime.ts';

const SLUG = '__selfcheck-itemuse__';
const CHAR_ID = 'fixture-rogue';

function freshDungeon(): Dungeon {
  return {
    id: 'fixture-dungeon',
    name: 'Fixture Crypt',
    width: 10,
    height: 10,
    cells: Array.from({ length: 10 }, () => new Array(10).fill(1)),
    rooms: [],
    entities: [
      { id: 'door-1', type: 'door', x: 0, y: 0, width: 1, height: 1, name: 'Door', discovered: true, doorState: 'locked', requiresKeyId: 'nonexistent', lockpickDC: -99 },
      { id: 'trap-1', type: 'trap', x: 0, y: 0, name: 'Trapped Chest', discovered: true, hideDC: 10, trap: { kind: 'damage', effects: [], disarmDC: -99 } },
    ],
  };
}

// The party is standing in the fixture dungeon — dungeonOf resolves every lookup through that.
function fixtureDungeon() {
  return dungeonsIn(SLUG)[0]!;
}

async function placeFixtureDungeon(): Promise<void> {
  for (const d of dungeonsIn(SLUG)) unregisterDungeon(SLUG, d.id);
  registerDungeon(SLUG, freshDungeon());
  await setTrackLocations(SLUG, null, fixtureDungeon().id);
}

async function main() {
  await writeCharacter(SLUG, CHAR_ID, {
    id: CHAR_ID, campaignId: SLUG, name: 'Fixture Rogue', species: 'Human', background: 'Criminal', class: 'Rogue',
    stats: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
    skillProficiencies: [], password: 'x', portraitPath: '', tokenPath: '', createdAt: new Date().toISOString(),
  } as Parameters<typeof writeCharacter>[2]);

  // ── resolveLockpickAttempt: guaranteed-pass DC, in range — unlocks the door ─────────────────────
  await placeFixtureDungeon();
  fixtureDungeon().positions = { 'Fixture Rogue': { gx: 0, gy: 1 } }; // 5ft
  await resolveLockpickAttempt(SLUG, CHAR_ID, 'Fixture Rogue');
  let door = fixtureDungeon().entities.find(e => e.id === 'door-1')!;
  if (door.doorState !== 'open') throw new Error(`expected a guaranteed-pass DC to open the door, got ${door.doorState}`);

  // ── resolveLockpickAttempt: guaranteed-fail DC — door stays locked ──────────────────────────────
  await placeFixtureDungeon();
  fixtureDungeon().entities.find(e => e.id === 'door-1')!.lockpickDC = 100;
  fixtureDungeon().positions = { 'Fixture Rogue': { gx: 0, gy: 1 } };
  await resolveLockpickAttempt(SLUG, CHAR_ID, 'Fixture Rogue');
  door = fixtureDungeon().entities.find(e => e.id === 'door-1')!;
  if (door.doorState !== 'locked') throw new Error(`expected a guaranteed-fail DC to leave the door locked, got ${door.doorState}`);

  // ── resolveLockpickAttempt: no locked door in range — no-op, no throw ───────────────────────────
  await placeFixtureDungeon();
  fixtureDungeon().positions = { 'Fixture Rogue': { gx: 9, gy: 9 } };
  await resolveLockpickAttempt(SLUG, CHAR_ID, 'Fixture Rogue');
  door = fixtureDungeon().entities.find(e => e.id === 'door-1')!;
  if (door.doorState !== 'locked') throw new Error(`expected no-op with nothing in range, got ${door.doorState}`);

  // ── resolveTrapDisarmAttempt: guaranteed-pass DC, discovered, in range — removes the trap ───────
  await placeFixtureDungeon();
  fixtureDungeon().positions = { 'Fixture Rogue': { gx: 0, gy: 1 } };
  await resolveTrapDisarmAttempt(SLUG, CHAR_ID, 'Fixture Rogue');
  if (fixtureDungeon().entities.some(e => e.id === 'trap-1')) throw new Error('expected a guaranteed-pass DC to remove the trap entirely');

  // ── resolveTrapDisarmAttempt: undiscovered trap — can't be targeted at all, no-op ───────────────
  await placeFixtureDungeon();
  fixtureDungeon().entities.find(e => e.id === 'trap-1')!.discovered = false;
  fixtureDungeon().positions = { 'Fixture Rogue': { gx: 0, gy: 1 } };
  await resolveTrapDisarmAttempt(SLUG, CHAR_ID, 'Fixture Rogue');
  if (!fixtureDungeon().entities.some(e => e.id === 'trap-1')) throw new Error('an undiscovered trap must never be a valid disarm target');
}

main()
  .then(() => console.log('itemUse selfcheck: OK — lockpick/trap-disarm resolve against the nearest in-range target, respect the DC, no-op when nothing valid is in range.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => {
    for (const d of dungeonsIn(SLUG)) unregisterDungeon(SLUG, d.id);
    await deleteCampaign(SLUG);
  });
