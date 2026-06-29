import { ConfigSchema } from './types.js';
import type { Config } from './types.js';

type Category = 'provider_flag' | 'api_key' | 'token' | 'feature' | 'behavior' | 'limit';

function inferCategory(key: string): Category {
  if (key.startsWith('SEMANTIC_') || key.startsWith('RERANK_') || key.startsWith('INTENT_')) return 'feature';
  if (key.endsWith('_ENABLED')) return 'provider_flag';
  if (key.endsWith('_API_KEY')) return 'api_key';
  if (key.endsWith('_TOKEN')) return 'token';
  if (key.startsWith('BUDGET_') || key.startsWith('CACHE_') || key.endsWith('_RPM') || key.endsWith('_RPD') || key.endsWith('_RPMONTH')) return 'limit';
  return 'behavior';
}

function getFields(config: Config) {
  const shape = ConfigSchema.shape as Record<string, any>;
  const fields: Array<{ key: string; description: string; category: Category; value: unknown; isSet: boolean }> = [];

  for (const key of Object.keys(shape)) {
    const type = shape[key];
    const description = type.description ?? '';
    const value = config[key as keyof Config];
    fields.push({
      key,
      description,
      category: inferCategory(key),
      value,
      isSet: value !== undefined && value !== '' && value !== false && value !== 0,
    });
  }

  return fields;
}

export function getStartupSummary(config: Config): string[] {
  const fields = getFields(config);
  const lines: string[] = [];

  // Active providers
  const activeProviders = fields
    .filter(f => f.category === 'provider_flag' && f.value === true)
    .map(f => f.key.replace('_ENABLED', ''));
  if (activeProviders.length) {
    lines.push(`Providers: ${activeProviders.join(', ')}`);
  }

  // API keys status
  const setKeys = fields.filter(f => f.category === 'api_key' && f.isSet);
  const missingKeys = fields.filter(f => f.category === 'api_key' && !f.isSet && f.description);
  if (setKeys.length) {
    lines.push(`API keys set: ${setKeys.map(f => f.key).join(', ')}`);
  }
  if (missingKeys.length) {
    lines.push(`Set missing keys in environment block for premium: ${missingKeys.map(f => `${f.key} (${f.description})`).join(', ')}`);
  }

  // Tokens
  const setTokens = fields.filter(f => f.category === 'token' && f.isSet);
  const missingTokens = fields.filter(f => f.category === 'token' && !f.isSet);
  if (setTokens.length) {
    lines.push(`Tokens set: ${setTokens.map(f => f.key).join(', ')}`);
  }
  if (missingTokens.length) {
    lines.push(`Tokens optional — add if needed: ${missingTokens.map(f => `${f.key} (${f.description})`).join(', ')}`);
  }

  // Features
  const activeFeatures = fields.filter(f => f.category === 'feature' && f.value === true);
  if (activeFeatures.length) {
    lines.push(`Features: ${activeFeatures.map(f => `${f.key} (${f.description})`).join(', ')}`);
  }

  return lines;
}

export function getUnsetApiKeys(config: Config): Array<{ key: string; description: string }> {
  const shape = ConfigSchema.shape as Record<string, any>;
  const result: Array<{ key: string; description: string }> = [];

  for (const key of Object.keys(shape)) {
    if (inferCategory(key) !== 'api_key') continue;
    const value = config[key as keyof Config];
    if (!value) {
      const type = shape[key];
      result.push({ key, description: type.description ?? '' });
    }
  }

  return result;
}
