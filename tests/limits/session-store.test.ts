import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionStore } from '../../src/limits/session-store.js';

describe('SessionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enabled', () => {
    it('should be true when window > 0', () => {
      const store = new SessionStore(5, 0);
      expect(store.enabled).toBe(true);
    });

    it('should be false when window is 0', () => {
      const store = new SessionStore(0, 0);
      expect(store.enabled).toBe(false);
    });
  });

  describe('session lifecycle', () => {
    it('should start a session on first isSeen call', () => {
      const store = new SessionStore(5, 0);
      expect(store.isSeen('http://example.com')).toBe(false);
      expect(store.size()).toBe(0);
    });

    it('should track seen URLs within session', () => {
      const store = new SessionStore(5, 0);
      store.markSeen(['http://example.com', 'http://test.com']);
      expect(store.isSeen('http://example.com')).toBe(true);
      expect(store.isSeen('http://test.com')).toBe(true);
      expect(store.isSeen('http://other.com')).toBe(false);
    });

    it('should expire session after window minutes', () => {
      const store = new SessionStore(5, 0);
      store.markSeen(['http://example.com']);
      expect(store.isSeen('http://example.com')).toBe(true);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(store.isSeen('http://example.com')).toBe(false);
      expect(store.size()).toBe(0);
    });

    it('should start fresh session after expiry', () => {
      const store = new SessionStore(5, 0);
      store.markSeen(['http://old.com']);
      expect(store.isSeen('http://old.com')).toBe(true);
      expect(store.size()).toBe(1);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      store.markSeen(['http://new.com']);
      expect(store.isSeen('http://old.com')).toBe(false);
      expect(store.isSeen('http://new.com')).toBe(true);
      expect(store.size()).toBe(1);
    });
  });

  describe('stretch mode', () => {
    it('should extend session when remaining TTL < stretch window', () => {
      const store = new SessionStore(5, 1);
      store.markSeen(['http://example.com']);

      vi.advanceTimersByTime(4 * 60 * 1000 + 30 * 1000); // 4:30 in — 0:30 remaining

      store.markSeen(['http://other.com']);

      vi.advanceTimersByTime(40 * 1000); // 5:10 total — original would have expired

      expect(store.isSeen('http://example.com')).toBe(true);
    });

    it('should extend by stretchMs not by full window', () => {
      const store = new SessionStore(5, 1);
      store.markSeen(['http://example.com']);

      vi.advanceTimersByTime(4 * 60 * 1000 + 30 * 1000); // 4:30 in, 0:30 remaining

      store.markSeen(['http://other.com']); // stretch → extends to T+6:00

      vi.advanceTimersByTime(2 * 60 * 1000); // 6:30 total — past new expiry

      expect(store.isSeen('http://example.com')).toBe(false);
    });

    it('should NOT extend session when remaining TTL >= stretch window', () => {
      const store = new SessionStore(5, 1);
      store.markSeen(['http://example.com']);

      vi.advanceTimersByTime(2 * 60 * 1000); // 2:00 in — 3:00 remaining (> 1 min stretch)

      store.markSeen(['http://other.com']);

      vi.advanceTimersByTime(3 * 60 * 1000 + 1); // 5:01 total

      expect(store.isSeen('http://example.com')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all seen URLs and reset session', () => {
      const store = new SessionStore(5, 0);
      store.markSeen(['http://a.com', 'http://b.com']);
      expect(store.size()).toBe(2);

      store.clear();
      expect(store.size()).toBe(0);
      expect(store.isSeen('http://a.com')).toBe(false);
    });
  });

  describe('token-based operation', () => {
    it('should treat tokens as opaque strings', () => {
      const store = new SessionStore(5, 0);
      store.markSeen(['token-a', 'token-b']);
      expect(store.isSeen('token-a')).toBe(true);
      expect(store.isSeen('token-b')).toBe(true);
      expect(store.isSeen('token-c')).toBe(false);
    });
  });
});
