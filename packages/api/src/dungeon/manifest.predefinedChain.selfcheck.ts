// Standalone check for fetchManifest's predefinedChain handling — no test framework in this
// repo, so this is the one runnable check: `tsx src/dungeon/manifest.predefinedChain.selfcheck.ts`
// from packages/api. Uses the isGeneric() no-LLM fallback path (name "cave") so this needs no
// network/API key and stays deterministic.
// Asserts: no predefinedChain → questChain stays empty (unchanged behavior); predefinedChain given
// → questChain becomes exactly that stage, id/name/description verbatim, never re-derived or
// reworded — and since the generic path never calls a real model to decide a trigger, it falls
// back to exit_dungeon (always eventually true) rather than inventing one.
import { fetchManifest } from './manifest.ts';
import type { StoryProviderAdapter } from '../providers/index.ts';

// Never actually called on the isGeneric path — present only to satisfy the adapter param.
const unusedAdapter = {} as StoryProviderAdapter;

async function main() {
  const noQuests = await fetchManifest('cave', 'dungeon-crawl', unusedAdapter, '', [6, 10], 4, 1, undefined, []);
  if (noQuests.questChain.length !== 0) throw new Error(`expected empty questChain with no predefinedChain, got: ${JSON.stringify(noQuests.questChain)}`);

  const predefinedChain = [
    { id: 'rescue-the-cartographer', name: 'Rescue the Cartographer', description: 'Find and free the cartographer held somewhere in these caves.' },
  ];
  const withChain = await fetchManifest('cave', 'dungeon-crawl', unusedAdapter, '', [6, 10], 4, 1, undefined, predefinedChain);
  if (withChain.questChain.length !== 1) throw new Error(`expected exactly one chain stage, got: ${JSON.stringify(withChain.questChain)}`);
  const stage = withChain.questChain[0]!;
  if (stage.id !== predefinedChain[0]!.id || stage.name !== predefinedChain[0]!.name || stage.description !== predefinedChain[0]!.description) {
    throw new Error(`expected the predefined stage's id/name/description verbatim, got: ${JSON.stringify(stage)}`);
  }
  if (stage.trigger.kind !== 'exit_dungeon') {
    throw new Error(`expected the generic no-LLM path to fall back to an exit_dungeon trigger, got: ${JSON.stringify(stage.trigger)}`);
  }
}

main()
  .then(() => console.log('manifest.predefinedChain selfcheck: OK — no chain leaves questChain empty, a predefined stage survives verbatim with a fallback trigger.'))
  .catch(err => { console.error(err); process.exitCode = 1; });
