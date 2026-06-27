import { describe, it, expect, vi } from 'vitest';
import { config } from '../../src/utils/config.js';
import { DuckDuckGoProvider } from '../../src/search/providers/duckduckgo.js';
import { BingProvider } from '../../src/search/providers/bing.js';
import { BraveProvider } from '../../src/search/providers/brave.js';
import { BraveWebProvider } from '../../src/search/providers/brave-web.js';
import { TavilyProvider } from '../../src/search/providers/tavily.js';
import { ExaProvider } from '../../src/search/providers/exa.js';
import { FirecrawlProvider } from '../../src/search/providers/firecrawl.js';
import { StartpageProvider } from '../../src/search/providers/startpage.js';
import type { ProviderResult } from '../../src/utils/types.js';

const integration = process.env.RUN_INTEGRATION_TESTS ? describe : describe.skip;
const DATE_QUERY = '2026 web development trends';
const OPTIONS = { intent: 'web' as const, freshness: 'any' as const, max_results: 10 };
const TIMEOUT = 30000;

function validateResultShape(r: ProviderResult): void {
  expect(typeof r.title).toBe('string');
  expect(typeof r.url).toBe('string');
  expect(typeof r.snippet).toBe('string');
  expect(typeof r.raw_position).toBe('number');
  expect(typeof r.provider).toBe('string');
  expect(r.raw_position).toBeGreaterThanOrEqual(1);
}

function validateDateIfPresent(r: ProviderResult): boolean {
  if (!r.published_date) return false;
  const d = r.published_date;
  if (typeof d !== 'string') return false;
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return false;
  if (parsed.getFullYear() < 2020) return false;
  return true;
}

function testProvider(name: string, factory: () => DuckDuckGoProvider | BingProvider | BraveProvider | BraveWebProvider | StartpageProvider | TavilyProvider | ExaProvider | FirecrawlProvider): void {
  describe(name, () => {
    it('should return results with valid shape and log dates', { timeout: TIMEOUT }, async () => {
      const p = factory();
      const healthy = await p.healthCheck();
      expect(healthy).toBe(true);

      let results: ProviderResult[];
      try {
        results = await p.search(DATE_QUERY, OPTIONS);
      } catch (err) {
        throw new Error(`${p.name} threw during search: ${err instanceof Error ? err.message : String(err)}`);
      }

      expect(results.length).toBeGreaterThan(0);
      const datedCount = results.filter((r) => r.published_date).length;
      console.log(`  ${p.name}: ${datedCount}/${results.length} results with dates`);
      for (const r of results) {
        validateResultShape(r);
        validateDateIfPresent(r);
      }
    });
  });
}

describe.concurrent('Provider Integration Tests', () => {
  integration('DuckDuckGo (live)', () => {
    (config.DDG_ENABLED ? describe : describe.skip)('results', () => {
      testProvider('results', () => new DuckDuckGoProvider());
    });
  });
  integration('Bing (live)', () => {
    (config.BING_ENABLED ? describe : describe.skip)('results', () => {
      testProvider('results', () => new BingProvider());
    });
  });
  integration('Brave Web (live)', () => {
    (config.BRAVE_WEB_ENABLED ? describe : describe.skip)('results', () => {
      testProvider('results', () => new BraveWebProvider());
    });
  });
  integration('Brave API (live)', () => {
    (config.BRAVE_API_KEY ? describe : describe.skip)('results', () => {
      testProvider('results', () => new BraveProvider());
    });
  });
  integration('Tavily (live)', () => {
    (config.TAVILY_API_KEY ? describe : describe.skip)('results', () => {
      testProvider('results', () => new TavilyProvider());
    });
  });
  integration('Exa (live)', () => {
    (config.EXA_API_KEY ? describe : describe.skip)('results', () => {
      testProvider('results', () => new ExaProvider());
    });
  });
  integration('Firecrawl (live)', () => {
    (config.FIRECRAWL_API_KEY ? describe : describe.skip)('results', () => {
      testProvider('results', () => new FirecrawlProvider());
    });
  });
  integration('Startpage (live)', () => {
    (config.STARTPAGE_ENABLED ? describe : describe.skip)('results', () => {
      testProvider('results', () => new StartpageProvider());
    });
  });
});
