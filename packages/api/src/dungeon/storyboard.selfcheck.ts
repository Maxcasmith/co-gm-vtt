// Standalone check for storyboard.ts's beats-JSON parsing — no test framework in this repo, so
// this is the one runnable check: `tsx src/dungeon/storyboard.selfcheck.ts` from packages/api.
import { parseStoryboardBeats } from './storyboard.ts';

function expectThrow(fn: () => void, label: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`expected "${label}" to throw`);
}

// ── plain JSON array parses ─────────────────────────────────────────────────
{
  const beats = parseStoryboardBeats('[{"visual": "a", "narration": "b"}, {"visual": "c", "narration": "d"}]', 2);
  if (beats.length !== 2 || beats[0]!.visual !== 'a' || beats[0]!.narration !== 'b') {
    throw new Error(`plain array parse failed: ${JSON.stringify(beats)}`);
  }
}

// ── fenced ```json block is stripped ────────────────────────────────────────
{
  const beats = parseStoryboardBeats('```json\n[{"visual": "a", "narration": "b"}]\n```', 1);
  if (beats.length !== 1) throw new Error(`fenced parse failed: ${JSON.stringify(beats)}`);
}

// ── wrong length rejected ───────────────────────────────────────────────────
expectThrow(() => parseStoryboardBeats('[{"visual": "a", "narration": "b"}]', 2), 'wrong length');

// ── missing/non-string fields rejected ──────────────────────────────────────
expectThrow(() => parseStoryboardBeats('[{"visual": "a"}]', 1), 'missing narration');
expectThrow(() => parseStoryboardBeats('[{"visual": "a", "narration": 2}]', 1), 'non-string narration');
expectThrow(() => parseStoryboardBeats('["a"]', 1), 'plain string instead of object');

console.log('storyboard selfcheck: OK — plain/fenced beat JSON parses, wrong length and malformed beat objects are rejected.');
