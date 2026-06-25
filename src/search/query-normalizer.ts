import { createHash } from 'node:crypto';

export interface NormalizedQuery {
  normalized: string;
  cacheKey: string;
}

export function normalizeQuery(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s\-./:?=&]/g, '')
    .trim();
}

export function generateCacheKey(normalized: string, intent: string, freshness: string): string {
  const hash = createHash('sha256')
    .update(`${normalized}|${intent}|${freshness}`)
    .digest('hex');
  return hash;
}

export function processQuery(raw: string, intent: string, freshness: string): NormalizedQuery {
  const normalized = normalizeQuery(raw);
  const cacheKey = generateCacheKey(normalized, intent, freshness);
  return { normalized, cacheKey };
}
