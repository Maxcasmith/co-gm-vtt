// Check for the legacy genre / genre-tile-map read-time migrations (storage.ts). Pure, no storage.
// Run with `npx tsx src/storage.genreMigration.selfcheck.ts` from packages/api.
import { migrateLegacyGenre, migrateLegacyTileMap } from './storage.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const horror = migrateLegacyGenre('horror');
assert(horror?.setting === 'modern' && horror.tone === 'horror', 'legacy horror must become modern/horror');
assert(migrateLegacyGenre('sci-fi')?.setting === 'scifi', 'legacy sci-fi must become scifi');
assert(migrateLegacyGenre(undefined) === undefined, 'no genre stays undefined');
assert(migrateLegacyGenre('nonsense') === undefined, 'unknown legacy string drops to undefined');
const current = { setting: 'fantasy', tone: 'grim' };
assert(migrateLegacyGenre(current) === current, 'new-shape genre passes through untouched');

const legacy = migrateLegacyTileMap({
  fantasy: { stone: { marble: 'tilesets/egypt/marble' } },
  horror: {
    stone: { 'cracked-tile': 'tilesets/gothic/cracked-tile', 'wet-stone': 'tilesets/vic/wet-stone' },
    fabric: { 'worn-carpet': 'tilesets/apoc/worn-carpet' },
    concrete: { 'peeling-linoleum': 'tilesets/apoc/peeling-linoleum', 'cracked-asphalt': 'tilesets/apoc/cracked-asphalt' },
  },
});
assert(legacy.fantasy?.standard?.stone?.marble?.path === 'tilesets/egypt/marble', 'legacy fantasy must land in fantasy/standard');
const modernHorror = legacy.modern?.horror;
assert(modernHorror?.tile?.['cracked-tile']?.path === 'tilesets/gothic/cracked-tile', 'tile keys must be re-homed to the tile category');
assert(modernHorror.stone?.['wet-stone'], 'non-tile stone stays stone');
assert(modernHorror.carpet?.['worn-carpet'], 'carpet keys re-homed');
assert(modernHorror.linoleum?.['peeling-linoleum'], 'linoleum keys re-homed');
assert(modernHorror.asphalt?.['cracked-asphalt'], 'asphalt keys re-homed');

const fresh = { fantasy: { standard: { stone: { marble: { path: 'tilesets/egypt/marble', description: 'white veined marble' } } } } };
assert(migrateLegacyTileMap(fresh) === fresh, 'new-shape map passes through untouched');

console.log('genre migration selfcheck: OK');
