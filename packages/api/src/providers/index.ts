import type { AppConfig, StoryProvider, ModelTier, ApiKeys } from 'shared';
import { claudeComplete, claudeStream, claudeValidateKey, claudeChat } from './claude.ts';
import { openaiComplete, openaiStream, openaiValidateKey, openaiValidateImageKey, openaiChat } from './openai.ts';
import { deepseekComplete, deepseekStream, deepseekValidateKey, deepseekChat } from './deepseek.ts';
import { kimiComplete, kimiStream, kimiValidateKey, kimiChat } from './kimi.ts';
import { logError } from '../logger.ts';

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
  kimi: 'kimi',
};

export function getTierApiKey(apiKeys: AppConfig['apiKeys'], provider: StoryProvider): string {
  return apiKeys[PROVIDER_KEY_MAP[provider]] ?? '';
}

export function buildAdapter(tier: ModelTier, apiKey: string): StoryProviderAdapter {
  const { provider, model, effort } = tier;
  const adapters: Record<StoryProvider, StoryProviderAdapter> = {
    claude: {
      complete: p => claudeComplete(p, apiKey, model),
      stream: (p, cb) => claudeStream(p, apiKey, model, cb),
      chat: (sys, msgs) => claudeChat(sys, msgs, apiKey, model),
      validateKey: () => claudeValidateKey(apiKey),
    },
    openai: {
      complete: p => openaiComplete(p, apiKey, model, effort),
      stream: (p, cb) => openaiStream(p, apiKey, model, cb, effort),
      chat: (sys, msgs) => openaiChat(sys, msgs, apiKey, model, effort),
      validateKey: () => openaiValidateKey(apiKey),
    },
    deepseek: {
      complete: p => deepseekComplete(p, apiKey, model),
      stream: (p, cb) => deepseekStream(p, apiKey, model, cb),
      chat: (sys, msgs) => deepseekChat(sys, msgs, apiKey, model),
      validateKey: () => deepseekValidateKey(apiKey),
    },
    kimi: {
      complete: p => kimiComplete(p, apiKey, model, effort),
      stream: (p, cb) => kimiStream(p, apiKey, model, cb, effort),
      chat: (sys, msgs) => kimiChat(sys, msgs, apiKey, model, effort),
      validateKey: () => kimiValidateKey(apiKey),
    },
  };
  return adapters[provider];
}

const MAX_ATTEMPTS = 3;

export async function retry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logError(`${context}:attempt${attempt}`, err);
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

// Walks a fallback chain of models: each node gets MAX_ATTEMPTS retries before
// moving to the next node. Throws the last error once the whole chain is exhausted.
export function buildChainAdapter(chain: ModelTier[], apiKeys: ApiKeys): StoryProviderAdapter {
  async function withFallback<T>(label: string, call: (adapter: StoryProviderAdapter) => Promise<T>): Promise<T> {
    let lastErr: unknown = new Error('No models configured');
    for (const tier of chain) {
      const apiKey = getTierApiKey(apiKeys, tier.provider);
      if (!apiKey) {
        lastErr = new Error(`No API key configured for ${tier.provider}`);
        logError(`providers/index:chain:${label}:${tier.provider}/${tier.model}`, lastErr);
        continue;
      }
      const adapter = buildAdapter(tier, apiKey);
      try {
        return await retry(() => call(adapter), `providers/index:chain:${label}:${tier.provider}/${tier.model}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  return {
    complete: p => withFallback('complete', a => a.complete(p)),
    stream: (p, cb) => withFallback('stream', a => a.stream(p, cb)),
    chat: (sys, msgs) => withFallback('chat', a => a.chat(sys, msgs)),
    validateKey: async () => {
      const first = chain[0];
      if (!first) return false;
      const apiKey = getTierApiKey(apiKeys, first.provider);
      if (!apiKey) return false;
      return buildAdapter(first, apiKey).validateKey();
    },
  };
}

export function getStoryProvider(config: AppConfig): StoryProviderAdapter {
  return buildChainAdapter(config.tiers[config.tasks.story], config.apiKeys);
}

export function getCombatProvider(config: AppConfig): StoryProviderAdapter {
  return buildChainAdapter(config.tiers[config.tasks.combat], config.apiKeys);
}

export function getImageProvider(config: AppConfig) {
  return {
    validateKey: () => openaiValidateImageKey(config.apiKeys.openai),
  };
}
