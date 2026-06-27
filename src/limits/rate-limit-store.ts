import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../utils/logger.js';

interface WindowCounter {
  count: number;
  window_start: number;
}

interface Suspension {
  until: number;
  reason: string;
  error_type: SuspensionReason;
}

interface ProviderData {
  minute: WindowCounter;
  day: WindowCounter;
  month: WindowCounter;
  last_request: number;
  suspension: Suspension | null;
}

interface StoreData {
  providers: Record<string, ProviderData>;
}

export type SuspensionReason = 'captcha' | 'too_many_requests' | 'access_denied';
export type ProviderKey = string;

const SUSPENSION_BACKOFF = [60_000, 300_000, 900_000, 3_600_000, 14_400_000, 86_400_000];

export interface ProviderLimits {
  rpm: number;
  rpd: number;
  rpmonth: number;
}

export interface ProviderSuspensions {
  captcha_ms: number;
  too_many_requests_ms: number;
  access_denied_ms: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  reason: string | null;
  suspended_until: string | null;
  remaining: {
    minute: number;
    day: number;
    month: number;
  };
  resets_at: {
    minute: string;
    day: string;
    month: string;
  };
}

export interface ProviderUsage {
  provider: string;
  minute: { used: number; limit: number; resets_at: string };
  day: { used: number; limit: number; resets_at: string };
  month: { used: number; limit: number; resets_at: string };
  last_request: string | null;
  suspension: {
    active: boolean;
    until: string | null;
    reason: string | null;
    error_type: SuspensionReason | null;
    remaining_seconds: number;
  };
}

const DEFAULT_LIMITS: Record<string, ProviderLimits> = {
  ddg: { rpm: 10, rpd: 200, rpmonth: 6000 },
  brave_web: { rpm: 10, rpd: 100, rpmonth: 6000 },
  brave_api: { rpm: 15, rpd: 60, rpmonth: 2000 },
  bing: { rpm: 15, rpd: 60, rpmonth: 1800 },
  tavily: { rpm: 10, rpd: 30, rpmonth: 1000 },
  exa: { rpm: 10, rpd: 30, rpmonth: 1000 },
  firecrawl: { rpm: 5, rpd: 15, rpmonth: 500 },
};

const SUSPENSION_DURATIONS: Record<string, ProviderSuspensions> = {
  ddg: { captcha_ms: 3_600_000, too_many_requests_ms: 0, access_denied_ms: 0 },
  brave_web: { captcha_ms: 0, too_many_requests_ms: 3_600_000, access_denied_ms: 300_000 },
  brave_api: { captcha_ms: 0, too_many_requests_ms: 3_600_000, access_denied_ms: 0 },
  bing: { captcha_ms: 86_400_000, too_many_requests_ms: 3_600_000, access_denied_ms: 86_400_000 },
  startpage: { captcha_ms: 86_400_000, too_many_requests_ms: 3_600_000, access_denied_ms: 86_400_000 },
  tavily: { captcha_ms: 0, too_many_requests_ms: 3_600_000, access_denied_ms: 0 },
  exa: { captcha_ms: 0, too_many_requests_ms: 3_600_000, access_denied_ms: 0 },
  firecrawl: { captcha_ms: 0, too_many_requests_ms: 3_600_000, access_denied_ms: 0 },
};

const SUSPENSION_DEFAULTS: ProviderSuspensions = {
  captcha_ms: 86_400_000,
  too_many_requests_ms: 3_600_000,
  access_denied_ms: 86_400_000,
};

function toISO(ts: number): string {
  return new Date(ts).toISOString();
}

function isWindowExpired(w: WindowCounter, windowMs: number): boolean {
  return Date.now() - w.window_start >= windowMs;
}

function freshWindow(): WindowCounter {
  return { count: 0, window_start: Date.now() };
}

function suspensionKey(reason: SuspensionReason): keyof ProviderSuspensions {
  return `${reason}_ms` as keyof ProviderSuspensions;
}

export function classifyError(message: string): SuspensionReason {
  const m = message.toLowerCase();
  if (/captcha|sorry|blocked/i.test(m)) return 'captcha';
  if (/429|too many|rate limit/i.test(m)) return 'too_many_requests';
  if (/403|access denied|forbidden/i.test(m)) return 'access_denied';
  return 'access_denied';
}

