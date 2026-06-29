import { ProviderHealth, ProviderOptions, ProviderResult, ProviderStats } from '../../utils/types.js';

/**
 * Base Search Provider Interface
 *
 * All search providers MUST implement this interface.
 */
export interface SearchProvider {
  /**
   * Name of the provider (e.g., 'DuckDuckGo', 'Brave')
   */
  readonly name: string;

  /**
   * Priority tier:
   * 1 = Primary (self-hosted / free scraping)
   * 2 = Secondary (official free APIs)
   * 3 = Tertiary (optional APIs)
   */
  readonly tier: 1 | 2 | 3;

  /**
   * Perform a search query
   */
  search(query: string, options: ProviderOptions): Promise<ProviderResult[]>;

  /**
   * Check if the provider is currently available and healthy
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get provider usage statistics and health state
   */
  getStats(): ProviderStats;
}

/**
 * Abstract Base Provider
 *
 * Provides shared health tracking, rate limiting state, and error handling structure
 * that all providers can inherit.
 */
export abstract class BaseProvider implements SearchProvider {
  abstract readonly name: string;
  abstract readonly tier: 1 | 2 | 3;

  protected health: ProviderHealth = {
    consecutive_errors: 0,
    last_success: null,
    last_error: null,
    avg_latency_ms: 0,
    requests_today: 0,
    is_healthy: true,
  };

  protected limitToday: number | null = null;

  /**
   * Per-provider request queue — serialises concurrent calls to the same provider
   * so only one `doSearch` runs at a time. Each call chains onto the previous
   * call via a promise chain, creating an implicit FIFO queue per instance.
   */
  private requestQueue: Promise<void> = Promise.resolve();

  /**
   * Main search execution implementation.
   */
  abstract doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]>;

  /**
   * Wrapper around doSearch that tracks health, latency, and errors.
   *
   * Blocks until the previous request to this provider completes, then
   * re-checks health before proceeding. This ensures concurrent tool calls
   * from the agent are serialised per provider.
   */
  async search(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const prev = this.requestQueue;
    let release: () => void;
    this.requestQueue = new Promise<void>((r) => { release = r; });
    await prev;

    try {
      const start = Date.now();
      const results = await this.doSearch(query, options);
      this.recordSuccess(Date.now() - start);
      return results;
    } catch (error) {
      this.recordError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      release!();
    }
  }

  /**
   * Default health check. Always returns true — providers are always eligible
   * to be called. Errors are tracked in stats but never gate the provider.
   * Individual providers can override this with an actual API ping.
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * Lightweight reachability check. Sends a HEAD request to the given URL
   * with a short timeout. Returns true if the server responds with any status
   * (including 4xx/5xx — we're checking reachability, not application health).
   * Override in subclasses for provider-specific checks.
   */
  protected async ping(url: string, timeoutMs: number = 5000): Promise<boolean> {
    try {
      await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return true;
    } catch {
      return false;
    }
  }

  getStats(): ProviderStats {
    return {
      name: this.name,
      requests_today: this.health.requests_today,
      limit_today: this.limitToday,
      avg_latency_ms: Math.round(this.health.avg_latency_ms),
      last_error: this.health.last_error ? this.health.last_error.toISOString() : undefined,
      healthy: this.health.is_healthy,
    };
  }

  protected recordSuccess(latency: number): void {
    this.health.consecutive_errors = 0;
    this.health.last_success = new Date();
    this.health.requests_today++;

    // Moving average for latency
    if (this.health.avg_latency_ms === 0) {
      this.health.avg_latency_ms = latency;
    } else {
      this.health.avg_latency_ms = (this.health.avg_latency_ms * 0.9) + (latency * 0.1);
    }
  }

  protected recordError(_message: string): void {
    this.health.consecutive_errors++;
    this.health.last_error = new Date();
  }

  /**
   * Reset usage stats. Currently a no-op — health state is never persisted.
   */
  resetHealth(): void {
    // no-op
  }
}
