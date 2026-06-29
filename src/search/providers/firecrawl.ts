import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

interface FirecrawlWebResult {
  title: string;
  url: string;
  description?: string;
  markdown?: string;
}

interface FirecrawlResponse {
  success: boolean;
  data?: {
    web?: FirecrawlWebResult[];
  };
  error?: string;
}

export class FirecrawlProvider extends BaseProvider {
  readonly name = 'Firecrawl';
  readonly tier = 3 as const;

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = config.FIRECRAWL_API_KEY ?? '';
  }

  async healthCheck(): Promise<boolean> {
    return this.apiKey ? this.ping('https://api.firecrawl.dev/') : false;
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    if (!this.apiKey) {
      throw new Error('Firecrawl API key not configured');
    }

    logger.debug({ query }, 'Firecrawl request');

    const response = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        limit: options.max_results,
        sources: ['web'],
        scrapeOptions: {},
      }),
    });

    if (!response.ok) {
      throw new Error(`Firecrawl returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as FirecrawlResponse;

    if (!data.success || !data.data?.web) {
      return [];
    }

    return data.data.web.slice(0, options.max_results).map((r, i) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? r.markdown ?? '',
      raw_position: i + 1,
      provider: 'firecrawl',
    }));
  }
}
