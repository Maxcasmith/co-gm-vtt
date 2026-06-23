import type { AppConfig, StoryProvider } from 'shared';
import { claudeComplete, claudeStream, claudeValidateKey } from './claude.ts';
import { openaiComplete, openaiStream, openaiValidateKey, openaiValidateImageKey } from './openai.ts';
import { deepseekComplete, deepseekStream, deepseekValidateKey } from './deepseek.ts';

export interface StoryProviderAdapter {
  complete: (prompt: string) => Promise<string>;
  stream: (prompt: string, onToken: (t: string) => void) => Promise<string>;
  validateKey: () => Promise<boolean>;
}

export function getStoryProvider(config: AppConfig): StoryProviderAdapter {
  const { provider, model, apiKey } = config.story;
  const adapters: Record<StoryProvider, StoryProviderAdapter> = {
    claude: {
      complete: p => claudeComplete(p, apiKey, model),
      stream: (p, cb) => claudeStream(p, apiKey, model, cb),
      validateKey: () => claudeValidateKey(apiKey),
    },
    openai: {
      complete: p => openaiComplete(p, apiKey, model),
      stream: (p, cb) => openaiStream(p, apiKey, model, cb),
      validateKey: () => openaiValidateKey(apiKey),
    },
    deepseek: {
      complete: p => deepseekComplete(p, apiKey, model),
      stream: (p, cb) => deepseekStream(p, apiKey, model, cb),
      validateKey: () => deepseekValidateKey(apiKey),
    },
  };
  return adapters[provider];
}

export function getImageProvider(config: AppConfig) {
  return {
    validateKey: () => openaiValidateImageKey(config.image.apiKey),
  };
}
