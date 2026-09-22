// Check for the genre classifier's output validation — run with
// `npx tsx src/dungeon/genreTiles.selfcheck.ts` from packages/api. Pure, no LLM call.
import { parseGenreClassification } from './genreTiles.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const good = parseGenreClassification('{"setting":"modern","tone":"horror","fit":"good"}');
assert(good.genre.setting === 'modern' && good.genre.tone === 'horror', 'valid output passes through');
assert(good.fitNote === undefined, 'a good fit carries no note');

const poor = parseGenreClassification('```json\n{"setting":"scifi","tone":"grim","fit":"poor","fitNote":"needs organic hive floors"}\n```');
assert(poor.genre.setting === 'scifi' && poor.fitNote === 'needs organic hive floors', 'fenced output parses and a poor fit keeps its note');

const invented = parseGenreClassification('{"setting":"steampunk","tone":"cosy"}');
assert(invented.genre.setting === 'fantasy' && invented.genre.tone === 'standard', 'values outside the fixed sets must fall back, never create a new bucket');

const junk = parseGenreClassification('I think this is a horror world.');
assert(junk.genre.setting === 'fantasy' && junk.genre.tone === 'standard', 'unparseable output falls back to the default');

console.log('genre classification selfcheck: OK');
