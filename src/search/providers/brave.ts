import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

interface BraveResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  page_age?: string;
}

interface BraveResponse {
  web?: {
    results: BraveResult[];
  };
  query: {
    original: string;
  };
}

const RELATIVE_AGE_RE = /^(\d+)\s*(hour|day|week|month|year)s?\s*ago$/i;

function parseAge(age: string | undefined): string | undefined {
  if (!age) return undefined;

  // Absolute date: "March 27, 2026"
  const abs = new Date(age);
  if (!isNaN(abs.getTime()) && abs.getFullYear() > 2000) {
    return abs.toISOString();
  }

  // Relative: "2 weeks ago", "3 days ago", "1 year ago"
  const m = age.match(RELATIVE_AGE_RE);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const now = Date.now();
    let ms = 0;
    if (unit === 'hour') ms = n * 3600_000;
    else if (unit === 'day') ms = n * 86_400_000;
    else if (unit === 'week') ms = n * 604_800_000;
    else if (unit === 'month') ms = n * 2_592_000_000;
    else if (unit === 'year') ms = n * 31_536_000_000;
    return new Date(now - ms).toISOString();
  }

  return undefined;
}

export class BraveProvider extends BaseProvider {
  readonly name = 'Brave';
  readonly tier = 2 as const;

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = config.BRAVE_API_KEY ?? '';
  }

  async healthCheck(): Promise<boolean> {
    return this.apiKey ? this.ping('https://api.search.brave.com/') : false;
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
      published_date: parseAge(r.age ?? r.page_age),
      raw_position: i + 1,
      provider: 'brave',
    }));
  }
}
