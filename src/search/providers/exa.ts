import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

interface ExaResult {
  title: string;
  url: string;
  text?: string;
  publishedDate?: string;
  published_date?: string;
  score?: number;
}

interface ExaResponse {
  results: ExaResult[];
  autoprompt_string?: string;
}

export class ExaProvider extends BaseProvider {
  readonly name = 'Exa';
  readonly tier = 3 as const;

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = config.EXA_API_KEY ?? '';
  }

  async healthCheck(): Promise<boolean> {
    return this.apiKey ? this.ping('https://api.exa.ai/') : false;
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    if (!this.apiKey) {
      throw new Error('Exa API key not configured');
    }

    logger.debug({ query }, 'Exa request');

    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        query,
        type: 'keyword',
        num_results: options.max_results,
        include_domains: undefined,
        start_published_date: undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Exa returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as ExaResponse;

    if (!data.results) {
      return [];
    }

    return data.results.slice(0, options.max_results).map((r, i) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.text ?? '',
      published_date: r.publishedDate ?? r.published_date,
      raw_position: i + 1,
      provider: 'exa',
    }));
  }
}
