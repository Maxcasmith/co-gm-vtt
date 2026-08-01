import type { ReasoningEffort } from 'shared';
import { logError } from '../logger.ts';

const API_BASE = 'https://api.moonshot.ai/v1';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

// Kimi only accepts low|high|max — collapse the app's 4-level UI onto that.
function toKimiEffort(effort?: ReasoningEffort): 'low' | 'high' | 'max' {
  switch (effort) {
    case 'low': return 'low';
    case 'medium': return 'high';
    case 'high': return 'high';
    case 'maximum': return 'max';
    default: return 'max';
  }
}

export async function kimiChat(system: string, messages: ChatMessage[], apiKey: string, model: string, effort?: ReasoningEffort): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // K3's 1M context leaves plenty of room — cap generously so high reasoning
      // effort never truncates the real answer before it starts.
      max_tokens: 100000,
      reasoning_effort: toKimiEffort(effort),
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? '';
}

export async function kimiComplete(prompt: string, apiKey: string, model: string, effort?: ReasoningEffort): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 100000,
      reasoning_effort: toKimiEffort(effort),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? '';
}

export async function kimiStream(
  prompt: string,
  apiKey: string,
  model: string,
  onToken: (token: string) => void,
  effort?: ReasoningEffort,
): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 100000,
      reasoning_effort: toKimiEffort(effort),
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }

  let full = '';
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data) as { choices: { delta?: { content?: string } }[] };
        const token = evt.choices[0]?.delta?.content;
        if (token) { full += token; onToken(token); }
      } catch (err) { logError('providers/kimi:kimiStream', err); }
    }
  }
  return full;
}

export async function kimiValidateKey(apiKey: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}
