import { useEffect, useState } from 'react';
import type { StoryProvider } from 'shared';

export type ModelCatalog = { id: StoryProvider; label: string; models: { id: string; label: string; supportsEffort?: boolean }[] }[];

// Fallback used for the instant first render — and if /api/models is unreachable.
export const LOCAL_STORY_PROVIDERS: ModelCatalog = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5', supportsEffort: true },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', supportsEffort: true },
      { id: 'gpt-5.4', label: 'GPT-5.4', supportsEffort: true },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { id: 'o4-mini', label: 'o4 Mini (Reasoning)', supportsEffort: true },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', supportsEffort: true },
    ],
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot AI)',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3', supportsEffort: true },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
      { id: 'kimi-k2.6', label: 'Kimi K2.6' },
    ],
  },
  {
    id: 'qwen',
    label: 'Qwen (Alibaba)',
    models: [
      { id: 'qwen3.8-max', label: 'Qwen3.8 Max' },
    ],
  },
];

const API = `http://${window.location.hostname}:3001`;

// Renders from LOCAL_STORY_PROVIDERS immediately, then swaps in the DB-backed list once
// /api/models resolves — avoids an empty/flickering select while the fetch is in flight.
export function useModelCatalog(): ModelCatalog {
  const [catalog, setCatalog] = useState<ModelCatalog>(LOCAL_STORY_PROVIDERS);

  useEffect(() => {
    fetch(`${API}/api/models`)
      .then(r => r.json())
      .then((data: ModelCatalog) => { if (data.length) setCatalog(data); })
      .catch(() => { });
  }, []);

  return catalog;
}
