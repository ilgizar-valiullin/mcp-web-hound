import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';

const BASE_URL = 'https://www.startpage.com';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SC_CODE_TTL = 3_600_000;
let scCodeCache: { code: string; expires: number } | null = null;

async function getScCode(): Promise<string> {
  if (scCodeCache && Date.now() < scCodeCache.expires) {
    return scCodeCache.code;
  }

  logger.debug('Fetching new sc code from Startpage homepage');
  const resp = await fetch(BASE_URL + '/', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });

  const html = await resp.text();
  const scMatch = html.match(/<input[^>]*name="sc"[^>]*value="([^"]+)"/);
  if (!scMatch) {
    throw new Error('Startpage: could not extract sc code from homepage (captcha?)');
  }

  const code = scMatch[1];
  scCodeCache = { code, expires: Date.now() + SC_CODE_TTL };
  logger.debug({ code }, 'Startpage sc code cached');
  return code;
}

function buildPreferencesCookie(lang: string, region: string): string {
  const pairs: Array<[string, string]> = [
    ['date_time', 'world'],
    ['disable_family_filter', '1'],
    ['disable_open_in_new_window', '0'],
    ['enable_post_method', '1'],
    ['enable_proxy_safety_suggest', '1'],
    ['enable_stay_control', '1'],
    ['instant_answers', '1'],
    ['lang_homepage', `s/device/${lang}/`],
    ['num_of_results', '10'],
    ['suggestions', '1'],
    ['wt_unit', 'celsius'],
    ['language', lang],
    ['language_ui', lang],
    ['search_results_region', region],
  ];
  return pairs.map(([k, v]) => `${k}EEE${v}`).join('N1N');
}

interface DateMatch {
  iso: string;
  endIndex: number;
}

function tryParseDate(text: string): DateMatch | undefined {
  const monthMap: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  const months = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  // US: Jan 27, 2026 or January 27 2026
  const usRe = new RegExp(`^(${months}) (\\d{1,2}),? (\\d{4})`);
  const usMatch = text.match(usRe);
  if (usMatch) {
    const m = monthMap[usMatch[1].toLowerCase()];
    if (m !== undefined) {
      return { iso: new Date(Date.UTC(+usMatch[3], m, +usMatch[2])).toISOString(), endIndex: usMatch[0].length };
    }
  }

  // EU: 27 Jan 2026 or 27 January 2026
  const euRe = new RegExp(`^(\\d{1,2}) (${months}) (\\d{4})`);
  const euMatch = text.match(euRe);
  if (euMatch) {
    const m = monthMap[euMatch[2].toLowerCase()];
    if (m !== undefined) {
      return { iso: new Date(Date.UTC(+euMatch[3], m, +euMatch[1])).toISOString(), endIndex: euMatch[0].length };
    }
  }

  // Relative: X days/weeks/months/years ago
  const relRe = /^(\d+) (days?|weeks?|months?|years?) ago/i;
  const relMatch = text.match(relRe);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const d = new Date();
    if (unit.startsWith('day')) d.setDate(d.getDate() - n);
    else if (unit.startsWith('week')) d.setDate(d.getDate() - n * 7);
    else if (unit.startsWith('month')) d.setMonth(d.getMonth() - n);
    else if (unit.startsWith('year')) d.setFullYear(d.getFullYear() - n);
    return { iso: d.toISOString(), endIndex: relMatch[0].length };
  }

  return undefined;
}

interface StartpageResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string;
}

function extractJsonFromSerp(html: string): string | null {
  const startMarker = 'React.createElement(UIStartpage.AppSerp';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;

  const jsonStart = html.indexOf('{', startIdx + startMarker.length);
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let pos = jsonStart;

  while (pos < html.length) {
    const ch = html[pos];
    if (escape) { escape = false; pos++; continue; }
    if (ch === '\\' && inString) { escape = true; pos++; continue; }
    if (ch === '"' && !escape) { inString = !inString; pos++; continue; }
    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return html.slice(jsonStart, pos + 1); }
    }
    pos++;
  }
  return null;
}
function parseResults(html: string): StartpageResult[] {
  const results: StartpageResult[] = [];
  const seen = new Set<string>();

  const jsonStr = extractJsonFromSerp(html);
  if (!jsonStr) {
    logger.debug('No Startpage JSON found in response');
    return results;
  }

  try {
    const data = JSON.parse(jsonStr);
    const mainline = data?.render?.presenter?.regions?.mainline;
    if (!mainline) return results;

    for (const section of mainline) {
      if (section.display_type !== 'web-google' && section.display_type !== 'news-bing') continue;
      for (const item of section.results || []) {
        const url = item.clickUrl || '';
        const title = item.title ? item.title.replace(/<[^>]*>/g, '').trim() : '';
        if (!url || !title || seen.has(url)) continue;
        seen.add(url);

        let snippet = item.description ? item.description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
        let published_date: string | undefined;

        const parsedDate = tryParseDate(snippet);
        if (parsedDate) {
          published_date = parsedDate.iso;
          snippet = snippet.slice(parsedDate.endIndex).trim();
        }

        results.push({ title, url, snippet, published_date });
      }
    }
  } catch {
    logger.debug('Failed to parse Startpage JSON');
  }

  return results;
}

let lastRequestTime = 0;

export class StartpageProvider extends BaseProvider {
  readonly name = 'Startpage';
  readonly tier = 2;

  async healthCheck(): Promise<boolean> {
    return this.ping('https://www.startpage.com/');
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    const elapsed = Date.now() - lastRequestTime;
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
    }
    lastRequestTime = Date.now();

    const sc = await getScCode();

    const lang = 'en';
    const region = 'en-US';
    const cookie = `preferences=${buildPreferencesCookie(lang, region)}`;

    const formData = new URLSearchParams({
      query,
      cat: 'web',
      t: 'device',
      sc,
      language: lang,
      lui: lang,
      abd: '1',
      abe: '1',
      qsr: 'all',
      qadf: 'moderate',
    });

    logger.debug({ sc }, 'Startpage (google mirror) POST request');

    const resp = await fetch(BASE_URL + '/sp/search', {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: cookie,
        Origin: BASE_URL,
        Referer: BASE_URL + '/',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      body: formData,
      signal: AbortSignal.timeout(config.SEARCH_TIMEOUT_MS),
      redirect: 'manual',
    });

    const body = await resp.text();

    if (resp.status === 302 || resp.status === 301) {
      const loc = resp.headers.get('location') || '';
      if (loc.includes('captcha')) {
        throw new Error('Startpage returned a CAPTCHA');
      }
    }
    if (body.includes('captcha-block') || body.includes('sp/captcha')) {
      throw new Error('Startpage returned a CAPTCHA');
    }

    const results = parseResults(body);
    logger.debug({ results: results.length }, 'Startpage parsed results');

    return results.slice(0, options.max_results).map((r, i) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      published_date: r.published_date,
      raw_position: i + 1,
      provider: 'startpage',
    }));
  }
}
