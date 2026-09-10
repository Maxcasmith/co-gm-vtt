// Integration check for resourceUsage.ts — no test framework in this repo, so this is the
// one runnable check: `tsx src/resourceUsage.selfcheck.ts` from packages/api. Writes a real
// throwaway campaign (world.json + dungeon.json) under a fixture slug, exercises the actual
// findCreatureUsage/findTilesetUsage/findPropUsage code paths, then deletes the fixture campaign.
import type { Dungeon } from 'shared';
import { deleteCampaign, writeWorldMeta, saveDungeon } from './storage.ts';
import { findCreatureUsage, findTilesetUsage, findPropUsage, collectResourceSlugs } from './resourceUsage.ts';

const SLUG = '__selfcheck-resourceusage__';

const dungeon: Dungeon = {
  id: 'fixture-dungeon',
  name: 'Fixture Smoke House',
  width: 4,
  height: 4,
  cells: Array.from({ length: 4 }, () => new Array(4).fill(1)),
  rooms: [],
  tilesetSlug: 'gothic-horror',
  entities: [
    { id: 'e1', type: 'creature', x: 0, y: 0, name: 'Giant Fire Beetle', discovered: true, statBlock: { name: 'Giant Fire Beetle' } as never },
    { id: 'e2', type: 'object', x: 1, y: 0, name: 'Rusty Cauldron', discovered: true, spriteSrc: '/api/props/rusty-cauldron/sprite_01.png' },
    { id: 'e3', type: 'object', x: 2, y: 0, name: 'Floating Trinket', discovered: true, followsId: 'char-1' }, // has no spriteSrc/never a prop — must never register as one
  ],
};

async function main() {
  await writeWorldMeta(SLUG, { id: SLUG, name: 'Fixture Campaign', campaignDir: SLUG, type: 'campaign' });
  await saveDungeon(SLUG, dungeon);

  const slugs = collectResourceSlugs(dungeon);
  if (slugs.tilesetSlug !== 'gothic-horror') throw new Error(`expected tilesetSlug passthrough, got ${slugs.tilesetSlug}`);
  if (!slugs.creatureSlugs.includes('giant-fire-beetle')) throw new Error('creature slug not collected');
  if (!slugs.propSlugs.includes('rusty-cauldron')) throw new Error('prop slug not collected');
  if (slugs.propSlugs.includes('floating-trinket')) throw new Error('a followed object (Floating Disk) must never register as a decorative prop');

  const creatureUsage = await findCreatureUsage('giant-fire-beetle');
  if (!creatureUsage.some(u => u.kind === 'campaign' && u.id === SLUG)) throw new Error('fixture campaign should show up as a creature user');

  const excluded = await findCreatureUsage('giant-fire-beetle', { excludeId: SLUG, excludeKind: 'campaign' });
  if (excluded.some(u => u.id === SLUG)) throw new Error('excludeId/excludeKind should filter the fixture campaign out');

  const tilesetUsage = await findTilesetUsage('gothic-horror', { excludeId: SLUG, excludeKind: 'campaign' });
  if (tilesetUsage.some(u => u.id === SLUG)) throw new Error('tileset usage should also respect exclude');

  const propUsage = await findPropUsage('rusty-cauldron');
  if (!propUsage.some(u => u.id === SLUG)) throw new Error('fixture campaign should show up as a prop user');

  const noUsage = await findCreatureUsage('nonexistent-creature-slug');
  if (noUsage.length !== 0) throw new Error('an unreferenced slug should have no usage');
}

main()
  .then(() => console.log('resourceUsage selfcheck: OK — slug collection, usage lookup, and exclude filtering all behave.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => {
    await deleteCampaign(SLUG);
  });
