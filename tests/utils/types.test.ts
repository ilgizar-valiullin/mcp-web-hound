import { describe, it, expect } from 'vitest';
import { SearchRequestSchema, ConfigSchema } from '../../src/utils/types.js';

describe('SearchRequestSchema', () => {
  it('should validate a valid basic request', () => {
    const data = { query: 'react tutorial' };
    const result = SearchRequestSchema.parse(data);
    
    expect(result.query).toBe('react tutorial');
    expect(result.intent).toBe('web'); // default
    expect(result.freshness).toBe('any'); // default
    expect(result.max_results).toBe(10); // default
    expect(result.include_content).toBe(false); // default
  });

  it('should validate a full request', () => {
    const data = {
      query: 'github api docs',
      intent: 'docs',
      freshness: 'month',
      max_results: 20,
      include_content: true,
    };
    const result = SearchRequestSchema.parse(data);
    
    expect(result).toEqual(data);
  });

  it('should throw on empty query', () => {
    expect(() => SearchRequestSchema.parse({ query: '' })).toThrow();
  });

  it('should throw on invalid max_results', () => {
    expect(() => SearchRequestSchema.parse({ query: 'test', max_results: 0 })).toThrow();
    expect(() => SearchRequestSchema.parse({ query: 'test', max_results: 31 })).toThrow();
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
});
