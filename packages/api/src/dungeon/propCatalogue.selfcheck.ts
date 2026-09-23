// Check for the prop catalogue's reuse split and the dressing call's parse contract — no test
// framework in this repo, so this is the one runnable check: `npx tsx
// src/dungeon/propCatalogue.selfcheck.ts` from packages/api. Pure, no storage or network: both
// functions are exported precisely so the branch that silently costs money (drawing a sprite that
// already exists) can be checked without paying for a real image generation.
import type { PropCategoryMap, PropSpec } from 'shared';
import { buildPropNounBlock, splitReusableProps } from './propCatalogue.ts';
import { parsePropPlan } from './propDressing.ts';

const catalogue: PropCategoryMap = {
  seating: { 'diner-booth': { path: 'props/modern/horror/diner-booth', description: 'a cracked vinyl booth', widthFt: 5, depthFt: 6 } },
  surface: { 'long-table': { path: 'props/modern/horror/long-table' } },
  machinery: { boiler: { path: 'props/modern/horror/boiler', description: 'a rust-streaked boiler', widthFt: 4, depthFt: 4 } },
};

const prop = (over: Partial<PropSpec> & Pick<PropSpec, 'noun' | 'category'>): PropSpec =>
  ({ description: `${over.noun} description`, widthFt: 5, depthFt: 5, ...over });

function main() {
  // A noun already drawn for this bucket is never drawn again.
  const hit = splitReusableProps([prop({ noun: 'diner-booth', category: 'seating' })], catalogue);
  if (hit.fresh.length !== 0) throw new Error('a noun already in the catalogue must not be regenerated');
  if (hit.reused.length !== 1) throw new Error('a catalogue hit must be reported as reused so its metadata can be backfilled');

  // Same noun, different category = a different entry. Categories are the catalogue's index, so a
  // lookup that ignored them would hand back art of an unrelated object.
  const wrongCategory = splitReusableProps([prop({ noun: 'diner-booth', category: 'surface' })], catalogue);
  if (wrongCategory.fresh.length !== 1) throw new Error('a noun must only reuse art filed under its own category');

  // Absent from the catalogue — drawn, never pointed at a sprite that does not exist.
  const absent = splitReusableProps([prop({ noun: 'helm-console', category: 'machinery' })], catalogue);
  if (absent.fresh.length !== 1) throw new Error('an unknown noun must be generated');
  if (absent.reused.length !== 0) throw new Error('an unknown noun must not be reported as reused');

  // The prompt block only ever offers the categories the rooms actually asked for — this filter is
  // what keeps the payload bounded as the catalogue grows.
  const filtered = buildPropNounBlock(catalogue, ['machinery']);
  if (!filtered.includes('boiler')) throw new Error('the requested category must be listed');
  if (filtered.includes('diner-booth')) throw new Error('a category nobody asked for must not be sent');

  // No categories = no filter, which is right for a caller with no per-room categories at all.
  const unfiltered = buildPropNounBlock(catalogue, []);
  if (!unfiltered.includes('diner-booth') || !unfiltered.includes('boiler')) throw new Error('an empty filter must list the whole bucket');

  // Nothing drawn for this bucket yet leaves the calling prompt exactly as it reads without a
  // catalogue, rather than injecting an empty, confusing "already have art" heading.
  if (buildPropNounBlock({}, ['seating']) !== '') throw new Error('an empty bucket must produce no block');
  if (buildPropNounBlock(catalogue, ['bedding']) !== '') throw new Error('categories with no nouns must produce no block');

  // A noun already in the catalogue keeps its RECORDED dimensions — one sprite is drawn at one
  // aspect ratio, so letting a later dungeon re-declare it 2x9 would render that sprite distorted.
  const plan = parsePropPlan({
    props: [{ noun: 'diner-booth', category: 'seating', description: 'a booth', widthFt: 2, depthFt: 9 }],
    rooms: [{ name: 'Diner', props: [{ noun: 'diner-booth', count: 6, zone: 'wall' }] }],
  }, catalogue);
  if (plan.props[0]?.widthFt !== 5 || plan.props[0]?.depthFt !== 6) throw new Error('catalogue dimensions must win over a re-declared size');
  if (plan.byRoom.get('Diner')?.[0]?.count !== 6) throw new Error('a room request must keep its count');

  // A room asking for a noun that was never declared has no description and no dimensions, so it
  // can neither be drawn nor sized — dropped rather than guessed at.
  const undeclared = parsePropPlan({
    props: [{ noun: 'crate', category: 'container', description: 'a crate', widthFt: 3, depthFt: 3 }],
    rooms: [{ name: 'Store', props: [{ noun: 'ghost-shelf', count: 2, zone: 'wall' }, { noun: 'crate', count: 4, zone: 'corner' }] }],
  }, catalogue);
  const store = undeclared.byRoom.get('Store') ?? [];
  if (store.length !== 1 || store[0]?.noun !== 'crate') throw new Error('a request naming an undeclared noun must be dropped');

  // Out-of-enum values fall back rather than inventing a bucket or a placement the placer can't
  // read, and absurd dimensions are clamped rather than swallowing a room.
  const junk = parsePropPlan({
    props: [{ noun: 'Odd Thing', category: 'not-a-category', description: '', widthFt: 9999, depthFt: -4 }],
    rooms: [{ name: 'Room', props: [{ noun: 'odd-thing', count: 999, zone: 'sideways' }] }],
  }, catalogue);
  const odd = junk.props[0];
  if (odd?.noun !== 'odd-thing') throw new Error('a noun must be slugified');
  if (odd?.category !== 'decor') throw new Error('an unknown category must fall back to decor');
  if (odd?.description !== 'odd thing') throw new Error('a missing description must fall back to the noun');
  if (odd?.widthFt !== 30 || odd?.depthFt !== 1) throw new Error('dimensions must be clamped to a sane range');
  if (junk.byRoom.get('Room')?.[0]?.zone !== 'floor') throw new Error('an unknown zone must fall back to floor');

  console.log('propCatalogue selfcheck passed');
}

main();
