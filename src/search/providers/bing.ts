import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

const BING_SEARCH_URL = 'https://www.bing.com/search';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let lastRequestTime = 0;

export class BingProvider extends BaseProvider {
  readonly name = 'Bing';
  readonly tier = 1 as const;

  private resultsPerPage: number;
  private maxPages: number;

  constructor() {
    super();
    this.resultsPerPage = config.BING_RESULTS_PER_PAGE;
    this.maxPages = config.BING_MAX_PAGES;
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
    }
    lastRequestTime = Date.now();

    const allResults: ProviderResult[] = [];
    const needPages = Math.min(Math.ceil(options.max_results / this.resultsPerPage), this.maxPages);

    for (let page = 0; page < needPages; page++) {
      const url = new URL(BING_SEARCH_URL);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(this.resultsPerPage));
      if (page > 0) {
        url.searchParams.set('first', String(page * this.resultsPerPage + 1));
      }
      url.searchParams.set('hl', 'en');
      url.searchParams.set('cc', 'US');
      url.searchParams.set('mkt', 'en-US');
      url.searchParams.set('setlang', 'en-US');

      logger.debug({ url: url.toString() }, 'Bing request');

      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': DESKTOP_UA,
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!response.ok) {
        throw new Error(`Bing returned ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const pageResults = this.parseResults(html, options.max_results - allResults.length);
      allResults.push(...pageResults);

      if (pageResults.length < this.resultsPerPage) break;
    }

    return allResults;
  }

  private parseResults(html: string, maxResults: number): ProviderResult[] {
    const results: ProviderResult[] = [];

    const algoRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
    let position = 0;
    let match: RegExpExecArray | null;

    while ((match = algoRegex.exec(html)) !== null && results.length < maxResults) {
      const block = match[1];

      const titleH2 = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const url = titleH2 ? this.decodeEntities(titleH2[1]) : '';
      const title = titleH2 ? this.decodeEntities(titleH2[2].replace(/<[^>]*>/g, '').trim()) : '';

      const cite = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i);
      const displayUrl = cite ? this.decodeEntities(cite[1].replace(/<[^>]*>/g, '').trim()) : '';

      const capMatch = block.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>/i);
      const rawSnippet = capMatch
        ? this.decodeEntities(capMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
        : '';

      let publishedDate: string | undefined;
      let snippet = rawSnippet;

      const dateSpan = block.match(/<span[^>]*>([A-Z][a-z]+ \d{1,2}, \d{4})<\/span>/);
      if (dateSpan) {
        try {
          const parsed = new Date(dateSpan[1]);
          if (!isNaN(parsed.getTime())) {
            publishedDate = parsed.toISOString();
            snippet = rawSnippet
              .replace(dateSpan[1], '')
              .replace(/^[\s·\u00b7\u2022]+/, '')
              .trim();
          }
        } catch {
          // ignore parse error
        }
      }

      const finalUrl = displayUrl || url;
      if (title && finalUrl) {
        position++;
        results.push({
          title,
          url: finalUrl,
          snippet,
          published_date: publishedDate,
          raw_position: position,
          provider: 'bing',
        });
      }
    }

    if (results.length === 0) {
      const hasCaptcha = /captcha|verify|blocked|challenge/i.test(html);
      if (hasCaptcha) {
        throw new Error('Bing returned a captcha/blocking page');
      }
      const hasSearchResults = /id="b_results"|class="b_algo"/i.test(html);
      if (!hasSearchResults) {
        throw new Error('Bing HTML structure may have changed — no result blocks found in response');
      }
    }

    return results;
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
}
