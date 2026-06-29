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

interface VqdEntry {
  vqd: string;
  expires: number;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_ACCEPT_LANG = 'en-US,en;q=0.9';

const VQD_TTL_MS = 3600_000;

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

  private resultsPerPage: number;
  private maxPages: number;

  private cookieJar = '';

  private vqdCache = new Map<string, VqdEntry>();

  constructor() {
    super();
    this.delayMs = config.DDG_DELAY_MS;
    this.maxPerMinute = config.DDG_MAX_PER_MINUTE;
    this.resultsPerPage = config.DDG_RESULTS_PER_PAGE;
    this.maxPages = config.DDG_MAX_PAGES;
  }

  async healthCheck(): Promise<boolean> {
    return this.ping('https://html.duckduckgo.com/');
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const allResults: ProviderResult[] = [];
    const needPages = Math.min(Math.ceil(options.max_results / this.resultsPerPage), this.maxPages);
    const offsets = Array.from({ length: needPages }, (_, i) => i * this.resultsPerPage);

    for (let pageIdx = 0; pageIdx < offsets.length; pageIdx++) {
      const offset = offsets[pageIdx];
      await this.enforceRateLimit();

      logger.debug({ query, offset, pageIdx }, 'DDG request');

      const body: Record<string, string> = { q: query };

      if (pageIdx === 0) {
        body.b = '';
      } else {
        const vqd = this.getVqd(query);
        if (!vqd) {
          logger.warn({ query }, 'VQD missing for pagination, stopping DDG pagination');
          break;
        }
        body.vqd = vqd;
        body.nextParams = '';
        body.api = 'd.js';
        body.o = 'json';
        body.v = 'l';
        body.dc = String(offset + 1);
        body.s = String(offset);
      }

      const headers: Record<string, string> = {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
        Referer: DDG_HTML_URL,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Accept-Language': DEFAULT_ACCEPT_LANG,
      };

      if (this.cookieJar) {
        headers.Cookie = this.cookieJar;
      }

      const response = await fetch(DDG_HTML_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers,
        body: new URLSearchParams(body),
        redirect: 'manual',
      });

      this.updateCookieJar(response.headers);

      const html = await response.text();

      if (pageIdx === 0) {
        this.extractAndStoreVqd(query, html);
      }

      if (this.isCaptchaPage(html)) {
        throw new Error(
          'DuckDuckGo returned a captcha/blocking page — try reducing DDG_MAX_PER_MINUTE or increasing DDG_DELAY_MS',
        );
      }

      const results = this.parseResults(html, allResults.length);
      allResults.push(...results);

      if (results.length < 10) break;
      if (allResults.length >= options.max_results) break;
    }

    return allResults.slice(0, options.max_results);
  }

  private getVqd(query: string): string | undefined {
    this.evictStaleVqd();
    const entry = this.vqdCache.get(query);
    return entry?.vqd;
  }

  private extractAndStoreVqd(query: string, html: string): void {
    const match = html.match(/<input[^>]*name=["']vqd["'][^>]*value=["']([^"']+)["']/i);
    if (match && match[1]) {
      this.vqdCache.set(query, { vqd: match[1], expires: Date.now() + VQD_TTL_MS });
      logger.debug({ query, vqd: match[1] }, 'DDG VQD extracted');
    }
  }

  private evictStaleVqd(): void {
    const now = Date.now();
    for (const [key, entry] of this.vqdCache) {
      if (entry.expires < now) {
        this.vqdCache.delete(key);
      }
    }
  }

  private updateCookieJar(headers: Headers): void {
    const setCookie = headers.getSetCookie?.() ?? [];
    if (setCookie.length === 0) return;

    for (const raw of setCookie) {
      const eqIdx = raw.indexOf('=');
      if (eqIdx === -1) continue;
      const name = raw.slice(0, eqIdx).trim();
      const semiIdx = raw.indexOf(';', eqIdx);
      const value = semiIdx === -1 ? raw.slice(eqIdx + 1).trim() : raw.slice(eqIdx + 1, semiIdx).trim();

      const oldPattern = new RegExp(`(^|;\\s*)${name}=[^;]*`);
      if (oldPattern.test(this.cookieJar)) {
        this.cookieJar = this.cookieJar.replace(oldPattern, `$1${name}=${value}`);
      } else {
        this.cookieJar += (this.cookieJar ? '; ' : '') + `${name}=${value}`;
      }
    }
  }

  private isCaptchaPage(html: string): boolean {
    return /captcha|challenge|verify|blocked/i.test(html)
      && /<form[^>]*id=["']challenge-form["']/i.test(html);
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

    const dates: (string | undefined)[] = [];
    const dateRegex = /<span>[\s&nbsp;]*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/gi;
    let dateMatch: RegExpExecArray | null;
    while ((dateMatch = dateRegex.exec(html)) !== null) {
      dates.push(dateMatch[1]);
    }

    let position = 0;
    let titleMatch: RegExpExecArray | null;
    while ((titleMatch = titleRegex.exec(html)) !== null) {
      const rawUrl = titleMatch[1].trim();
      const rawTitle = this.stripHtml(titleMatch[2]);

      if (!rawUrl || !rawTitle) continue;

      position++;
      const snippet = snippets[position - 1] ?? '';
      const date = dates[position - 1];

      results.push({
        title: this.decodeEntities(rawTitle),
        url: this.decodeEntities(rawUrl),
        snippet: this.decodeEntities(snippet),
        published_date: date ? new Date(date).toISOString() : undefined,
        raw_position: basePosition + position,
        provider: 'duckduckgo',
      });
    }

    if (results.length === 0 && !this.isCaptchaPage(html)) {
      const hasResultsHeading = /class=["']?results["']?|id=["']?results["']?/i.test(html);
      if (!hasResultsHeading) {
        throw new Error('DuckDuckGo HTML structure may have changed — no result blocks found in response');
      }
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
      .replace(/&nbsp;/g, ' ')
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
