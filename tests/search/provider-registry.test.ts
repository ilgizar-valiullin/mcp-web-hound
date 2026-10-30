import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimitStore } from '../../src/limits/rate-limit-store.js';
import { ProviderRouter } from '../../src/search/provider-router.js';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const mockConfig = vi.hoisted(() => ({
  LOG_LEVEL: 'silent',
  PROVIDER_ORDER: 'startpage,ddg,brave_web,bing,brave_api,tavily,exa,firecrawl',
  MAX_PARALLEL_PROVIDERS: 2,
  PROVIDER_EXECUTION_MODE: 'parallel',
  DDG_ENABLED: true,
  DDG_DELAY_MS: 100,
  DDG_MAX_PER_MINUTE: 10,
  DDG_RESULTS_PER_PAGE: 10,
  DDG_MAX_PAGES: 1,
  BING_ENABLED: true,
  BING_RESULTS_PER_PAGE: 10,
  BING_MAX_PAGES: 1,
  STARTPAGE_ENABLED: true,
  BRAVE_WEB_ENABLED: true,
  BRAVE_API_KEY: 'test-key',
  TAVILY_API_KEY: 'test-key',
  EXA_API_KEY: 'test-key',
  FIRECRAWL_API_KEY: 'test-key',
}));

vi.mock('../../src/utils/config.js', () => ({
  config: mockConfig,
}));

const TEST_DIR = resolve(import.meta.dirname, '../../.test-tmp/router');
const TEST_LIMITS: Record<string, { rpm: number; rpd: number; rpmonth: number }> = {
  ddg: { rpm: 999, rpd: 999, rpmonth: 999 },
  brave_web: { rpm: 999, rpd: 999, rpmonth: 999 },
  brave_api: { rpm: 999, rpd: 999, rpmonth: 999 },
  bing: { rpm: 999, rpd: 999, rpmonth: 999 },
  startpage: { rpm: 999, rpd: 999, rpmonth: 999 },
  tavily: { rpm: 999, rpd: 999, rpmonth: 999 },
  exa: { rpm: 999, rpd: 999, rpmonth: 999 },
  firecrawl: { rpm: 999, rpd: 999, rpmonth: 999 },
};

function cleanup(): void {
  const p = resolve(TEST_DIR, 'rate-limits.json');
  const t = resolve(TEST_DIR, 'rate-limits.json.tmp');
  if (existsSync(p)) unlinkSync(p);
  if (existsSync(t)) unlinkSync(t);
}

describe('ProviderRouter registry', () => {
  beforeEach(() => {
    cleanup();
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    mockConfig.PROVIDER_ORDER = 'startpage,ddg,brave_web,bing,brave_api,tavily,exa,firecrawl';
    mockConfig.BRAVE_WEB_ENABLED = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('registers Brave Web for the default PROVIDER_ORDER', () => {
    const router = new ProviderRouter(new RateLimitStore(TEST_DIR, TEST_LIMITS));
    expect(router.getAvailableProviders()).toContain('Brave Web');
    expect(router.getProviderCount()).toBe(8);
  });

  it('skips Brave Web when BRAVE_WEB_ENABLED is false', () => {
    mockConfig.BRAVE_WEB_ENABLED = false;
    const router = new ProviderRouter(new RateLimitStore(TEST_DIR, TEST_LIMITS));
    expect(router.getAvailableProviders()).not.toContain('Brave Web');
    expect(router.getProviderCount()).toBe(7);
  });

  it('skips unknown provider names without dropping the rest', () => {
    mockConfig.PROVIDER_ORDER = 'brave_web,nope';
    const router = new ProviderRouter(new RateLimitStore(TEST_DIR, TEST_LIMITS));
    expect(router.getAvailableProviders()).toEqual(['Brave Web']);
  });
});
