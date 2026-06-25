import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

interface BraveResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

interface BraveResponse {
  web?: {
    results: BraveResult[];
  };
  query: {
    original: string;
  };
}

export class BraveProvider extends BaseProvider {
  readonly name = 'Brave';
  readonly tier = 2 as const;

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = config.BRAVE_API_KEY ?? '';
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    if (!this.apiKey) {
      throw new Error('Brave API key not configured');
    }

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(options.max_results));

    if (options.freshness && options.freshness !== 'any') {
      url.searchParams.set('freshness', options.freshness === 'day' ? 'pd' : options.freshness);
    }

    logger.debug({ url: url.toString() }, 'Brave request');

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
      headers: {
        'X-Subscription-Token': this.apiKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Brave rate limit exceeded');
      }
      throw new Error(`Brave returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as BraveResponse;

    if (!data.web?.results) {
      return [];
    }

    return data.web.results.slice(0, options.max_results).map((r, i) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
      published_date: r.age,
      raw_position: i + 1,
      provider: 'brave',
    }));
  }
}
