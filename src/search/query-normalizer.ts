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
    .replace(/[^\p{L}\p{N}\s\-./:?=&_]/gu, '')
    .trim();
}

export function generateCacheKey(normalized: string, intent: string): string {
  const hash = createHash('sha256')
    .update(`${normalized}|${intent}`)
    .digest('hex');
  return hash;
}

export function processQuery(raw: string, intent: string): NormalizedQuery {
  const normalized = normalizeQuery(raw);
  const cacheKey = generateCacheKey(normalized, intent);
  return { normalized, cacheKey };
}
