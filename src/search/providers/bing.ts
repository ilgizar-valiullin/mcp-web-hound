import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { logger } from '../../utils/logger.js';

const BING_SEARCH_URL = 'https://www.bing.com/search';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class BingProvider extends BaseProvider {
  readonly name = 'Bing';
  readonly tier = 1 as const;

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const url = new URL(BING_SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(options.max_results * 2));
    url.searchParams.set('hl', 'en');

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
    return this.parseResults(html, options.max_results);
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
      const snippet = capMatch
        ? this.decodeEntities(capMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
        : '';

      const finalUrl = displayUrl || url;
      if (title && finalUrl) {
        position++;
        results.push({
          title,
          url: finalUrl,
          snippet,
          raw_position: position,
          provider: 'bing',
        });
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
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(parseInt(n, 10)));
  }
}
