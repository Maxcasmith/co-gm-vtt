// Check for visited-dungeon lookup — no test framework in this repo, so this is the one runnable
// check: `npx tsx src/storage.visitedDungeons.selfcheck.ts` from packages/api. Writes a real
// throwaway campaign with several stored dungeons, exercises the actual lookup used to decide
// whether a DUNGEON_GEN:reopen re-enters an existing map or builds a new one, then deletes it.
//
// The failure this guards against is quiet: a miss regenerates a different dungeon behind the same
// name, which looks like "the AI rebuilt the crypt" rather than like a bug.
import type { Dungeon } from 'shared';
import { deleteCampaign, writeWorldMeta, saveDungeon, listVisitedDungeons, findVisitedDungeonByName } from './storage.ts';

const SLUG = '__selfcheck-visited-dungeons__';

const dungeon = (id: string, name: string, arena = false): Dungeon => ({
  id,
  name,
  width: 2,
  height: 2,
  cells: [[1, 1], [1, 1]],
  rooms: [],
  entities: [],
  ...(arena ? { arena: true } : {}),
});

async function main() {
  await writeWorldMeta(SLUG, { id: SLUG, name: 'Fixture Campaign', campaignDir: SLUG, type: 'campaign' });
  await saveDungeon(SLUG, dungeon('d-crypt', 'The Weeping Crypt'));
  await saveDungeon(SLUG, dungeon('d-mill', 'Vesper Mill'));
  await saveDungeon(SLUG, dungeon('d-arena', 'Battle', true));

  const visited = await listVisitedDungeons(SLUG);
  if (visited.length !== 2) throw new Error(`expected 2 visited dungeons, got ${visited.length}`);
  if (visited.some(d => d.arena)) throw new Error('a combat arena is transient and must never be offered as a place to return to');

  // Exact name.
  const exact = await findVisitedDungeonByName(SLUG, 'Vesper Mill');
  if (exact?.id !== 'd-mill') throw new Error(`exact name should resolve, got ${exact?.id}`);

  // The model will not reproduce casing or punctuation reliably — these are the same place.
  for (const variant of ['vesper mill', 'VESPER MILL', 'Vesper  Mill', 'vesper-mill']) {
    const found = await findVisitedDungeonByName(SLUG, variant);
    if (found?.id !== 'd-mill') throw new Error(`"${variant}" should resolve to the stored mill, got ${found?.id}`);
  }

  // A genuinely different place must NOT resolve — reopening the wrong map would drop the party
  // into somewhere they've never been, already looted.
  if (await findVisitedDungeonByName(SLUG, 'The Sunken Vault')) throw new Error('an unvisited location must not match a stored dungeon');
  if (await findVisitedDungeonByName(SLUG, '')) throw new Error('an empty name must never match');

  // An arena is excluded from lookup even by exact name.
  if (await findVisitedDungeonByName(SLUG, 'Battle')) throw new Error('an arena must not be reopenable');
}

main()
  .then(() => console.log('visited dungeons selfcheck: OK — arenas excluded, name variants resolve, unvisited names do not.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => {
    await deleteCampaign(SLUG);
  });
