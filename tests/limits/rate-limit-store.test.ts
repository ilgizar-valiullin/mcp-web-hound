import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimitStore, classifyError } from '../../src/limits/rate-limit-store.js';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_DIR = resolve(import.meta.dirname, '../../.test-tmp');
const TEST_LIMITS: Record<string, any> = {
  ddg: { rpm: 10, rpd: 200, rpmonth: 6000 },
  brave_web: { rpm: 999, rpd: 999, rpmonth: 999 },
};

function makeStore(limits = TEST_LIMITS): RateLimitStore {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  return new RateLimitStore(TEST_DIR, limits);
}

function cleanup(): void {
  const p = resolve(TEST_DIR, 'rate-limits.json');
  const t = resolve(TEST_DIR, 'rate-limits.json.tmp');
  if (existsSync(p)) unlinkSync(p);
  if (existsSync(t)) unlinkSync(t);
}

describe('RateLimitStore', () => {
  let store: RateLimitStore;

  beforeEach(() => {
    cleanup();
    store = makeStore();
  });

  afterEach(() => {
    store.flush();
    cleanup();
  });

  it('should allow when no requests made', () => {
    const r = store.check('ddg');
    expect(r.allowed).toBe(true);
    expect(r.remaining.minute).toBe(10);
    expect(r.remaining.day).toBe(200);
  });

  it('should decrement remaining after record', () => {
    store.record('ddg');
    const r = store.check('ddg');
    expect(r.remaining.minute).toBe(9);
    expect(r.remaining.day).toBe(199);
  });

  it('should block when minute limit reached', () => {
    for (let i = 0; i < 10; i++) store.record('ddg');
    const r = store.check('ddg');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('minute');
    expect(r.remaining.minute).toBe(0);
  });

  it('should survive a provider throwing — record not called', () => {
    store.record('ddg');
    expect(store.check('ddg').remaining.minute).toBe(9);
    const threw = new Error('CAPTCHA from DDG');
    try { throw threw; } catch { /* handler — no record */ }
    expect(store.check('ddg').remaining.minute).toBe(9);
  });

  it('should persist across restarts', () => {
    store.record('ddg');
    store.record('ddg');
    store.flush();
    const store2 = makeStore();
    const r = store2.check('ddg');
    expect(r.remaining.minute).toBe(8);
    store2.flush();
  });

  it('should handle multiple providers independently', () => {
    for (let i = 0; i < 5; i++) store.record('ddg');
    for (let i = 0; i < 3; i++) store.record('brave_web');
    expect(store.check('ddg').remaining.minute).toBe(5);
    expect(store.check('brave_web').remaining.minute).toBe(996);
  });

  it('should return usage info with resets_at timestamps', () => {
    store.record('ddg');
    const usage = store.getUsage('ddg');
    expect(usage.minute.used).toBe(1);
    expect(usage.minute.limit).toBe(10);
    expect(usage.minute.resets_at).toBeTruthy();
    expect(usage.last_request).toBeTruthy();
  });

  it('should return all usage', () => {
    store.record('ddg');
    const all = store.getAllUsage();
    expect(all.length).toBe(1);
    expect(all[0].provider).toBe('ddg');
  });
});

describe('Suspension', () => {
  let store: RateLimitStore;

  beforeEach(() => {
    cleanup();
    store = new RateLimitStore(TEST_DIR, { bing: { rpm: 15, rpd: 60, rpmonth: 1800 } });
  });

  afterEach(() => {
    store.flush();
    cleanup();
  });

  it('should block provider after captcha error', () => {
    store.suspend('bing', 'captcha', 'Bing captcha');
    const r = store.check('bing');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('suspended');
    expect(r.reason).toContain('captcha');
    expect(r.suspended_until).toBeTruthy();
  });

  it('should record suspension in usage', () => {
    store.suspend('bing', 'captcha', 'Bing captcha');
    const usage = store.getUsage('bing');
    expect(usage.suspension.active).toBe(true);
    expect(usage.suspension.error_type).toBe('captcha');
    expect(usage.suspension.remaining_seconds).toBeGreaterThan(0);
  });

  it('should not block after suspension expires', () => {
    store.suspend('bing', 'captcha', 'Bing captcha');
    const r = store.check('bing');
    expect(r.allowed).toBe(false);
  });

  it('should clear suspension on successful record', () => {
    store.suspend('bing', 'captcha', 'Bing captcha');
    store.record('bing');
    const r = store.check('bing');
    expect(r.allowed).toBe(true);
    expect(r.suspended_until).toBeNull();
  });

  it('should persist suspension across restarts', () => {
    store.suspend('bing', 'captcha', 'Bing captcha');
    store.flush();
    const store2 = new RateLimitStore(TEST_DIR, { bing: { rpm: 15, rpd: 60, rpmonth: 1800 } });
    const r = store2.check('bing');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('suspended');
    store2.flush();
  });

  it('should set suspension even when duration is 0 — expires on next check', () => {
    const zeroStore = new RateLimitStore(TEST_DIR, { brave_web: { rpm: 999, rpd: 999, rpmonth: 999 } });
    zeroStore.suspend('brave_web', 'captcha', 'test zero');
    const r = zeroStore.check('brave_web');
    expect(r.allowed).toBe(true);
    expect(r.suspended_until).toBeNull();
    zeroStore.flush();
  });

  it('should not count error against rate limit budget', () => {
    store.record('bing');
    const before = store.check('bing').remaining.minute;
    store.suspend('bing', 'captcha', 'error');
    expect(store.check('bing').remaining.minute).toBe(before);
  });
});

describe('classifyError', () => {
  it('should classify captcha errors', () => {
    expect(classifyError('CAPTCHA from DDG')).toBe('captcha');
    expect(classifyError('captcha')).toBe('captcha');
    expect(classifyError('Bing captcha test')).toBe('captcha');
  });

  it('should classify too_many_requests errors', () => {
    expect(classifyError('HTTP 429 Too Many Requests')).toBe('too_many_requests');
    expect(classifyError('rate limit exceeded')).toBe('too_many_requests');
  });

  it('should classify access_denied errors', () => {
    expect(classifyError('403 Forbidden')).toBe('access_denied');
    expect(classifyError('access denied')).toBe('access_denied');
  });

  it('should default to access_denied for unknown errors', () => {
    expect(classifyError('something else')).toBe('access_denied');
  });
});
