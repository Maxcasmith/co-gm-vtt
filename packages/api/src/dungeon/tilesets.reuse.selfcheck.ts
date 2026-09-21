// Check for the genre-tile-map reuse split — no test framework in this repo, so this is the one
// runnable check: `npx tsx src/dungeon/tilesets.reuse.selfcheck.ts` from packages/api. Pure, no
// storage or network: splitReusableMaterials is exported precisely so this branch can be checked
// without paying for a real image generation.
import type { DungeonMaterialSpec, MaterialCategory } from 'shared';
import { splitReusableMaterials } from './tilesets.ts';

const genreMap: Partial<Record<MaterialCategory, Record<string, string>>> = {
  stone: { 'cracked-stone': 'tilesets/gothic-horror-d42fd63791/cracked-stone' },
  wood: { 'rotted-wood': 'tilesets/sunken-temple-3a03ccc96f/rotted-wood' },
};

const material = (over: Partial<DungeonMaterialSpec> & Pick<DungeonMaterialSpec, 'key' | 'category'>): DungeonMaterialSpec =>
  ({ description: `${over.key} floor`, ...over });

function main() {
  // A flagged material that really is in the map is never drawn again — it points at the tileset
  // it already lives in, and the slug (not the path) is what the client addresses art by.
  const reused = splitReusableMaterials([material({ key: 'cracked-stone', category: 'stone', reuse: true })], genreMap);
  if (reused.fresh.length !== 0) throw new Error('a material already in the map must not be regenerated');
  if (reused.materialSources['cracked-stone'] !== 'gothic-horror-d42fd63791') throw new Error(`expected the source tileset slug, got ${reused.materialSources['cracked-stone']}`);

  // Not flagged = the model wants it drawn fresh, even though the key happens to exist. The flag is
  // the decision; a coincidental key collision must never silently swap in someone else's art.
  const unflagged = splitReusableMaterials([material({ key: 'cracked-stone', category: 'stone' })], genreMap);
  if (unflagged.fresh.length !== 1) throw new Error('an unflagged material must be generated even when its key exists in the map');
  if (Object.keys(unflagged.materialSources).length !== 0) throw new Error('an unflagged material must not get a source override');

  // Flagged but absent — a hallucinated reuse degrades to a normal generation, never to a room
  // pointing at art that was never drawn.
  const hallucinated = splitReusableMaterials([material({ key: 'obsidian-glass', category: 'glass', reuse: true })], genreMap);
  if (hallucinated.fresh.length !== 1) throw new Error('a reuse flag for a key not in the map must fall through to fresh generation');

  // Right key, wrong category: the map is keyed by category first, so this must not resolve.
  const wrongCategory = splitReusableMaterials([material({ key: 'cracked-stone', category: 'concrete', reuse: true })], genreMap);
  if (wrongCategory.fresh.length !== 1) throw new Error('a key found only under a different category must not resolve');

  // Mixed map: only the un-reusable half reaches the image model, which is where the saving is.
  const mixed = splitReusableMaterials([
    material({ key: 'cracked-stone', category: 'stone', reuse: true }),
    material({ key: 'rotted-wood', category: 'wood', reuse: true }),
    material({ key: 'cobblestone', category: 'cobblestone' }),
  ], genreMap);
  if (mixed.fresh.map(m => m.key).join() !== 'cobblestone') throw new Error(`only the new material should be generated, got ${mixed.fresh.map(m => m.key).join()}`);
  if (Object.keys(mixed.materialSources).length !== 2) throw new Error('both reused materials should carry a source override');

  // A malformed map entry is treated as unusable rather than guessed at — one wasted generation is
  // recoverable, a room addressing a folder that doesn't exist renders as blank floor.
  const malformed = splitReusableMaterials(
    [material({ key: 'cracked-stone', category: 'stone', reuse: true })],
    { stone: { 'cracked-stone': 'gothic-horror-d42fd63791/cracked-stone' } },
  );
  if (malformed.fresh.length !== 1) throw new Error('an entry that is not tilesets/<slug>/<key> must not be trusted');
}

main();
console.log('tilesets reuse selfcheck: OK — reuse honoured only when flagged AND really present; everything else falls through to generation.');