export class RateLimitStore {
  private data: StoreData;
  private filePath: string;
  private writePending = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private limits: Record<string, ProviderLimits>;
  private suspensions: Record<string, ProviderSuspensions>;
  private consecutiveFailures: Map<string, { captcha: number; too_many_requests: number; access_denied: number }>;

  constructor(
    dataDir: string,
    limits?: Record<string, ProviderLimits>,
    suspensions?: Record<string, ProviderSuspensions>,
  ) {
    this.filePath = resolve(dataDir, 'rate-limits.json');
    this.limits = limits ?? DEFAULT_LIMITS;
    this.suspensions = suspensions ?? SUSPENSION_DURATIONS;
    this.consecutiveFailures = new Map();
    this.data = this.load();

    const minuteMs = 60_000;
    const dayMs = 86_400_000;
    const monthMs = 2_592_000_000;

    for (const [, pdata] of Object.entries(this.data.providers)) {
      if (isWindowExpired(pdata.minute, minuteMs)) pdata.minute = freshWindow();
      if (isWindowExpired(pdata.day, dayMs)) pdata.day = freshWindow();
      if (isWindowExpired(pdata.month, monthMs)) pdata.month = freshWindow();
      if (pdata.suspension && pdata.suspension.until <= Date.now()) pdata.suspension = null;
    }

    setInterval(() => this.flush(), 30_000);
  }

  check(providerName: string): RateLimitCheckResult {
    const pdata = this.getOrCreate(providerName);
    const limits = this.limits[providerName];
    const windowMs = { minute: 60_000, day: 86_400_000, month: 2_592_000_000 };
    const now = Date.now();

    if (pdata.suspension && pdata.suspension.until > now) {
      const remaining: RateLimitCheckResult['remaining'] = {
        minute: Math.max(0, (limits?.rpm ?? Infinity) - pdata.minute.count),
        day: Math.max(0, (limits?.rpd ?? Infinity) - pdata.day.count),
        month: Math.max(0, (limits?.rpmonth ?? Infinity) - pdata.month.count),
      };
      return {
        allowed: false,
        reason: `Provider "${providerName}" suspended (${pdata.suspension.error_type}): ${pdata.suspension.reason}`,
        suspended_until: toISO(pdata.suspension.until),
        remaining,
        resets_at: {
          minute: toISO(pdata.minute.window_start + windowMs.minute),
          day: toISO(pdata.day.window_start + windowMs.day),
          month: toISO(pdata.month.window_start + windowMs.month),
        },
      };
    }

    if (pdata.suspension && pdata.suspension.until <= now) {
      pdata.suspension = null;
    }

    for (const [key, w] of Object.entries({ minute: pdata.minute, day: pdata.day, month: pdata.month })) {
      const limit = limits?.[key === 'minute' ? 'rpm' : key === 'day' ? 'rpd' : 'rpmonth'] ?? Infinity;
      if (w.count >= limit) {
        const remaining: RateLimitCheckResult['remaining'] = {
          minute: Math.max(0, (limits?.rpm ?? Infinity) - pdata.minute.count),
          day: Math.max(0, (limits?.rpd ?? Infinity) - pdata.day.count),
          month: Math.max(0, (limits?.rpmonth ?? Infinity) - pdata.month.count),
        };
        return {
          allowed: false,
          reason: `Provider "${providerName}" rate limited (${key}): ${w.count}/${limit} used`,
          suspended_until: null,
          remaining,
          resets_at: {
            minute: toISO(pdata.minute.window_start + windowMs.minute),
            day: toISO(pdata.day.window_start + windowMs.day),
            month: toISO(pdata.month.window_start + windowMs.month),
          },
        };
      }
    }

    return {
      allowed: true,
      reason: null,
      suspended_until: null,
      remaining: {
        minute: Math.max(0, (limits?.rpm ?? Infinity) - pdata.minute.count),
        day: Math.max(0, (limits?.rpd ?? Infinity) - pdata.day.count),
        month: Math.max(0, (limits?.rpmonth ?? Infinity) - pdata.month.count),
      },
      resets_at: {
        minute: toISO(pdata.minute.window_start + windowMs.minute),
        day: toISO(pdata.day.window_start + windowMs.day),
        month: toISO(pdata.month.window_start + windowMs.month),
      },
    };
  }

