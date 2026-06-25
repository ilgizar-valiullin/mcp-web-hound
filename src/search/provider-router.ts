import { SearchProvider } from './providers/base-provider.js';
import { DuckDuckGoProvider } from './providers/duckduckgo.js';
import { BingProvider } from './providers/bing.js';
import { SearxngProvider } from './providers/searxng.js';
import { BraveProvider } from './providers/brave.js';
import { TavilyProvider } from './providers/tavily.js';
import { ExaProvider } from './providers/exa.js';
import { FirecrawlProvider } from './providers/firecrawl.js';
import { ProviderOptions, ProviderResult, ProviderStats } from '../utils/types.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export class ProviderRouter {
  private providers: SearchProvider[] = [];

  constructor() {
    if (config.DDG_ENABLED) {
      this.providers.push(new DuckDuckGoProvider());
    }

    if (config.BING_ENABLED) {
      this.providers.push(new BingProvider());
    }

    if (config.SEARXNG_URL && config.SEARXNG_ENABLED) {
      this.providers.push(new SearxngProvider());
    }

    if (config.BRAVE_API_KEY) {
      this.providers.push(new BraveProvider());
    }

    if (config.TAVILY_API_KEY) {
      this.providers.push(new TavilyProvider());
    }

    if (config.EXA_API_KEY) {
      this.providers.push(new ExaProvider());
    }

    if (config.FIRECRAWL_API_KEY) {
      this.providers.push(new FirecrawlProvider());
    }
  }

  async search(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const allResults: ProviderResult[] = [];
    const lastError: Error[] = [];
    const MAX_PROVIDERS = 2;

    const healthyProviders: SearchProvider[] = [];
    for (const provider of this.providers) {
      if (healthyProviders.length >= MAX_PROVIDERS) break;
      try {
        const healthy = await provider.healthCheck();
        if (healthy) {
          healthyProviders.push(provider);
        } else {
          logger.warn({ provider: provider.name }, 'Provider unhealthy, skipping');
        }
      } catch {
        continue;
      }
    }

    if (healthyProviders.length === 0) {
      throw new Error('No healthy providers available');
    }

    const results = await Promise.allSettled(
      healthyProviders.map((provider) => {
        logger.debug({ provider: provider.name, query }, 'Routing search to provider');
        return provider.search(query, options);
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        const providerResults = r.value;
        if (providerResults && providerResults.length > 0) {
          logger.info({ provider: healthyProviders[i].name, results: providerResults.length }, 'Provider returned results');
          allResults.push(...providerResults);
        } else {
          logger.warn({ provider: healthyProviders[i].name }, 'Provider returned empty results');
        }
      } else {
        const err = r.reason instanceof Error ? r.reason : new Error(String(r.reason));
        logger.error({ err, provider: healthyProviders[i].name }, 'Provider failed');
        lastError.push(err);
      }
    }

    if (allResults.length === 0) {
      if (lastError.length > 0) {
        throw new Error(
          `All providers failed: ${lastError.map((e) => e.message).join('; ')}`,
        );
      }
      throw new Error('No providers configured');
    }

    return allResults;
  }

  getProviderStats(): ProviderStats[] {
    return this.providers.map((p) => p.getStats());
  }

  getProviderCount(): number {
    return this.providers.length;
  }

  getAvailableProviders(): string[] {
    return this.providers.map((p) => p.name);
  }
}
