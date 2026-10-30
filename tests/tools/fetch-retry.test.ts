import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRateLimitRetry, isRateLimited, retryDelayMs } from '../../src/tools/fetch-retry.js';

function resp(status: number, headers: Record<string, string> = {}, body = 'x'): Response {
  return new Response(body, { status, headers });
}

describe('isRateLimited', () => {
  it('retries 429 and GitHub 403 with zero remaining quota', () => {
    expect(isRateLimited(429, new Headers())).toBe(true);
    expect(isRateLimited(403, new Headers({ 'X-RateLimit-Remaining': '0' }))).toBe(true);
  });

  it('does not retry other statuses', () => {
    expect(isRateLimited(403, new Headers({ 'X-RateLimit-Remaining': '5' }))).toBe(false);
    expect(isRateLimited(403, new Headers())).toBe(false);
    expect(isRateLimited(500, new Headers())).toBe(false);
    expect(isRateLimited(200, new Headers())).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially and honors Retry-After with a cap', () => {
    expect(retryDelayMs(1, null)).toBe(1000);
    expect(retryDelayMs(2, null)).toBe(2000);
    expect(retryDelayMs(3, null)).toBe(4000);
    expect(retryDelayMs(4, null)).toBe(5000);
    expect(retryDelayMs(1, '0')).toBe(0);
    expect(retryDelayMs(1, '60')).toBe(5000);
    expect(retryDelayMs(1, 'soon')).toBe(1000);
  });
});

describe('fetchWithRateLimitRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries once after 429 and returns the final response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(429, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(resp(200, {}, '{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRateLimitRetry('http://x/', {}, 'test');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries GitHub 403 with zero remaining quota', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(403, { 'X-RateLimit-Remaining': '0', 'Retry-After': '0' }))
      .mockResolvedValueOnce(resp(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRateLimitRetry('http://x/', {}, 'test');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns non-rate-limit responses immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(resp(500));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRateLimitRetry('http://x/', {}, 'test');
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after max attempts and returns the last response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(429, { 'Retry-After': '0' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRateLimitRetry('http://x/', {}, 'test');
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
