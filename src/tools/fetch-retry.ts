import { logger } from '../utils/logger.js';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5000;

/** Truncated exponential backoff honoring Retry-After (capped). attempt is 1-based. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter !== null) {
    const secs = Number(retryAfter.trim());
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.min(Math.floor(secs * 1000), MAX_DELAY_MS);
    }
  }
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}

export function isRateLimited(status: number, headers: Headers): boolean {
  if (status === 429) return true;
  // GitHub signals primary/secondary rate limits with 403 + zero remaining quota.
  if (status === 403 && headers.get('X-RateLimit-Remaining') === '0') return true;
  return false;
}

/**
 * fetch() with retries on HTTP 429 / rate-limit 403.
 * Network errors and timeouts throw immediately (same as before).
 * Returns the final response — callers keep their existing !response.ok handling.
 */
export async function fetchWithRateLimitRetry(url: string, init: RequestInit, label: string): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, init);
    if (!isRateLimited(response.status, response.headers) || attempt === MAX_ATTEMPTS) {
      return response;
    }
    const delayMs = retryDelayMs(attempt, response.headers.get('Retry-After'));
    logger.warn({ label, status: response.status, attempt, delayMs }, 'Rate limited, retrying');
    try {
      await response.arrayBuffer();
    } catch {
      // Best-effort body drain to free the socket; ignore errors.
    }
    await new Promise<void>((r) => setTimeout(r, delayMs));
  }
  throw new Error(`${label}: retry loop exhausted`);
}