  suspend(providerName: string, reason: SuspensionReason, detail: string): void {
    const pdata = this.getOrCreate(providerName);

    // Track consecutive failures for backoff
    let c = this.consecutiveFailures.get(providerName);
    if (!c) {
      c = { captcha: 0, too_many_requests: 0, access_denied: 0 };
      this.consecutiveFailures.set(providerName, c);
    }
    c[reason] = (c[reason] || 0) + 1;

    const sus = this.suspensions[providerName] ?? SUSPENSION_DEFAULTS;
    const maxDuration = sus[suspensionKey(reason)];
    const idx = Math.min(c[reason] - 1, SUSPENSION_BACKOFF.length - 1);
    const backoffDuration = SUSPENSION_BACKOFF[idx];
    const duration = maxDuration > 0 ? Math.min(backoffDuration, maxDuration) : maxDuration;
    const until = Date.now() + duration;

    pdata.suspension = { until, reason: detail, error_type: reason };

    if (duration > 0) {
      logger.warn(
        { provider: providerName, reason, duration_ms: duration, until: toISO(until), attempt: c[reason] },
        'Provider suspended',
      );
    }
    this.scheduleWrite();
  }

  record(providerName: string): void {
    const windowMs = { minute: 60_000, day: 86_400_000, month: 2_592_000_000 };
    const pdata = this.getOrCreate(providerName);

    for (const [key, w] of Object.entries({ minute: pdata.minute, day: pdata.day, month: pdata.month })) {
      const ms = windowMs[key as 'minute' | 'day' | 'month'];
      if (isWindowExpired(w, ms)) {
        Object.assign(w, { count: 1, window_start: Date.now() });
      } else {
        w.count++;
      }
    }

    pdata.last_request = Date.now();
    pdata.suspension = null;

    // Successful request — reset consecutive failure counter
    this.consecutiveFailures.delete(providerName);

    this.scheduleWrite();
  }

  getUsage(providerName: string): ProviderUsage {
    const windowMs = { minute: 60_000, day: 86_400_000, month: 2_592_000_000 };
    const pdata = this.getOrCreate(providerName);
    const limits = this.limits[providerName];
    const now = Date.now();
    const susActive = pdata.suspension !== null && pdata.suspension.until > now;

    if (pdata.suspension && !susActive) pdata.suspension = null;

    return {
      provider: providerName,
      minute: {
        used: pdata.minute.count,
        limit: limits?.rpm ?? Infinity,
        resets_at: toISO(pdata.minute.window_start + windowMs.minute),
      },
      day: {
        used: pdata.day.count,
        limit: limits?.rpd ?? Infinity,
        resets_at: toISO(pdata.day.window_start + windowMs.day),
      },
      month: {
        used: pdata.month.count,
        limit: limits?.rpmonth ?? Infinity,
        resets_at: toISO(pdata.month.window_start + windowMs.month),
      },
      last_request: pdata.last_request ? toISO(pdata.last_request) : null,
      suspension: {
        active: susActive,
        until: susActive ? toISO(pdata.suspension!.until) : null,
        reason: susActive ? pdata.suspension!.reason : null,
        error_type: susActive ? pdata.suspension!.error_type : null,
        remaining_seconds: susActive ? Math.ceil((pdata.suspension!.until - now) / 1000) : 0,
      },
    };
  }

  getAllUsage(): ProviderUsage[] {
    return Object.keys(this.data.providers).map((name) => this.getUsage(name));
  }

  flush(): void {
    if (!this.writePending) return;
    this.writePending = false;
    this.write();
  }

  private getOrCreate(name: string): ProviderData {
    if (!this.data.providers[name]) {
      this.data.providers[name] = {
        minute: freshWindow(),
        day: freshWindow(),
        month: freshWindow(),
        last_request: 0,
        suspension: null,
      };
    }
    return this.data.providers[name];
  }

  private load(): StoreData {
    if (!existsSync(this.filePath)) {
      return { providers: {} };
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as StoreData;
    } catch (err) {
      logger.error({ err, path: this.filePath }, 'Failed to load rate limit store, starting fresh');
      return { providers: {} };
    }
  }

  private scheduleWrite(): void {
    this.writePending = true;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      if (this.writePending) {
        this.writePending = false;
        this.write();
      }
    }, 5000);
  }

  private write(): void {
    const tmp = this.filePath + '.tmp';
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      renameSync(tmp, this.filePath);
    } catch (err) {
      logger.error({ err, path: this.filePath }, 'Failed to write rate limit store');
    }
  }
}
