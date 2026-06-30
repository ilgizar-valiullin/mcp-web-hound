import { createRequire } from 'node:module';
import { config } from '../utils/config.js';
import type { ProviderResult } from '../utils/types.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export const MCP_VERSION = pkg.version;
export const RERANKER_VERSION = 'v1';
export const SIGNALS_VERSION = 'v1';

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

const NLI_WEIGHT = 0.9;
const DOMAIN_WEIGHT = 0.04;
const FRESHNESS_WEIGHT = 0.03;
const POSITION_WEIGHT = 0.03;

export interface ScoredResult extends ProviderResult {
  relevance_score: number;
  nli_score: number;
  domain_score: number;
  freshness_score: number;
  position_score: number;
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

export function positionScore(position: number, totalResults: number): number {
  if (totalResults <= 0) return 0.5;
  return Math.max(0.1, 1.0 - (position / totalResults) * 0.9);
}

export function calculateImplicitFreshness(publishedDate: string | null | undefined, requiresFreshness: boolean): number {
  if (!publishedDate) return 1.0;

  try {
    const pubDate = new Date(publishedDate);
    const now = new Date();
    const diffYears = (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

    if (diffYears < 0) return 1.0;

    if (requiresFreshness) {
      if (diffYears <= 0.08) return 1.0;
      if (diffYears <= 1.0) return 0.4;
      return 0.0;
    }

    if (diffYears <= 3.0) return 1.0;
    if (diffYears <= 5.0) return 0.6;
    return 0.1;
  } catch {
    return 1.0;
  }
}

export function rerankResults(
  results: ProviderResult[],
  requiresFreshness?: boolean,
  nliScores?: number[],
  skipDedup?: boolean,
): ScoredResult[] {
  if (!config.RERANK_ENABLED) {
    return results.map((r, i) => ({
      ...r,
      relevance_score: 1.0 - i * 0.01,
      nli_score: 0.5,
      domain_score: 0.5,
      freshness_score: 1.0,
      position_score: 0.5,
    }));
  }

  const working = skipDedup ? results : deduplicateResults(results);
  const totalResults = working.length;

  const scored = working.map((result, i) => {
    const domain = domainScore(result.url);
    const position = positionScore(result.raw_position, totalResults);
    const nli = nliScores?.[i] ?? 0.5;
    const freshness = calculateImplicitFreshness(result.published_date, requiresFreshness ?? false);

    const score = NLI_WEIGHT * nli
      + DOMAIN_WEIGHT * domain
      + FRESHNESS_WEIGHT * freshness
      + POSITION_WEIGHT * position;

    return {
      ...result,
      relevance_score: Math.round(score * 1000) / 1000,
      nli_score: nli,
      domain_score: domain,
      freshness_score: freshness,
      position_score: position,
    };
  });

  scored.sort((a, b) => b.relevance_score - a.relevance_score);

  return scored;
}
