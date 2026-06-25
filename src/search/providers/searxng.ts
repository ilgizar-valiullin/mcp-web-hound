import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

interface SearxngResult {
  title: string;
  url: string;
  content: string;
  engine: string;
  publishedDate?: string;
}

interface SearxngResponse {
  results: SearxngResult[];
  number_of_results?: number;
}

export class SearxngProvider extends BaseProvider {
  readonly name = 'SearXNG';
  readonly tier = 1 as const;

  private baseUrl: string;
  private engines: string;

  constructor() {
    super();
    this.baseUrl = config.SEARXNG_URL ?? '';
    this.engines = config.SEARXNG_ENGINES;
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    if (!this.baseUrl) {
      throw new Error('SearXNG URL not configured');
    }

    const url = new URL(`${this.baseUrl.replace(/\/+$/, '')}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('engines', this.engines);
    url.searchParams.set('language', 'en');

    if (options.freshness && options.freshness !== 'any') {
      url.searchParams.set('time_range', options.freshness);
    }

    logger.debug({ url: url.toString() }, 'SearXNG request');

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as SearxngResponse;

    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.slice(0, options.max_results).map((r, i) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
      published_date: r.publishedDate,
      raw_position: i + 1,
      provider: 'searxng',
    }));
  }
}
