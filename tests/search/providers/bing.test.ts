import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BingProvider } from '../../../src/search/providers/bing.js';
import { ProviderOptions } from '../../../src/utils/types.js';

vi.mock('../../../src/utils/config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    BING_ENABLED: true,
    DATA_DIR: './data',
    DB_FILENAME: 'search.db',
    SEARXNG_URL: undefined,
    DDG_ENABLED: false,
    DDG_DELAY_MS: 100,
    DDG_MAX_PER_MINUTE: 10,
    BRAVE_API_KEY: undefined,
    BRAVE_DAILY_LIMIT: 60,
    TAVILY_API_KEY: undefined,
    TAVILY_DAILY_LIMIT: 30,
    EXA_API_KEY: undefined,
    FIRECRAWL_API_KEY: undefined,
    BUDGET_MAX_SEARCHES: 15,
    BUDGET_MAX_FETCHES: 30,
    BUDGET_WINDOW_MINUTES: 30,
    CACHE_MAX_SIZE_MB: 500,
    CACHE_EVICTION_INTERVAL_MIN: 30,
    SEMANTIC_ENABLED: false,
    EMBEDDING_MODEL: 'multilingual-e5-small',
    EMBEDDING_DIMENSION: 384,
    SEMANTIC_THRESHOLD: 0.92,
    FETCH_TIMEOUT_MS: 10000,
    FETCH_MAX_RETRIES: 2,
    FETCH_MAX_BODY_SIZE: 5242880,
    FETCH_CONCURRENT_LIMIT: 3,
    FETCH_USER_AGENT: 'SearchMCP/1.0',
    CONTENT_MAX_LENGTH: 8000,
    RERANK_ENABLED: true,
    RERANK_WEIGHT_SEMANTIC: 0.35,
    RERANK_WEIGHT_DOMAIN: 0.30,
    RERANK_WEIGHT_FRESHNESS: 0.15,
    RERANK_WEIGHT_POSITION: 0.20,
  },
}));

describe('BingProvider', () => {
  let provider: BingProvider;
  const dummyOptions: ProviderOptions = { intent: 'web', freshness: 'any', max_results: 10 };

  beforeEach(() => {
    provider = new BingProvider();
  });

  it('should start healthy', async () => {
    expect(await provider.healthCheck()).toBe(true);
  });

  it('should return correct initial stats', () => {
    const stats = provider.getStats();
    expect(stats.healthy).toBe(true);
    expect(stats.requests_today).toBe(0);
  });
});
