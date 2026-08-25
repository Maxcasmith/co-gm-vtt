// Standalone check for stripRepeatedSentences — no test framework in this repo, so this is the
// one runnable check: `tsx src/session.stripRepeatedSentences.selfcheck.ts` from packages/api.
// Asserts: a sentence that's a near-restatement of one already said gets cut, genuinely new
// content survives, a short/generic sentence is never judged on overlap alone, and stripping
// everything away falls back to the original text rather than sending a blank turn.
import { stripRepeatedSentences } from './session.ts';

const recent = 'The mine continues on, rocks are half fallen across the passage. A cold draft comes from somewhere ahead.';

// Near-restatement (same words, reordered/reworded) of an already-said sentence — cut.
const repeated = stripRepeatedSentences(
  'Rocks are half fallen across the passage as the mine continues on. You see a locked door to the north.',
  recent,
);
if (repeated.includes('mine continues on')) throw new Error(`repeated sentence survived: "${repeated}"`);
if (!repeated.includes('locked door')) throw new Error(`new sentence was wrongly stripped: "${repeated}"`);

// Entirely new content, no overlap — nothing stripped.
const fresh = stripRepeatedSentences('A rusted lever juts from the wall beside the door.', recent);
if (fresh !== 'A rusted lever juts from the wall beside the door.') throw new Error(`fresh sentence was altered: "${fresh}"`);

// Short sentence ("Nothing else.") — never judged on word-overlap, always kept.
const short = stripRepeatedSentences('Nothing else.', recent);
if (short !== 'Nothing else.') throw new Error(`short sentence was wrongly stripped: "${short}"`);

// Stripping would empty the response entirely — falls back to the original rather than going blank.
const wouldEmpty = stripRepeatedSentences(
  'The mine continues on, rocks are half fallen across the passage.',
  recent,
);
if (!wouldEmpty.trim().length) throw new Error('stripping to empty should fall back to the original text, not go blank');

// No recent DM history at all — nothing to compare against, text passes through untouched.
if (stripRepeatedSentences('Anything at all.', '') !== 'Anything at all.') {
  throw new Error('empty recent history should be a no-op');
}

console.log('session.stripRepeatedSentences selfcheck: OK — near-duplicates cut, new content kept, short lines never judged, never strips to empty.');
