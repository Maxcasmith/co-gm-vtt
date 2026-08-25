// Standalone check for resolveHit — no test framework in this repo, so this is the one runnable
// check: `tsx src/combat/dice.resolveHit.selfcheck.ts` from packages/api.
// Asserts: a natural 1 always misses even with a huge bonus against a trivial AC, a natural 20
// always hits even against an impossible AC, and everything else is a plain total-vs-AC compare.
import { resolveHit } from './dice.ts';

// Natural 1 — auto-miss, regardless of how far attackBonus+1 would clear the AC.
if (resolveHit(1, 50, 5) !== false) throw new Error('nat1 should always miss, even with attackBonus=50 vs AC=5');
if (resolveHit(1, 0, 1) !== false) throw new Error('nat1 should always miss, even vs the lowest possible AC');

// Natural 20 — auto-hit, regardless of how far short attackBonus+20 falls of the AC.
if (resolveHit(20, -10, 100) !== true) throw new Error('nat20 should always hit, even with attackBonus=-10 vs AC=100');
if (resolveHit(20, 0, 21) !== true) throw new Error('nat20 should always hit, even 1 short of AC on the flat total');

// Everything else — plain roll+bonus vs AC.
if (resolveHit(10, 5, 15) !== true) throw new Error('10+5=15 should hit AC 15 (meets, not just beats)');
if (resolveHit(10, 5, 16) !== false) throw new Error('10+5=15 should miss AC 16');
if (resolveHit(2, 0, 3) !== false) throw new Error('a non-nat1/nat20 roll below AC should still miss');
if (resolveHit(19, 0, 19) !== true) throw new Error('a non-nat1/nat20 roll meeting AC should still hit');

console.log('dice.resolveHit selfcheck: OK — nat1 always misses, nat20 always hits, everything else is total vs AC.');
