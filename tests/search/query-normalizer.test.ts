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

  it('should preserve Cyrillic queries', () => {
    expect(normalizeQuery('рецепты бразильских бургеров разные котлетки ингредиенты')).toBe(
      'рецепты бразильских бургеров разные котлетки ингредиенты',
    );
  });

  it('should preserve CJK and Arabic scripts', () => {
    expect(normalizeQuery('北京烤鸭食谱')).toBe('北京烤鸭食谱');
    expect(normalizeQuery('日本語 テスト')).toBe('日本語 テスト');
    expect(normalizeQuery('مرحبا بالعالم')).toBe('مرحبا بالعالم');
  });

  it('should preserve mixed Latin and Cyrillic with numbers', () => {
    expect(normalizeQuery('hello мир 123')).toBe('hello мир 123');
  });
});

describe('generateCacheKey', () => {
  it('should generate consistent keys for same inputs', () => {
    const a = generateCacheKey('react hooks', 'web');
    const b = generateCacheKey('react hooks', 'web');
    expect(a).toBe(b);
  });

  it('should generate different keys for different intents', () => {
    const a = generateCacheKey('react hooks', 'web');
    const b = generateCacheKey('react hooks', 'docs');
    expect(a).not.toBe(b);
  });
});

describe('processQuery', () => {
  it('should return normalized and cacheKey', () => {
    const result = processQuery('  React Hooks Guide  ', 'web');
    expect(result.normalized).toBe('react hooks guide');
    expect(result.cacheKey).toBeTruthy();
    expect(result.cacheKey.length).toBe(64);
  });

  it('should produce same cacheKey for similar queries', () => {
    const a = processQuery('react hooks', 'web');
    const b = processQuery('  React HOOKS  ', 'web');
    expect(a.cacheKey).toBe(b.cacheKey);
  });
});
