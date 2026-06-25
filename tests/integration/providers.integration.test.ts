import { describe, it, expect } from 'vitest';
import { config } from '../../src/utils/config.js';
import { DuckDuckGoProvider } from '../../src/search/providers/duckduckgo.js';
import { BingProvider } from '../../src/search/providers/bing.js';
import { BraveProvider } from '../../src/search/providers/brave.js';
import { TavilyProvider } from '../../src/search/providers/tavily.js';
import { ExaProvider } from '../../src/search/providers/exa.js';
import { FirecrawlProvider } from '../../src/search/providers/firecrawl.js';
import { SearxngProvider } from '../../src/search/providers/searxng.js';

const QUERY = 'rust programming language';
const OPTIONS = { intent: 'web' as const, freshness: 'any' as const, max_results: 3 };
const TIMEOUT = 20000;

describe.concurrent('Provider Integration Tests', () => {
  const ddg = () => new DuckDuckGoProvider();
  const bing = () => new BingProvider();

  (config.DDG_ENABLED ? describe : describe.skip)('DuckDuckGo (live)', () => {
    it('should return results from live API', { timeout: TIMEOUT }, async () => {
      const provider = ddg();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
      const results = await provider.search(QUERY, OPTIONS);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('title');
      expect(results[0]).toHaveProperty('url');
    });
  });

  (config.BING_ENABLED ? describe : describe.skip)('Bing (live)', () => {
    it('should return results from live API', { timeout: TIMEOUT }, async () => {
      const provider = bing();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
      const results = await provider.search(QUERY, OPTIONS);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('title');
    });
  });

  (config.BRAVE_API_KEY ? describe : describe.skip)('Brave (live)', () => {
    it('should return results from live API', { timeout: TIMEOUT }, async () => {
      const provider = new BraveProvider();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
      const results = await provider.search(QUERY, OPTIONS);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  (config.TAVILY_API_KEY ? describe : describe.skip)('Tavily (live)', () => {
    it('should return results from live API', { timeout: TIMEOUT }, async () => {
      const provider = new TavilyProvider();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
      const results = await provider.search(QUERY, OPTIONS);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  (config.EXA_API_KEY ? describe : describe.skip)('Exa (live)', () => {
    it('should return results from live API', { timeout: TIMEOUT }, async () => {
      const provider = new ExaProvider();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
      const results = await provider.search(QUERY, OPTIONS);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  (config.FIRECRAWL_API_KEY ? describe : describe.skip)('Firecrawl (live)', () => {
    it('should return results from live API', { timeout: TIMEOUT }, async () => {
      const provider = new FirecrawlProvider();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
      const results = await provider.search(QUERY, OPTIONS);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  (config.SEARXNG_URL && config.SEARXNG_ENABLED ? describe : describe.skip)('SearXNG (live)', () => {
    it('should return results from live API', { timeout: TIMEOUT }, async () => {
      const provider = new SearxngProvider();
      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
      const results = await provider.search(QUERY, OPTIONS);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
