import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

const BRAVE_WEB_URL = 'https://search.brave.com/search';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let lastRequestTime = 0;

export class BraveWebProvider extends BaseProvider {
  readonly name = 'Brave Web';
  readonly tier = 2;

  async healthCheck(): Promise<boolean> {
    return this.ping('https://search.brave.com/');
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
    }
    lastRequestTime = Date.now();

    const url = `${BRAVE_WEB_URL}?q=${encodeURIComponent(query)}&source=web`;
    logger.debug({ url }, 'Brave Web request');

    const resp = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        Cookie: 'safesearch=off; useLocation=0; summarizer=0; country=us; ui_lang=en-us',
      },
      signal: AbortSignal.timeout(config.SEARCH_TIMEOUT_MS),
    });

    if (resp.status === 429) {
      const retryAfter = resp.headers.get('Retry-After');
      const msg = retryAfter
        ? `Brave Web returned 429 Too Many Requests, retry_after=${retryAfter}`
        : 'Brave Web returned 429 Too Many Requests';
      throw new Error(msg);
    }
    if (resp.status === 403) {
      throw new Error('Brave Web returned 403 Access Denied');
    }

    const html = await resp.text();
    const results = this.parseResults(html);

    return results.slice(0, options.max_results).map((r, i) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      published_date: r.published_date,
      raw_position: i + 1,
      provider: 'brave_web',
    }));
  }

  private parseResults(
    html: string,
  ): Array<{ title: string; url: string; snippet: string; published_date?: string }> {
    const results: Array<{ title: string; url: string; snippet: string; published_date?: string }> = [];
    const seen = new Set<string>();

    const snippetRegex = /<div[^>]*class="[^"]*snippet[^"]*"[^>]*data-pos="(\d+)"[^>]*>/gi;

    let snMatch: RegExpExecArray | null;
    while ((snMatch = snippetRegex.exec(html)) !== null) {
      const blockStart = snMatch.index;
      let depth = 1;
      let pos = snMatch.index + snMatch[0].length;
      while (depth > 0 && pos < html.length) {
        if (html[pos] === '<') {
          const next = html[pos + 1];
          if (next === '/') {
            const tagName = html.slice(pos + 2).match(/^(\w+)/);
            if (tagName) depth--;
          } else if (next !== '!' && html.slice(pos + 1).match(/^(\w+)/)) {
            const tagName = html.slice(pos + 1).match(/^(\w+)/)?.[1];
            if (tagName && tagName !== 'br' && tagName !== 'img' && tagName !== 'input' && tagName !== 'hr') {
              depth++;
            }
          }
        }
        pos++;
      }
      const block = html.slice(blockStart, pos);

      const urlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
      if (!urlMatch) continue;
      const url = urlMatch[1];

      if (seen.has(url)) continue;
      seen.add(url);

      const titleMatch = block.match(/class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\//);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';

      let snippet = '';
      let published_date: string | undefined;
      const genSnipMatch = block.match(/<div[^>]*class="generic-snippet[^"]*"[^>]*>/);
      if (genSnipMatch && genSnipMatch.index !== undefined) {
        let depth = 1;
        let pos = genSnipMatch.index + genSnipMatch[0].length;
        while (depth > 0 && pos < block.length) {
          if (block[pos] === '<') {
            const next = block[pos + 1];
            if (next === '/') { depth--; }
            else if (next !== '!' && block.slice(pos + 1).match(/^(\w+)/)) { depth++; }
          }
          pos++;
        }
        const genBlock = block.slice(genSnipMatch.index, pos);
        const contentMatch = genBlock.match(/<div[^>]*class="content\b[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (contentMatch) {
          snippet = contentMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
          const dateMatch = contentMatch[1].match(/<span[^>]*class="[^"]*t-secondary[^"]*"[^>]*>([^<]+?)\s*-\s*</);
          if (dateMatch) {
            const raw = dateMatch[1].trim();
            const d = new Date(raw);
            if (!isNaN(d.getTime()) && raw.length > 3) {
              published_date = d.toISOString();
            }
          }
        }
      }

      if (title && url) {
        results.push({ title, url, snippet, published_date });
      }
    }

    logger.debug({ results: results.length }, 'Brave Web parsed results');
    return results;
  }
}
