import type { AppConfig, StoryProvider, ModelTier, ApiKeys } from 'shared';
import { claudeComplete, claudeStream, claudeValidateKey, claudeChat } from './claude.ts';
import { openaiComplete, openaiStream, openaiValidateKey, openaiValidateImageKey, openaiChat } from './openai.ts';
import { deepseekComplete, deepseekStream, deepseekValidateKey, deepseekChat } from './deepseek.ts';

export type { ChatMessage } from './claude.ts';

export interface StoryProviderAdapter {
  complete: (prompt: string) => Promise<string>;
  stream: (prompt: string, onToken: (t: string) => void) => Promise<string>;
  chat: (system: string, messages: import('./claude.ts').ChatMessage[]) => Promise<string>;
  validateKey: () => Promise<boolean>;
}

const PROVIDER_KEY_MAP: Record<StoryProvider, keyof ApiKeys> = {
  claude: 'anthropic',
  openai: 'openai',
  deepseek: 'deepseek',
};

export function getTierApiKey(apiKeys: AppConfig['apiKeys'], provider: StoryProvider): string {
  return apiKeys[PROVIDER_KEY_MAP[provider]] ?? '';
}

function buildAdapter(tier: ModelTier, apiKey: string): StoryProviderAdapter {
  const { provider, model } = tier;
  const adapters: Record<StoryProvider, StoryProviderAdapter> = {
    claude: {
      complete: p => claudeComplete(p, apiKey, model),
      stream: (p, cb) => claudeStream(p, apiKey, model, cb),
      chat: (sys, msgs) => claudeChat(sys, msgs, apiKey, model),
      validateKey: () => claudeValidateKey(apiKey),
    },
    openai: {
      complete: p => openaiComplete(p, apiKey, model),
      stream: (p, cb) => openaiStream(p, apiKey, model, cb),
      chat: (sys, msgs) => openaiChat(sys, msgs, apiKey, model),
      validateKey: () => openaiValidateKey(apiKey),
    },
    deepseek: {
      complete: p => deepseekComplete(p, apiKey, model),
      stream: (p, cb) => deepseekStream(p, apiKey, model, cb),
      chat: (sys, msgs) => deepseekChat(sys, msgs, apiKey, model),
      validateKey: () => deepseekValidateKey(apiKey),
    },
  };
  return adapters[provider];
}

export function getStoryProvider(config: AppConfig): StoryProviderAdapter {
  const tier = config.tiers[config.tasks.story];
  return buildAdapter(tier, getTierApiKey(config.apiKeys, tier.provider));
}

export function getCombatProvider(config: AppConfig): StoryProviderAdapter {
  const tier = config.tiers[config.tasks.combat];
  return buildAdapter(tier, getTierApiKey(config.apiKeys, tier.provider));
}

export function getImageProvider(config: AppConfig) {
  return {
    validateKey: () => openaiValidateImageKey(config.apiKeys.openai),
  };
}
