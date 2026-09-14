// Runnable check for detectMissedSkillCheck: `tsx src/session.detectMissedSkillCheck.selfcheck.ts`
// from packages/api. No test framework in this repo — see doorUnlock.selfcheck.ts for the pattern.
import type { ChatPayload, CheckRequest } from 'shared';
import { detectMissedSkillCheck } from './session.ts';

function msg(senderName: string, text: string): ChatPayload {
  return { senderName, text, timestamp: Date.now() };
}

// Reproduces the observed miss: player explicitly asks for an Insight check, DM's own tags
// produced none — should synthesize the missing request.
const missed = detectMissedSkillCheck(
  [msg('Dalia', 'I want to insight check this man, does he look like trouble?')],
  [],
);
if (!missed || missed.player !== 'Dalia' || missed.skill !== 'Insight' || missed.type !== 'check') {
  throw new Error(`expected a synthesized Insight check for Dalia, got ${JSON.stringify(missed)}`);
}

// DM already emitted the tag (checkRequests non-empty for this player+skill) — must not duplicate.
const notDuplicated = detectMissedSkillCheck(
  [msg('Dalia', 'Can I make a Perception check?')],
  [{ player: 'Dalia', skill: 'Perception', type: 'check' } as CheckRequest],
);
if (notDuplicated) throw new Error(`expected no duplicate request, got ${JSON.stringify(notDuplicated)}`);

// No skill named — nothing to synthesize.
const noSkill = detectMissedSkillCheck([msg('Dalia', 'I approach the widow and ask about the coal yard.')], []);
if (noSkill) throw new Error(`expected no request without a named skill, got ${JSON.stringify(noSkill)}`);

// The DM's own narration mentions a skill+check but isn't the player asking — must be ignored
// (only the last non-DM/System/Combat message is considered).
const dmNarrationIgnored = detectMissedSkillCheck(
  [msg('Dalia', 'I search the room.'), msg('Virtual DM', 'That would call for an Investigation check.')],
  [],
);
if (dmNarrationIgnored) throw new Error(`expected DM's own narration to be ignored, got ${JSON.stringify(dmNarrationIgnored)}`);

console.log('detectMissedSkillCheck selfcheck: OK — synthesizes a missing request, skips duplicates, skips no-skill and DM-authored lines.');
