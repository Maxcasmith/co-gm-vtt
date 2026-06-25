import type { NarrationModel } from 'shared';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';

interface State {
  model: NarrationModel;
  voice: string;
  apiKey: string;
  queue: string[];
  playing: boolean;
}

const state: State = { model: 'none', voice: 'onyx', apiKey: '', queue: [], playing: false };

export function initNarration(model: NarrationModel, voice: string, apiKey: string): void {
  state.model = model;
  state.voice = voice;
  state.apiKey = apiKey;
}

export function narrate(text: string): void {
  if (state.model === 'none') return;
  state.queue.push(text);
  if (!state.playing) void drain();
}

export async function previewVoice(model: 'tts-1' | 'tts-1-hd', voice: string, apiKey: string): Promise<void> {
  await playOpenAI(`Hi, I'm ${voice}, I will be your narrator today.`, model, voice, apiKey);
}

async function drain(): Promise<void> {
  const text = state.queue.shift();
  if (!text) { state.playing = false; return; }
  state.playing = true;
  await playText(text);
  void drain();
}

function playText(text: string): Promise<void> {
  if (state.model === 'browser') return playBrowser(text);
  return playOpenAI(text, state.model as 'tts-1' | 'tts-1-hd', state.voice, state.apiKey);
}

function playBrowser(text: string): Promise<void> {
  return new Promise(resolve => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    speechSynthesis.speak(utt);
  });
}

async function playOpenAI(text: string, model: 'tts-1' | 'tts-1-hd', voice: string, apiKey: string): Promise<void> {
  try {
    const r = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, voice, input: text }),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    await new Promise<void>(resolve => {
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      void audio.play().catch(() => resolve());
    });
  } catch {
    // silently skip — narration is ambient, never block the game
  }
}
