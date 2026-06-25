import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TavilyProvider } from '../../../src/search/providers/tavily.js';

vi.mock('../../../src/utils/config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    TAVILY_API_KEY: 'tvly-test-key',
    TAVILY_DAILY_LIMIT: 30,
    DATA_DIR: './data',
    DB_FILENAME: 'search.db',
    DDG_ENABLED: false,
    DDG_DELAY_MS: 100,
    DDG_MAX_PER_MINUTE: 10,
    BING_ENABLED: false,
    SEARXNG_URL: undefined,
    BRAVE_API_KEY: undefined,
    BRAVE_DAILY_LIMIT: 60,
    EXA_API_KEY: undefined,
    FIRECRAWL_API_KEY: undefined,
    BUDGET_MAX_SEARCHES: 15,
    BUDGET_MAX_FETCHES: 30,
    BUDGET_WINDOW_MINUTES: 30,
    CACHE_MAX_SIZE_MB: 500,
    CACHE_EVICTION_INTERVAL_MIN: 30,
    FETCH_USER_AGENT: 'test',
    FETCH_TIMEOUT_MS: 5000,
    FETCH_MAX_RETRIES: 1,
    FETCH_MAX_BODY_SIZE: 1000,
    FETCH_CONCURRENT_LIMIT: 3,
    CONTENT_MAX_LENGTH: 8000,
    RERANK_ENABLED: false,
    RERANK_WEIGHT_SEMANTIC: 0.35,
    RERANK_WEIGHT_DOMAIN: 0.25,
    RERANK_WEIGHT_FRESHNESS: 0.15,
    RERANK_WEIGHT_POSITION: 0.25,
    SEMANTIC_ENABLED: false,
    EMBEDDING_MODEL: 'test',
    EMBEDDING_DIMENSION: 384,
    SEMANTIC_THRESHOLD: 0.92,
    GITHUB_TOKEN: undefined,
    GITLAB_TOKEN: undefined,
  },
}));

describe('TavilyProvider', () => {
  let provider: TavilyProvider;
  const sampleResponse = {
    results: [
      {
        title: 'Rust Programming Language',
        url: 'https://www.rust-lang.org/',
        content: 'Learn Rust programming language.',
      },
      {
        title: 'Rust by Example',
        url: 'https://doc.rust-lang.org/stable/rust-by-example/',
        content: 'Collection of runnable examples.',
      },
    ],
  };

  beforeEach(() => {
    provider = new TavilyProvider();
    global.fetch = vi.fn();
  });

  it('should return results on successful API call', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(sampleResponse),
    } as Response);

    const results = await provider.search('rust programming', {
      intent: 'web',
      freshness: 'any',
      max_results: 5,
    });

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Rust Programming Language');
    expect(results[0].url).toBe('https://www.rust-lang.org/');
    expect(results[0].provider).toBe('tavily');
  });

  it('should throw on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(
      provider.search('test', { intent: 'web', freshness: 'any', max_results: 5 }),
    ).rejects.toThrow(/Tavily.*401/i);
  });

  it('should return empty when no results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    } as Response);

    const results = await provider.search('test', {
      intent: 'web',
      freshness: 'any',
      max_results: 5,
    });

    expect(results).toEqual([]);
  });

  it('should enforce max_results limit', async () => {
    const manyResults = {
      results: Array.from({ length: 10 }, (_, i) => ({
        title: `Result ${i + 1}`,
        url: `https://example.com/${i}`,
        content: `Content ${i + 1}`,
      })),
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(manyResults),
    } as Response);

    const results = await provider.search('test', {
      intent: 'web',
      freshness: 'any',
      max_results: 3,
    });

    expect(results).toHaveLength(3);
  });

  it('should handle rate limit error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    } as Response);

    await expect(
      provider.search('test', { intent: 'web', freshness: 'any', max_results: 5 }),
    ).rejects.toThrow(/Tavily/i);
  });

  it('should track provider stats', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(sampleResponse),
    } as Response);

    await provider.search('test', { intent: 'web', freshness: 'any', max_results: 5 });

    const stats = provider.getStats();
    expect(stats.requests_today).toBe(1);
    expect(stats.healthy).toBe(true);
    expect(stats.avg_latency_ms).toBeGreaterThanOrEqual(0);
  });
});
