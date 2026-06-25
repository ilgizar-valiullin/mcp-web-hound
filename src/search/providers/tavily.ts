import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
  query: string;
}

export class TavilyProvider extends BaseProvider {
  readonly name = 'Tavily';
  readonly tier = 2 as const;

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = config.TAVILY_API_KEY ?? '';
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    if (!this.apiKey) {
      throw new Error('Tavily API key not configured');
    }

    logger.debug({ query }, 'Tavily request');

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: 'basic',
        max_results: options.max_results,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Tavily rate limit exceeded');
      }
      throw new Error(`Tavily returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as TavilyResponse;

    if (!data.results) {
      return [];
    }

    return data.results.slice(0, options.max_results).map((r, i) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
      published_date: r.published_date,
      raw_position: i + 1,
      provider: 'tavily',
    }));
  }
}
