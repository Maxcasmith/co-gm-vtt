const API_BASE = 'https://api.openai.com/v1';

export async function openaiComplete(prompt: string, apiKey: string, model: string): Promise<string> {
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

export async function openaiStream(
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

export async function openaiValidateKey(apiKey: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

export async function openaiValidateImageKey(apiKey: string): Promise<boolean> {
  return openaiValidateKey(apiKey);
}

export async function describeImage(base64image: string, apiKey: string): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this character\'s physical appearance in detail: face shape, hair colour and style, skin tone, distinctive features, expression, and any visible clothing or accessories. Be specific and vivid. 2-3 sentences only.',
          },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64image}`, detail: 'low' } },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message.content ?? '';
}

export async function generatePortraitImage(prompt: string, apiKey: string, model: string): Promise<Buffer> {
  const res = await fetch(`${API_BASE}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size: '1024x1792',
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? res.statusText);
  }
  const data = await res.json() as { data: { b64_json: string }[] };
  const b64 = data.data[0]?.b64_json;
  if (!b64) throw new Error('No image returned from DALL-E');
  return Buffer.from(b64, 'base64');
}
