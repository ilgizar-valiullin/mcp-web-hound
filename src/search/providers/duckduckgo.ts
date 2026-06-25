import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';

interface RateLimitState {
  lastRequest: number;
  requestsThisMinute: number;
  minuteStart: number;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class DuckDuckGoProvider extends BaseProvider {
  readonly name = 'DuckDuckGo';
  readonly tier = 1 as const;

  private delayMs: number;
  private maxPerMinute: number;
  private rateLimit: RateLimitState = {
    lastRequest: 0,
    requestsThisMinute: 0,
    minuteStart: Date.now(),
  };

  constructor() {
    super();
    this.delayMs = config.DDG_DELAY_MS;
    this.maxPerMinute = config.DDG_MAX_PER_MINUTE;
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const allResults: ProviderResult[] = [];
    const needPages = Math.ceil(options.max_results / 10);
    const offsets = needPages > 1 ? [0, 10] : [0];

    for (const offset of offsets) {
      await this.enforceRateLimit();

      logger.debug({ query, offset }, 'DDG request');

      const body: Record<string, string> = { q: query };
      if (offset > 0) body.s = String(offset);

      const response = await fetch(DDG_HTML_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
        },
        body: new URLSearchParams(body),
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo returned ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const results = this.parseResults(html, allResults.length);

      allResults.push(...results);

      if (results.length < 10) break;
      if (allResults.length >= options.max_results) break;
    }

    return allResults.slice(0, options.max_results);
  }

  private parseResults(html: string, basePosition: number): ProviderResult[] {
    const results: ProviderResult[] = [];
    const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    const snippets: string[] = [];
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let snippetMatch: RegExpExecArray | null;
    while ((snippetMatch = snippetRegex.exec(html)) !== null) {
      snippets.push(this.stripHtml(snippetMatch[1]));
    }

    let position = 0;
    let titleMatch: RegExpExecArray | null;
    while ((titleMatch = titleRegex.exec(html)) !== null) {
      const rawUrl = titleMatch[1].trim();
      const rawTitle = this.stripHtml(titleMatch[2]);

      if (!rawUrl || !rawTitle) continue;

      position++;
      const snippet = snippets[position - 1] ?? '';

      results.push({
        title: this.decodeEntities(rawTitle),
        url: this.decodeEntities(rawUrl),
        snippet: this.decodeEntities(snippet),
        raw_position: basePosition + position,
        provider: 'duckduckgo',
      });
    }

    return results;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  private decodeEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(parseInt(n, 10)));
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();

    if (now - this.rateLimit.minuteStart >= 60000) {
      this.rateLimit.requestsThisMinute = 0;
      this.rateLimit.minuteStart = now;
    }

    if (this.rateLimit.requestsThisMinute >= this.maxPerMinute) {
      const waitUntilNextMinute = 60000 - (now - this.rateLimit.minuteStart);
      logger.warn({ waitMs: waitUntilNextMinute }, 'DDG rate limit reached, waiting');
      await this.sleep(waitUntilNextMinute);
      this.rateLimit.requestsThisMinute = 0;
      this.rateLimit.minuteStart = Date.now();
    }

    const elapsedSinceLast = now - this.rateLimit.lastRequest;
    if (elapsedSinceLast < this.delayMs) {
      await this.sleep(this.delayMs - elapsedSinceLast);
    }

    this.rateLimit.lastRequest = Date.now();
    this.rateLimit.requestsThisMinute++;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
