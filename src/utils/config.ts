import dotenv from 'dotenv';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigSchema, type Config } from './types.js';

dotenv.config();

function loadConfig(): Config {
  const parsed = ConfigSchema.parse(process.env);

  const dataDir = resolve(parsed.DATA_DIR);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const hasSearxng = !!parsed.SEARXNG_URL && parsed.SEARXNG_ENABLED;
  const hasDdg = parsed.DDG_ENABLED;
  const hasBing = parsed.BING_ENABLED;
  const hasBrave = !!parsed.BRAVE_API_KEY;
  const hasTavily = !!parsed.TAVILY_API_KEY;
  const hasExa = !!parsed.EXA_API_KEY;
  const hasFirecrawl = !!parsed.FIRECRAWL_API_KEY;

  if (!hasSearxng && !hasDdg && !hasBing && !hasBrave && !hasTavily && !hasExa && !hasFirecrawl) {
    throw new Error(
      'No search providers configured. Set at least one: SEARXNG_URL, DDG_ENABLED=true, BING_ENABLED=true, BRAVE_API_KEY, TAVILY_API_KEY, EXA_API_KEY, or FIRECRAWL_API_KEY',
    );
  }

  return parsed;
}

export const config = loadConfig();
