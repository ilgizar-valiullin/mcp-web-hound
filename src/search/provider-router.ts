import { SearchProvider } from './providers/base-provider.js';
import { DuckDuckGoProvider } from './providers/duckduckgo.js';
import { BingProvider } from './providers/bing.js';
import { StartpageProvider } from './providers/startpage.js';
import { BraveProvider } from './providers/brave.js';
import { BraveWebProvider } from './providers/brave-web.js';
import { TavilyProvider } from './providers/tavily.js';
import { ExaProvider } from './providers/exa.js';
import { FirecrawlProvider } from './providers/firecrawl.js';
import { ProviderOptions, ProviderResult, ProviderStats } from '../utils/types.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { RateLimitStore, classifyError } from '../limits/rate-limit-store.js';

type ProviderFactory = () => SearchProvider;

const PROVIDER_REGISTRY: Record<string, { factory: ProviderFactory; guard: () => boolean }> = {
    ddg: {
    factory: () => new DuckDuckGoProvider(),
    guard: () => config.DDG_ENABLED,
  },
    bing: {
      factory: () => new BingProvider(),
      guard: () => config.BING_ENABLED,
    },
    startpage: {
      factory: () => new StartpageProvider(),
      guard: () => config.STARTPAGE_ENABLED,
    },
  brave: {
    factory: () => new BraveWebProvider(),
    guard: () => config.BRAVE_WEB_ENABLED,
  },
  brave_api: {
    factory: () => new BraveProvider(),
    guard: () => !!config.BRAVE_API_KEY,
  },
  tavily: {
    factory: () => new TavilyProvider(),
    guard: () => !!config.TAVILY_API_KEY,
  },
  exa: {
    factory: () => new ExaProvider(),
    guard: () => !!config.EXA_API_KEY,
  },
  firecrawl: {
    factory: () => new FirecrawlProvider(),
    guard: () => !!config.FIRECRAWL_API_KEY,
  },
};

export class ProviderRouter {
  private providers: SearchProvider[] = [];
  private rateLimitStore: RateLimitStore;

  constructor(rateLimitStore: RateLimitStore) {
    this.rateLimitStore = rateLimitStore;
    const order = config.PROVIDER_ORDER.split(',').map((s) => s.trim().toLowerCase());
    for (const name of order) {
      const entry = PROVIDER_REGISTRY[name];
      if (!entry) {
        logger.warn({ provider: name }, 'Unknown provider in PROVIDER_ORDER, skipping');
        continue;
      }
      if (!entry.guard()) continue;
      this.providers.push(entry.factory());
    }

    if (this.providers.length === 0) {
      logger.warn('No providers registered — check PROVIDER_ORDER and API keys');
    }
  }

  async search(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const maxParallel = config.MAX_PARALLEL_PROVIDERS;
    const mode = config.PROVIDER_EXECUTION_MODE;

    if (mode === 'sequential') {
      return this.searchSequential(query, options);
    }

    return this.searchParallel(query, options, maxParallel);
  }

  private providerKey(provider: SearchProvider): string {
    const name = provider.name.toLowerCase();
    if (name === 'duckduckgo') return 'ddg';
    if (name === 'brave web') return 'brave_web';
    if (name === 'brave') return 'brave_api';
    return name;
  }

  private checkRateLimit(provider: SearchProvider): { allowed: boolean; reason?: string } {
    const result = this.rateLimitStore.check(this.providerKey(provider));
    if (!result.allowed) {
      logger.warn({ provider: provider.name, reason: result.reason }, 'Provider rate limited');
      return { allowed: false, reason: result.reason! };
    }
    return { allowed: true };
  }

  private async searchSequential(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    for (const provider of this.providers) {
      try {
        const rateCheck = this.checkRateLimit(provider);
        if (!rateCheck.allowed) continue;

        const healthy = await provider.healthCheck();
        if (!healthy) {
          logger.warn({ provider: provider.name }, 'Provider unhealthy, skipping');
          continue;
        }
        logger.debug({ provider: provider.name, query }, 'Sequential search to provider');
        const results = await provider.search(query, options);
        this.rateLimitStore.record(this.providerKey(provider));
        if (results && results.length > 0) {
          logger.info({ provider: provider.name, results: results.length }, 'Sequential provider returned results');
          return results;
        }
        logger.warn({ provider: provider.name }, 'Sequential provider returned empty results');
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.rateLimitStore.suspend(this.providerKey(provider), classifyError(e.message), e.message);
        logger.error({ err: e, provider: provider.name }, 'Sequential provider failed');
      }
    }
    throw new Error('All sequential providers failed');
  }

  private async searchParallel(
    query: string,
    options: ProviderOptions,
    maxParallel: number,
  ): Promise<ProviderResult[]> {
    const allResults: ProviderResult[] = [];
    const lastError: Error[] = [];
    const queue = [...this.providers];

    const trySlot = async (): Promise<void> => {
      while (queue.length > 0) {
        const provider = queue.shift()!;
        try {
          const rateCheck = this.checkRateLimit(provider);
          if (!rateCheck.allowed) {
            logger.warn({ provider: provider.name, reason: rateCheck.reason }, 'Rate limited, skipping provider');
            continue;
          }

          const healthy = await provider.healthCheck();
          if (!healthy) {
            logger.warn({ provider: provider.name }, 'Provider unhealthy, skipping');
            continue;
          }
          logger.debug({ provider: provider.name, query }, 'Routing search to provider');
          const results = await provider.search(query, options);
          this.rateLimitStore.record(this.providerKey(provider));
          if (results && results.length > 0) {
            logger.info(
              { provider: provider.name, results: results.length },
              'Provider returned results',
            );
            allResults.push(...results);
            return;
          }
          logger.warn({ provider: provider.name }, 'Provider returned empty results');
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          this.rateLimitStore.suspend(this.providerKey(provider), classifyError(e.message), e.message);
          lastError.push(e);
        }
      }
    };

    const slots: Promise<void>[] = [];
    for (let i = 0; i < maxParallel; i++) {
      slots.push(trySlot());
    }
    await Promise.allSettled(slots);

    if (allResults.length === 0) {
      if (lastError.length > 0) {
        throw new Error(`All providers failed: ${lastError.map((e) => e.message).join('; ')}`);
      }
      throw new Error('No providers configured');
    }

    return allResults;
  }

  getProviderStats(): ProviderStats[] {
    return this.providers.map((p) => {
      const usage = this.rateLimitStore.getUsage(this.providerKey(p));
      return {
        ...p.getStats(),
        rate_limits: usage,
      };
    });
  }

  getRateLimitStore(): RateLimitStore {
    return this.rateLimitStore;
  }

  getProviderCount(): number {
    return this.providers.length;
  }

  getAvailableProviders(): string[] {
    return this.providers.map((p) => p.name);
  }
}
