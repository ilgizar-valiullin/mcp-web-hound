import { ProviderHealth, ProviderOptions, ProviderResult, ProviderStats } from '../../utils/types.js';

/**
 * Base Search Provider Interface
 *
 * All search providers MUST implement this interface.
 */
export interface SearchProvider {
  /**
   * Name of the provider (e.g., 'SearXNG', 'DuckDuckGo')
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
   * Main search execution implementation.
   */
  abstract doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]>;

  /**
   * Wrapper around doSearch that tracks health, latency, and errors.
   */
  async search(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    if (!this.health.is_healthy) {
      throw new Error(`Provider ${this.name} is currently unhealthy`);
    }

    const start = Date.now();
    try {
      const results = await this.doSearch(query, options);
      const latency = Date.now() - start;
      
      this.recordSuccess(latency);
      return results;
    } catch (error) {
      this.recordError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Default health check: tests if the provider is marked healthy.
   * Providers can override this to perform an actual API ping.
   */
  async healthCheck(): Promise<boolean> {
    return this.health.is_healthy;
  }

  getStats(): ProviderStats {
    return {
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

    if (!this.health.is_healthy) {
      this.health.is_healthy = true; // Recovered
    }
  }

  protected recordError(_message: string): void {
    this.health.consecutive_errors++;
    this.health.last_error = new Date();
    
    // Mark unhealthy if > 3 consecutive errors
    if (this.health.consecutive_errors >= 3) {
      this.health.is_healthy = false;
    }
  }

  /**
   * Reset the health state. Can be used for recovery probes.
   */
  resetHealth(): void {
    this.health.consecutive_errors = 0;
    this.health.is_healthy = true;
  }
}
