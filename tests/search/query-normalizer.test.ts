import { describe, it, expect } from 'vitest';
import { normalizeQuery, generateCacheKey, processQuery } from '../../src/search/query-normalizer.js';

describe('normalizeQuery', () => {
  it('should lowercase and trim', () => {
    expect(normalizeQuery('  React Hooks  ')).toBe('react hooks');
  });

  it('should collapse multiple spaces', () => {
    expect(normalizeQuery('react   hooks   tutorial')).toBe('react hooks tutorial');
  });

  it('should remove non-word special characters', () => {
    expect(normalizeQuery('react + hooks = awesome!')).toBe('react  hooks = awesome');
  });

  it('should keep URL-safe characters', () => {
    expect(normalizeQuery('https://react.dev/docs/getting-started?lang=en')).toBe('https://react.dev/docs/getting-started?lang=en');
  });

  it('should handle empty string', () => {
    expect(normalizeQuery('')).toBe('');
  });
});

describe('generateCacheKey', () => {
  it('should generate consistent keys for same inputs', () => {
    const a = generateCacheKey('react hooks', 'web', 'any');
    const b = generateCacheKey('react hooks', 'web', 'any');
    expect(a).toBe(b);
  });

  it('should generate different keys for different intents', () => {
    const a = generateCacheKey('react hooks', 'web', 'any');
    const b = generateCacheKey('react hooks', 'docs', 'any');
    expect(a).not.toBe(b);
  });

  it('should generate different keys for different freshness', () => {
    const a = generateCacheKey('react hooks', 'web', 'day');
    const b = generateCacheKey('react hooks', 'web', 'week');
    expect(a).not.toBe(b);
  });
});

describe('processQuery', () => {
  it('should return normalized and cacheKey', () => {
    const result = processQuery('  React Hooks Guide  ', 'web', 'any');
    expect(result.normalized).toBe('react hooks guide');
    expect(result.cacheKey).toBeTruthy();
    expect(result.cacheKey.length).toBe(64);
  });

  it('should produce same cacheKey for similar queries', () => {
    const a = processQuery('react hooks', 'web', 'any');
    const b = processQuery('  React HOOKS  ', 'web', 'any');
    expect(a.cacheKey).toBe(b.cacheKey);
  });
});
