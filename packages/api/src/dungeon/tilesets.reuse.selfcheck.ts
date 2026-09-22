// Check for the genre-tile-map reuse split — no test framework in this repo, so this is the one
// runnable check: `npx tsx src/dungeon/tilesets.reuse.selfcheck.ts` from packages/api. Pure, no
// storage or network: splitReusableMaterials is exported precisely so this branch can be checked
// without paying for a real image generation.
import type { DungeonMaterialSpec, GenreCategoryMap } from 'shared';
import { splitReusableMaterials } from './tilesets.ts';

const genreMap: GenreCategoryMap = {
  stone: { 'cracked-stone': { path: 'tilesets/gothic-horror-d42fd63791/cracked-stone', description: 'cracked grey flagstone' } },
  wood: { 'rotted-wood': { path: 'tilesets/sunken-temple-3a03ccc96f/rotted-wood' } },
};

const material = (over: Partial<DungeonMaterialSpec> & Pick<DungeonMaterialSpec, 'key' | 'category'>): DungeonMaterialSpec =>
  ({ description: `${over.key} floor`, ...over });

function main() {
  // A material that really is in the map is never drawn again — it points at the tileset it
  // already lives in, and the slug (not the path) is what the client addresses art by.
  const reused = splitReusableMaterials([material({ key: 'cracked-stone', category: 'stone' })], genreMap);
  if (reused.fresh.length !== 0) throw new Error('a material already in the map must not be regenerated');
  if (reused.materialSources['cracked-stone'] !== 'gothic-horror-d42fd63791') throw new Error(`expected the source tileset slug, got ${reused.materialSources['cracked-stone']}`);

  // Reuse is the default, so an explicit opt-out is the ONLY way a model gets fresh art for a key
  // that already exists — for when it wants a different look under the same name.
  const optedOut = splitReusableMaterials([material({ key: 'cracked-stone', category: 'stone', reuse: false })], genreMap);
  if (optedOut.fresh.length !== 1) throw new Error('reuse: false must force generation even when the key exists in the map');
  if (Object.keys(optedOut.materialSources).length !== 0) throw new Error('an opted-out material must not get a source override');

  // Absent from the map — nothing to reuse, so it's drawn, never pointed at art that doesn't exist.
  const absent = splitReusableMaterials([material({ key: 'obsidian-glass', category: 'glass' })], genreMap);
  if (absent.fresh.length !== 1) throw new Error('a key not in the map must fall through to fresh generation');

  // Right key, wrong category: the map is keyed by category first, so this must not resolve.
  const wrongCategory = splitReusableMaterials([material({ key: 'cracked-stone', category: 'concrete' })], genreMap);
  if (wrongCategory.fresh.length !== 1) throw new Error('a key found only under a different category must not resolve');

  // Mixed map: only the un-reusable half reaches the image model, which is where the saving is.
  const mixed = splitReusableMaterials([
    material({ key: 'cracked-stone', category: 'stone' }),
    material({ key: 'rotted-wood', category: 'wood' }),
    material({ key: 'cobblestone', category: 'cobblestone' }),
  ], genreMap);
  if (mixed.fresh.map(m => m.key).join() !== 'cobblestone') throw new Error(`only the new material should be generated, got ${mixed.fresh.map(m => m.key).join()}`);
  if (Object.keys(mixed.materialSources).length !== 2) throw new Error('both reused materials should carry a source override');

  // A malformed map entry is treated as unusable rather than guessed at — one wasted generation is
  // recoverable, a room addressing a folder that doesn't exist renders as blank floor.
  const malformed = splitReusableMaterials(
    [material({ key: 'cracked-stone', category: 'stone' })],
    { stone: { 'cracked-stone': { path: 'gothic-horror-d42fd63791/cracked-stone' } } },
  );
  if (malformed.fresh.length !== 1) throw new Error('an entry that is not tilesets/<slug>/<key> must not be trusted');
}

main();
console.log('tilesets reuse selfcheck: OK — anything already in the bucket is reused by default; only reuse:false or a real miss generates.');
