import { describe, it, expect } from 'vitest';
import { SearchRequestSchema, ConfigSchema } from '../../src/utils/types.js';

describe('SearchRequestSchema', () => {
  it('should validate a valid basic request', () => {
    const data = { query: 'react tutorial' };
    const result = SearchRequestSchema.parse(data);
    
    expect(result.query).toBe('react tutorial');
    expect(result.intent).toBe('web'); // default
    expect(result.freshness).toBe('any'); // default
    expect(result.include_content).toBe(false); // default
  });

  it('should validate a full request', () => {
    const data = {
      query: 'github api docs',
      intent: 'docs',
      freshness: 'month',
      include_content: true,
    };
    const result = SearchRequestSchema.parse(data);
    
    expect(result).toEqual(data);
  });

  it('should throw on empty query', () => {
    expect(() => SearchRequestSchema.parse({ query: '' })).toThrow();
  });


});

describe('ConfigSchema', () => {
  it('should validate with defaults', () => {
    const result = ConfigSchema.parse({});
    
    expect(result.LOG_LEVEL).toBe('info');
    expect(result.DATA_DIR).toBe('./data');
    expect(result.DDG_ENABLED).toBe(true);
    expect(result.BUDGET_MAX_SEARCHES).toBe(15);
  });

  it('should parse strings into numbers and booleans correctly', () => {
    const data = {
      DDG_ENABLED: 'false',
      BUDGET_MAX_SEARCHES: '20',
    };
    
    const result = ConfigSchema.parse(data);
    expect(result.DDG_ENABLED).toBe(false);
    expect(result.BUDGET_MAX_SEARCHES).toBe(20);
  });

  it('should have correct default for PROVIDER_ORDER', () => {
    const result = ConfigSchema.parse({});
    expect(result.PROVIDER_ORDER).toBe('ddg,bing,brave,tavily,exa,firecrawl');
  });

  it('should have correct default for PROVIDER_EXECUTION_MODE', () => {
    const result = ConfigSchema.parse({});
    expect(result.PROVIDER_EXECUTION_MODE).toBe('parallel');
  });

  it('should accept sequential execution mode', () => {
    const result = ConfigSchema.parse({ PROVIDER_EXECUTION_MODE: 'sequential' });
    expect(result.PROVIDER_EXECUTION_MODE).toBe('sequential');
  });

  it('should have correct default for MAX_PARALLEL_PROVIDERS', () => {
    const result = ConfigSchema.parse({});
    expect(result.MAX_PARALLEL_PROVIDERS).toBe(2);
  });

  it('should have correct defaults for DDG pagination', () => {
    const result = ConfigSchema.parse({});
    expect(result.DDG_RESULTS_PER_PAGE).toBe(10);
    expect(result.DDG_MAX_PAGES).toBe(2);
  });

  it('should have correct defaults for SEARCH_TIMEOUT_MS and MAX_RESULTS_AFTER_RERANK', () => {
    const result = ConfigSchema.parse({});
    expect(result.SEARCH_TIMEOUT_MS).toBe(15000);
    expect(result.MAX_RESULTS_AFTER_RERANK).toBe(10);
  });

  it('should have correct default for CACHE_TTL_MINUTES', () => {
    const result = ConfigSchema.parse({});
    expect(result.CACHE_TTL_MINUTES).toBe(1440);
  });

  it('should have correct defaults for DDG and BING pagination', () => {
    const result = ConfigSchema.parse({});
    expect(result.DDG_RESULTS_PER_PAGE).toBe(10);
    expect(result.DDG_MAX_PAGES).toBe(2);
    expect(result.BING_RESULTS_PER_PAGE).toBe(10);
  });

  it('should parse PROVIDER_EXECUTION_MODE from string', () => {
    expect(() => ConfigSchema.parse({ PROVIDER_EXECUTION_MODE: 'invalid' })).toThrow();
  });

  it('should parse PROVIDER_ORDER as string', () => {
    const result = ConfigSchema.parse({ PROVIDER_ORDER: 'brave,ddg' });
    expect(result.PROVIDER_ORDER).toBe('brave,ddg');
  });

  it('should parse MAX_PARALLEL_PROVIDERS from string', () => {
    const result = ConfigSchema.parse({ MAX_PARALLEL_PROVIDERS: '3' });
    expect(result.MAX_PARALLEL_PROVIDERS).toBe(3);
  });
});
