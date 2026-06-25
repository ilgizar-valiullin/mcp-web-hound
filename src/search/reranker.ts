import { config } from '../utils/config.js';
import type { ProviderResult } from '../utils/types.js';

const DOMAIN_SCORES: Record<string, number> = {
  'github.com': 0.95,
  'docs.github.com': 0.95,
  'developer.mozilla.org': 0.95,
  'tc39.es': 0.90,
  'readthedocs.io': 0.90,
  'docs.python.org': 0.90,
  'docs.rs': 0.90,
  'pkg.go.dev': 0.90,
  'nodejs.org': 0.85,
  'react.dev': 0.85,
  'nextjs.org': 0.85,
  'vuejs.org': 0.85,
  'angular.dev': 0.85,
  'svelte.dev': 0.85,
  'npmjs.com': 0.85,
  'pypi.org': 0.85,
  'crates.io': 0.85,
  'stackoverflow.com': 0.80,
  'dev.to': 0.70,
  'medium.com': 0.55,
  'wikipedia.org': 0.60,
  'w3schools.com': 0.50,
};

const DOMAIN_PATTERNS: Array<[RegExp, number]> = [
  [/^docs\./, 0.85],
  [/^developer\./, 0.85],
  [/^api\./, 0.80],
  [/\.readthedocs\.io$/, 0.90],
  [/\.github\.io$/, 0.75],
  [/^stackoverflow\.com$/, 0.80],
];

interface Weights {
  semantic: number;
  domain: number;
  freshness: number;
  position: number;
}

const INTENT_WEIGHTS: Record<string, Weights> = {
  web: { semantic: 0.35, domain: 0.25, freshness: 0.15, position: 0.25 },
  docs: { semantic: 0.30, domain: 0.40, freshness: 0.10, position: 0.20 },
  github: { semantic: 0.25, domain: 0.35, freshness: 0.20, position: 0.20 },
  news: { semantic: 0.20, domain: 0.15, freshness: 0.45, position: 0.20 },
};

export interface ScoredResult extends ProviderResult {
  relevance_score: number;
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.replace(/^www\./, '');
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'ref') {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function deduplicateResults(results: ProviderResult[]): ProviderResult[] {
  const seen = new Map<string, ProviderResult>();

  for (const result of results) {
    const normalizedUrl = normalizeUrl(result.url);

    const existing = seen.get(normalizedUrl);
    if (!existing) {
      seen.set(normalizedUrl, result);
    } else if (result.raw_position < existing.raw_position) {
      seen.set(normalizedUrl, result);
    }
  }

  return Array.from(seen.values());
}

export function domainScore(url: string): number {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    if (DOMAIN_SCORES[hostname]) {
      return DOMAIN_SCORES[hostname];
    }

    for (const [pattern, score] of DOMAIN_PATTERNS) {
      if (pattern.test(hostname)) {
        return score;
      }
    }

    if (hostname.split('.').length >= 3) {
      const parts = hostname.split('.');
      const parent = parts.slice(-2).join('.');
      if (DOMAIN_SCORES[parent]) {
        return DOMAIN_SCORES[parent] * 0.95;
      }
    }
  } catch {
    return 0.50;
  }

  return 0.50;
}

export function freshnessScore(publishedDate: string | null | undefined): number {
  if (!publishedDate) return 0.5;

  try {
    const ageHours = (Date.now() - new Date(publishedDate).getTime()) / 3_600_000;

    if (ageHours < 0) return 0.5;
    if (ageHours < 24) return 1.0;
    if (ageHours < 168) return 0.9;
    if (ageHours < 720) return 0.8;
    if (ageHours < 2_160) return 0.7;
    if (ageHours < 8_760) return 0.5;
    return 0.3;
  } catch {
    return 0.5;
  }
}

export function positionScore(position: number, totalResults: number): number {
  if (totalResults <= 0) return 0.5;
  return Math.max(0.1, 1.0 - (position / totalResults) * 0.9);
}

export function getWeights(intent: string): Weights {
  return INTENT_WEIGHTS[intent] ?? INTENT_WEIGHTS.web;
}

export function rerankResults(
  results: ProviderResult[],
  intent: string,
  queryEmbedding?: number[],
  embedFn?: (text: string) => number[],
): ScoredResult[] {
  if (!config.RERANK_ENABLED) {
    return results.map((r, i) => ({
      ...r,
      relevance_score: 1.0 - i * 0.01,
    }));
  }

  const deduplicated = deduplicateResults(results);
  const weights = getWeights(intent);
  const totalResults = deduplicated.length;

  const scored = deduplicated.map((result) => {
    const domain = domainScore(result.url);
    const freshness = freshnessScore(result.published_date);
    const position = positionScore(result.raw_position, totalResults);

    let semantic = 0.5;
    if (queryEmbedding && embedFn) {
      try {
        const textEmbedding = embedFn(result.snippet || result.title);
        semantic = cosineSimilarity(queryEmbedding, textEmbedding);
      } catch {
        semantic = 0.5;
      }
    }

    const score = weights.semantic * semantic
      + weights.domain * domain
      + weights.freshness * freshness
      + weights.position * position;

    return {
      ...result,
      relevance_score: Math.round(score * 1000) / 1000,
    };
  });

  scored.sort((a, b) => b.relevance_score - a.relevance_score);

  return scored;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return Math.max(0, dotProduct / magnitude);
}
