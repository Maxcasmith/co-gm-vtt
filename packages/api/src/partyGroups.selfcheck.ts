// Pure-logic check for partyGroups.ts — no test framework in this repo, so this is the one
// runnable check: `tsx src/partyGroups.selfcheck.ts` from packages/api.
import assert from 'node:assert';
import { trackOf, activeSplit } from 'shared';
import { defaultPartyGroups, moveMember, addTrack, removeTrack } from './partyGroups.ts';

const roster = ['Aria', 'Bex', 'Cal'];
const g = defaultPartyGroups();

// Everyone starts on blue — not split.
assert.equal(trackOf(g, 'Aria'), 'blue');
assert.equal(activeSplit(g), undefined);

// Unknown track is rejected without mutating.
assert.equal(moveMember(g, 'Aria', 'green', roster), null);
assert.equal(g.members['Aria'], undefined);

// One member moving to red opens a split.
const t1 = moveMember(g, 'Aria', 'red', roster, 100)!;
assert.ok(t1.started);
assert.equal(activeSplit(g)?.id, t1.started.id);

// Further moves inside an open split neither open nor close it.
assert.equal(addTrack(g), 'green');
assert.deepEqual(moveMember(g, 'Bex', 'green', roster, 200), {});
assert.equal(g.splits.length, 1);

// Permanent and occupied tracks can't be removed; an empty added one can.
assert.equal(removeTrack(g, 'blue', roster), false);
assert.equal(removeTrack(g, 'green', roster), false);
moveMember(g, 'Bex', 'red', roster, 300);
assert.equal(removeTrack(g, 'green', roster), true);
assert.deepEqual(g.tracks, ['blue', 'red']);

// Everyone onto one track (not necessarily the first) closes the split.
const t2 = moveMember(g, 'Cal', 'red', roster, 400)!;
assert.equal(t2.ended?.id, t1.started.id);
assert.equal(t2.ended?.endedAt, 400);
assert.equal(activeSplit(g), undefined);

// A fresh split later gets a new id.
const t3 = moveMember(g, 'Cal', 'blue', roster, 500)!;
assert.ok(t3.started && t3.started.id !== t1.started.id);
assert.equal(g.splits.length, 2);

// Palette exhausts cleanly.
const full = defaultPartyGroups();
while (addTrack(full)) { /* fill */ }
assert.equal(full.tracks.length, 8);
assert.equal(addTrack(full), null);

console.log('partyGroups selfcheck OK');
