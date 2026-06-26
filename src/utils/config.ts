import dotenv from 'dotenv';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema, type Config } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Server root = ../../ from src/utils/ (next to package.json)
const SERVER_ROOT = resolve(__dirname, '../..');

// Load .env from server's own root, regardless of CWD
dotenv.config({ path: resolve(SERVER_ROOT, '.env') });

function loadConfig(): Config {
  const parsed = ConfigSchema.parse(process.env);

  const dataDir = resolve(SERVER_ROOT, parsed.DATA_DIR);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const hasDdg = parsed.DDG_ENABLED;
  const hasBing = parsed.BING_ENABLED;
  const hasBrave = !!parsed.BRAVE_API_KEY;
  const hasTavily = !!parsed.TAVILY_API_KEY;
  const hasExa = !!parsed.EXA_API_KEY;
  const hasFirecrawl = !!parsed.FIRECRAWL_API_KEY;

  if (!hasDdg && !hasBing && !hasBrave && !hasTavily && !hasExa && !hasFirecrawl) {
    throw new Error(
      'No search providers configured. Set at least one: DDG_ENABLED=true, BING_ENABLED=true, BRAVE_API_KEY, TAVILY_API_KEY, EXA_API_KEY, or FIRECRAWL_API_KEY',
    );
  }

  return parsed;
}

export const config = loadConfig();
