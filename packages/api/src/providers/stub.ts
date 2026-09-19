import type { StoryProviderAdapter } from './index.ts';
import type { ChatMessage } from './claude.ts';

// LLM_STUB=1 — a deterministic stand-in for every AI feature, so the game (and its integration
// selfchecks) run with no API keys and no model calls. It never tries to write good prose; each
// reply exposes what the caller fed it, so routing/context bugs are visible in the output itself.
export const LLM_STUB = process.env.LLM_STUB === '1';

const SPEAKER_RE = /^\[([^\]]+)\]:/gm;

/** DM turn: names every speaker in the context it was given (per-track DM context is checkable),
 * notes whether the "Elsewhere" block reached it, and starts a fight when the last line says "attack!". */
function stubChat(system: string, messages: ChatMessage[]): string {
  const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
  const heard = [...new Set([...userText.matchAll(SPEAKER_RE)].map(m => m[1]!).filter(s => s !== 'Roll Result'))];
  const last = messages.at(-1)?.content.split('\n').at(-1) ?? '';
  const elsewhere = system.includes('Elsewhere — the party is split') ? ' elsewhere:yes' : '';
  const combat = /attack!/i.test(last) ? ' [[COMBAT_INIT:Stub Goblin]]' : '';
  return `[stub DM] heard:${heard.join(',') || '-'}${elsewhere}${combat}`;
}

/** One-shot prompts: answered by shape. Side assignment groups creatures by the first word of their
 * name ("Thief …" vs "Watch …" → rival sides; two "Goblin"s → one side). Anything else that wants
 * JSON gets `null`, which every JSON caller already treats as "no answer" and falls back from. */
function stubComplete(prompt: string): string {
  if (prompt.includes('"assignments"')) {
    const joining = prompt.split('Creatures joining now:')[1]?.split('\n\n')[0] ?? '';
    const assignments = [...joining.matchAll(/^- ([^:]+): (\S+)/gm)].map(m => ({ id: m[1]!.trim(), side: m[2]!.trim() }));
    return JSON.stringify({ assignments });
  }
  if (prompt.includes('summarising what one group')) return '[stub summary]';
  if (/JSON/.test(prompt)) return 'null';
  return '[stub]';
}

export const stubAdapter: StoryProviderAdapter = {
  complete: async prompt => stubComplete(prompt),
  stream: async (prompt, onToken) => { const out = stubComplete(prompt); onToken(out); return out; },
  chat: async (system, messages) => stubChat(system, messages),
  validateKey: async () => true,
};
