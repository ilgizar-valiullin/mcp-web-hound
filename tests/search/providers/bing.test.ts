import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { BingProvider } from '../../../src/search/providers/bing.js';
import { ProviderOptions } from '../../../src/utils/types.js';

beforeAll(() => {
  process.env.TZ = 'UTC';
});

vi.mock('../../../src/utils/config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    BING_ENABLED: true,
    DATA_DIR: './data',
    DB_FILENAME: 'search.db',
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

  describe('parseResults (private, tested via HTML fixture)', () => {
    const sampleHtml = `<ol id="b_results">
      <li class="b_algo"><h2><a href="https://bing.com/redir">React Hooks</a></h2><cite>https://react.dev</cite><div class="b_caption"><p>Hooks let you use React features</p></div></li>
      <li class="b_algo"><h2><a href="https://bing.com/redir">GeeksforGeeks</a></h2><cite>https://geeksforgeeks.org</cite><div class="b_caption"><p><span>May 2, 2026</span>&nbsp;&#0183;&#32;Performance Hooks in React</p></div></li>
      <li class="b_algo"><h2><a href="https://bing.com/redir">Old Article</a></h2><cite>https://example.com</cite><div class="b_caption"><p><span>Jan 15, 2024</span>&nbsp;&#0183;&#32;Legacy React patterns</p></div></li>
    </ol>`;

    it('should extract published_date from date spans', () => {
      const results = (provider as any).parseResults(sampleHtml, 10);
      expect(results).toHaveLength(3);

      // No date → undefined
      expect(results[0].published_date).toBeUndefined();

      // Has date → ISO string
      expect(results[1].published_date).toBe('2026-05-02T00:00:00.000Z');
      expect(results[2].published_date).toBe('2024-01-15T00:00:00.000Z');
    });

    it('should strip date prefix from snippet', () => {
      const results = (provider as any).parseResults(sampleHtml, 10);
      // Date should be removed from snippet
      expect(results[1].snippet).not.toContain('May 2, 2026');
      expect(results[1].snippet).toBe('Performance Hooks in React');
    });

    it('should keep snippet intact when no date present', () => {
      const results = (provider as any).parseResults(sampleHtml, 10);
      expect(results[0].snippet).toBe('Hooks let you use React features');
    });
  });
});
