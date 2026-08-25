// Standalone check for fetchManifest's predefinedQuests handling — no test framework in this
// repo, so this is the one runnable check: `tsx src/dungeon/manifest.predefinedQuests.selfcheck.ts`
// from packages/api. Uses the isGeneric() no-LLM fallback path (name "cave") so this needs no
// network/API key and stays deterministic.
// Asserts: no predefinedQuests → goals stays empty (unchanged behavior), predefinedQuests given →
// dungeon.goals becomes exactly their descriptions, verbatim — never re-derived or reworded.
import { fetchManifest } from './manifest.ts';
import type { StoryProviderAdapter } from '../providers/index.ts';

// Never actually called on the isGeneric path — present only to satisfy the adapter param.
const unusedAdapter = {} as StoryProviderAdapter;

async function main() {
  const noQuests = await fetchManifest('cave', 'dungeon-crawl', unusedAdapter, '', [6, 10], 4, 1, undefined, []);
  if (noQuests.goals.length !== 0) throw new Error(`expected empty goals with no predefinedQuests, got: ${JSON.stringify(noQuests.goals)}`);

  const predefinedQuests = [
    { name: 'Rescue the Cartographer', description: 'Find and free the cartographer held somewhere in these caves.' },
  ];
  const withQuests = await fetchManifest('cave', 'dungeon-crawl', unusedAdapter, '', [6, 10], 4, 1, undefined, predefinedQuests);
  if (withQuests.goals.length !== 1 || withQuests.goals[0] !== predefinedQuests[0]!.description) {
    throw new Error(`expected goals to be exactly the predefined quest description(s), got: ${JSON.stringify(withQuests.goals)}`);
  }
}

main()
  .then(() => console.log('manifest.predefinedQuests selfcheck: OK — no quests leaves goals empty, predefined quests become dungeon.goals verbatim.'))
  .catch(err => { console.error(err); process.exitCode = 1; });
