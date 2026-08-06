import { logError } from '../logger.ts';

const API_BASE = 'https://api.deepseek.com/v1';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export async function deepseekChat(system: string, messages: ChatMessage[], apiKey: string, model: string, timeoutSeconds?: number): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    ...(timeoutSeconds ? { signal: AbortSignal.timeout(timeoutSeconds * 1000) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? '';
}

export async function deepseekComplete(prompt: string, apiKey: string, model: string, timeoutSeconds?: number): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
    ...(timeoutSeconds ? { signal: AbortSignal.timeout(timeoutSeconds * 1000) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? '';
}

export async function deepseekStream(
  prompt: string,
  apiKey: string,
  model: string,
  onToken: (token: string) => void,
  timeoutSeconds?: number,
): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // DeepSeek caps output at 8192 regardless of what's requested — don't ask for more.
      max_tokens: 8192,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
    ...(timeoutSeconds ? { signal: AbortSignal.timeout(timeoutSeconds * 1000) } : {}),
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
        const evt = JSON.parse(data) as { choices: { delta?: { content?: string; reasoning_content?: string } }[] };
        const delta = evt.choices[0]?.delta;
        // R1-style models stream thinking under reasoning_content before the real answer starts —
        // surface it to onToken (visible progress) but never fold it into `full` (parsed downstream).
        if (delta?.reasoning_content) onToken(delta.reasoning_content);
        if (delta?.content) { full += delta.content; onToken(delta.content); }
      } catch (err) { logError('providers/deepseek:deepseekStream', err); }
    }
  }
  return full;
}

export async function deepseekValidateKey(apiKey: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}
