import type { Quest } from 'shared';
import { readPlotArcs, writePlotArcs } from './storage.ts';

// Called whenever a quest resolves (effects.ts's quest_resolve handler) — if that quest was the
// current beat of an active plot arc, reveal the next beat by pushing it into `quests` (mutated in
// place; the caller already holds this array and writes it once, same as the resolve itself does).
// Beats after the new current one stay in plot-arcs.json only — never added as a quest, never seen
// by any prompt — until their own turn comes. An arc with no next beat is simply dropped: it's done.
export async function advancePlotArc(cid: string, resolvedQuestId: string, quests: Quest[]): Promise<void> {
  const arcs = await readPlotArcs(cid);
  const arc = arcs.find(a => a.beats[a.currentBeatIndex]?.questId === resolvedQuestId);
  if (!arc) return;

  const next = arc.beats[arc.currentBeatIndex + 1];
  if (next) {
    arc.currentBeatIndex += 1;
    quests.push({ id: next.questId, name: next.name, description: next.description, status: 'undiscovered', log: [], addedAt: new Date().toISOString().slice(0, 10) });
    await writePlotArcs(cid, arcs);
  } else {
    await writePlotArcs(cid, arcs.filter(a => a !== arc));
  }
}
