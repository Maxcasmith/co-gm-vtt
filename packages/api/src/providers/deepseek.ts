const API_BASE = 'https://api.deepseek.com/v1';

export async function deepseekComplete(prompt: string, apiKey: string, model: string): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
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

export async function deepseekStream(
  prompt: string,
  apiKey: string,
  model: string,
  onToken: (token: string) => void,
): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
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
      } catch { /* ignore malformed SSE lines */ }
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
