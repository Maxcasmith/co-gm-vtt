// Standalone check for resolveStairLinks — no test framework in this repo, so this is the one
// runnable check: `tsx src/dungeon/manifest.stairLinks.selfcheck.ts` from packages/api. Mirrors
// doorLocks.selfcheck.ts's per-room validation section: a valid reciprocal pair survives, and
// every way a stairsTo can fail to resolve gets downgraded (isStairwell/stairsTo both stripped)
// rather than shipping a stairwell buildingLayout.ts could never place a working entity for.
import { resolveStairLinks } from './manifest.ts';
import type { ManifestRoom } from './manifest.ts';

// ── 1. Valid reciprocal pair survives ───────────────────────────────────────────────────────────
{
  const rooms: ManifestRoom[] = [
    { name: 'Ground Stairwell', size: 'small', floor: 0, isStairwell: true, stairsTo: 'Upper Stairwell' },
    { name: 'Upper Stairwell', size: 'small', floor: 1, isStairwell: true, stairsTo: 'Ground Stairwell' },
  ];
  const fixed = resolveStairLinks(rooms);
  const ground = fixed.find(r => r.name === 'Ground Stairwell')!;
  const upper = fixed.find(r => r.name === 'Upper Stairwell')!;
  if (!ground.isStairwell || ground.stairsTo !== 'Upper Stairwell') throw new Error(`expected a valid reciprocal pair to survive, got: ${JSON.stringify(ground)}`);
  if (!upper.isStairwell || upper.stairsTo !== 'Ground Stairwell') throw new Error(`expected a valid reciprocal pair to survive, got: ${JSON.stringify(upper)}`);
  console.log('resolveStairLinks: OK — valid reciprocal pair survives.');
}

// ── 2. One-directional pairing is still valid (only one side declares stairsTo) ────────────────
{
  const rooms: ManifestRoom[] = [
    { name: 'A', size: 'small', floor: 0, isStairwell: true, stairsTo: 'B' },
    { name: 'B', size: 'small', floor: 1, isStairwell: true }, // never declares stairsTo back
  ];
  const fixed = resolveStairLinks(rooms);
  const a = fixed.find(r => r.name === 'A')!;
  const b = fixed.find(r => r.name === 'B')!;
  if (!a.isStairwell || a.stairsTo !== 'B') throw new Error(`expected A's one-directional stairsTo to survive, got: ${JSON.stringify(a)}`);
  if (!b.isStairwell) throw new Error(`expected B to stay isStairwell even with no stairsTo of its own (it's still a valid target for A), got: ${JSON.stringify(b)}`);
  console.log('resolveStairLinks: OK — one-directional pairing survives on both sides.');
}

// ── 3. stairsTo pointing at a non-existent room downgrades ─────────────────────────────────────
{
  const rooms: ManifestRoom[] = [
    { name: 'Lonely', size: 'small', floor: 0, isStairwell: true, stairsTo: 'Nonexistent Room' },
  ];
  const fixed = resolveStairLinks(rooms);
  const lonely = fixed.find(r => r.name === 'Lonely')!;
  if (lonely.isStairwell || lonely.stairsTo) throw new Error(`expected a dangling stairsTo to downgrade, got: ${JSON.stringify(lonely)}`);
  console.log('resolveStairLinks: OK — stairsTo pointing at a non-existent room downgrades.');
}

// ── 4. stairsTo pointing at a real room that isn't itself isStairwell downgrades ────────────────
{
  const rooms: ManifestRoom[] = [
    { name: 'Confused', size: 'small', floor: 0, isStairwell: true, stairsTo: 'Ordinary Room' },
    { name: 'Ordinary Room', size: 'small', floor: 1 },
  ];
  const fixed = resolveStairLinks(rooms);
  const confused = fixed.find(r => r.name === 'Confused')!;
  if (confused.isStairwell || confused.stairsTo) throw new Error(`expected stairsTo targeting a non-stairwell room to downgrade, got: ${JSON.stringify(confused)}`);
  const ordinary = fixed.find(r => r.name === 'Ordinary Room')!;
  if (ordinary.isStairwell) throw new Error(`the untouched target room should never gain isStairwell it didn't already have, got: ${JSON.stringify(ordinary)}`);
  console.log('resolveStairLinks: OK — stairsTo targeting a non-stairwell room downgrades.');
}

// ── 5. stairsTo pointing at itself downgrades ───────────────────────────────────────────────────
{
  const rooms: ManifestRoom[] = [
    { name: 'Self-Referential', size: 'small', floor: 0, isStairwell: true, stairsTo: 'Self-Referential' },
  ];
  const fixed = resolveStairLinks(rooms);
  const room = fixed.find(r => r.name === 'Self-Referential')!;
  if (room.isStairwell || room.stairsTo) throw new Error(`expected a self-referencing stairsTo to downgrade, got: ${JSON.stringify(room)}`);
  console.log('resolveStairLinks: OK — a room referencing itself downgrades.');
}

// ── 6. Non-stairwell rooms pass through untouched ───────────────────────────────────────────────
{
  const rooms: ManifestRoom[] = [{ name: 'Plain', size: 'medium', floor: 0 }];
  const fixed = resolveStairLinks(rooms);
  if (JSON.stringify(fixed) !== JSON.stringify(rooms)) throw new Error(`expected a non-stairwell room to pass through untouched, got: ${JSON.stringify(fixed)}`);
  console.log('resolveStairLinks: OK — non-stairwell rooms pass through untouched.');
}

// ── 7. Three-way tangle: two rooms both claim the same target — only the first wins ─────────────
{
  const rooms: ManifestRoom[] = [
    { name: 'A', size: 'small', floor: 0, isStairwell: true, stairsTo: 'B' },
    { name: 'B', size: 'small', floor: 1, isStairwell: true },
    { name: 'C', size: 'small', floor: 2, isStairwell: true, stairsTo: 'B' },
  ];
  const fixed = resolveStairLinks(rooms);
  const a = fixed.find(r => r.name === 'A')!;
  const b = fixed.find(r => r.name === 'B')!;
  const c = fixed.find(r => r.name === 'C')!;
  if (!a.isStairwell || a.stairsTo !== 'B') throw new Error(`expected A (first claimant) to keep its pairing with B, got: ${JSON.stringify(a)}`);
  if (!b.isStairwell) throw new Error(`expected B to stay isStairwell (claimed by A), got: ${JSON.stringify(b)}`);
  if (c.isStairwell || c.stairsTo) throw new Error(`expected C (second claimant of the same target) to downgrade — only one entity may ever land on B's cell, got: ${JSON.stringify(c)}`);
  console.log('resolveStairLinks: OK — a second room claiming an already-claimed target downgrades, preventing two stairs entities on one cell.');
}

console.log('manifest.stairLinks selfcheck: all assertions passed');
