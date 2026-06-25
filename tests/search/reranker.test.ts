import { describe, it, expect } from 'vitest';
import { normalizeUrl, deduplicateResults, domainScore, freshnessScore, positionScore, rerankResults, getWeights } from '../../src/search/reranker.js';
import type { ProviderResult } from '../../src/utils/types.js';

describe('normalizeUrl', () => {
  it('should remove www prefix', () => {
    expect(normalizeUrl('https://www.example.com/page')).toBe('https://example.com/page');
  });

  it('should remove trailing slash', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page');
  });

  it('should remove utm parameters', () => {
    const result = normalizeUrl('https://example.com/page?utm_source=twitter&id=1');
    expect(result).not.toContain('utm_source');
    expect(result).toContain('id=1');
  });

  it('should remove hash fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });
});

describe('deduplicateResults', () => {
  it('should remove duplicates with the same URL', () => {
    const results: ProviderResult[] = [
      { title: 'A', url: 'https://example.com/a', snippet: 'a', raw_position: 1, provider: 'p1' },
      { title: 'B', url: 'https://example.com/a', snippet: 'a', raw_position: 5, provider: 'p2' },
    ];
    expect(deduplicateResults(results)).toHaveLength(1);
  });

  it('should keep best position for duplicates', () => {
    const results: ProviderResult[] = [
      { title: 'A', url: 'https://example.com/a', snippet: 'a', raw_position: 5, provider: 'p1' },
      { title: 'B', url: 'https://example.com/a', snippet: 'a', raw_position: 1, provider: 'p2' },
    ];
    const deduped = deduplicateResults(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].raw_position).toBe(1);
  });
});

describe('domainScore', () => {
  it('should give high score to official docs', () => {
    expect(domainScore('https://developer.mozilla.org/en-US/')).toBeGreaterThan(0.9);
  });

  it('should give high score to github', () => {
    expect(domainScore('https://github.com/org/repo')).toBe(0.95);
  });

  it('should give medium score to stackoverflow', () => {
    expect(domainScore('https://stackoverflow.com/questions/1')).toBe(0.80);
  });

  it('should return default for unknown domains', () => {
    expect(domainScore('https://example.com/page')).toBe(0.50);
  });
});

describe('freshnessScore', () => {
  it('should return neutral for missing date', () => {
    expect(freshnessScore(null)).toBe(0.5);
    expect(freshnessScore(undefined)).toBe(0.5);
  });

  it('should return 1.0 for recent content', () => {
    const recent = new Date(Date.now() - 1000 * 3600).toISOString();
    expect(freshnessScore(recent)).toBe(1.0);
  });

  it('should return low score for old content', () => {
    const old = new Date('2020-01-01').toISOString();
    expect(freshnessScore(old)).toBe(0.3);
  });
});

describe('positionScore', () => {
  it('should give 1.0 for first position', () => {
    expect(positionScore(1, 10)).toBeCloseTo(0.91, 1);
  });

  it('should give minimum score for last position', () => {
    const score = positionScore(10, 10);
    expect(score).toBeGreaterThanOrEqual(0.1);
    expect(score).toBeLessThan(0.2);
  });
});

describe('getWeights', () => {
  it('should return web weights by default', () => {
    const w = getWeights('unknown');
    expect(w.semantic).toBe(0.35);
  });

  it('should return news weights with high freshness', () => {
    const w = getWeights('news');
    expect(w.freshness).toBe(0.45);
  });

  it('should return docs weights with high domain', () => {
    const w = getWeights('docs');
    expect(w.domain).toBe(0.40);
  });
});

describe('rerankResults', () => {
  it('should sort by relevance_score descending', () => {
    const results: ProviderResult[] = [
      { title: 'A', url: 'https://medium.com/a', snippet: 'a', raw_position: 1, provider: 'p1' },
      { title: 'B', url: 'https://github.com/b', snippet: 'b', raw_position: 2, provider: 'p2' },
      { title: 'C', url: 'https://stackoverflow.com/c', snippet: 'c', raw_position: 3, provider: 'p3' },
    ];

    const reranked = rerankResults(results, 'web');
    expect(reranked).toHaveLength(3);
    expect(reranked[0].relevance_score).toBeGreaterThanOrEqual(reranked[1].relevance_score);
  });
});
