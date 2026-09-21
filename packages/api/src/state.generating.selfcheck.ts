// Check for the in-flight generation registry — no test framework in this repo, so this is the one
// runnable check: `npx tsx src/state.generating.selfcheck.ts` from packages/api. Pure in-memory,
// no sockets. The failure this guards against is a stuck entry: a reconnecting player handed a
// loading screen, with their inputs disabled, for a generation that already finished.
import { markDungeonGenerating, isDungeonGeneratingFor, markFightGenerating, isFightGenerating } from './state.ts';

const CID = '__selfcheck-campaign__';

function main() {
  if (isDungeonGeneratingFor(CID, 'blue')) throw new Error('nothing should be generating on a clean registry');

  // Track-scoped: only the group that walked in waits, the rest of the party plays on.
  markDungeonGenerating(CID, ['blue'], true);
  if (!isDungeonGeneratingFor(CID, 'blue')) throw new Error('the generating track should be waiting');
  if (isDungeonGeneratingFor(CID, 'red')) throw new Error('another group must not be locked behind a generation that is not theirs');
  markDungeonGenerating(CID, ['blue'], false);
  if (isDungeonGeneratingFor(CID, 'blue')) throw new Error('clearing must release the track');

  // null tracks = the party is not split, so everyone is waiting — including a player whose track
  // is undefined because no groups exist at all.
  markDungeonGenerating(CID, null, true);
  if (!isDungeonGeneratingFor(CID, 'blue')) throw new Error('an unsplit generation should cover every track');
  if (!isDungeonGeneratingFor(CID, undefined)) throw new Error('an unsplit generation should cover a player with no track');
  markDungeonGenerating(CID, null, false);
  if (isDungeonGeneratingFor(CID, undefined)) throw new Error('clearing an unsplit generation must release everyone');

  // Two groups generating at once resolve independently — clearing one must not release the other.
  markDungeonGenerating(CID, ['blue'], true);
  markDungeonGenerating(CID, ['red'], true);
  markDungeonGenerating(CID, ['blue'], false);
  if (isDungeonGeneratingFor(CID, 'blue')) throw new Error('blue was cleared');
  if (!isDungeonGeneratingFor(CID, 'red')) throw new Error('clearing one track must not release another still generating');
  markDungeonGenerating(CID, ['red'], false);

  // Campaigns are isolated from each other.
  markDungeonGenerating(CID, ['blue'], true);
  if (isDungeonGeneratingFor('__other-campaign__', 'blue')) throw new Error('a generation in one campaign must not lock another');
  markDungeonGenerating(CID, ['blue'], false);

  // Fights, same contract.
  if (isFightGenerating('fight-1')) throw new Error('nothing should be generating on a clean registry');
  markFightGenerating('fight-1', true);
  if (!isFightGenerating('fight-1')) throw new Error('the fight should be marked generating');
  if (isFightGenerating('fight-2')) throw new Error('an unrelated fight must not be marked');
  markFightGenerating('fight-1', false);
  if (isFightGenerating('fight-1')) throw new Error('clearing must release the fight');
}

main();
console.log('generation registry selfcheck: OK — track scoping, unsplit coverage, independent clears, and campaign isolation all behave.');
