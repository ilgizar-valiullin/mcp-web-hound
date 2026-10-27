import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig, type Config, type ProviderLimits } from './types.js';
import { CONFIG_DIR, DATA_DIR, ENV_PATH } from './env-path.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_ROOT = resolve(__dirname, '../..');

// Auto-create config dir and .env from default.env on first run
if (!existsSync(CONFIG_DIR)) {
  mkdirSync(CONFIG_DIR, { recursive: true });
}
if (!existsSync(ENV_PATH)) {
  try {
    const defaultEnv = resolve(SERVER_ROOT, 'default.env');
    if (existsSync(defaultEnv)) {
      writeFileSync(ENV_PATH, readFileSync(defaultEnv, 'utf-8'), 'utf-8');
    }
  } catch {
    // default.env missing or write failed — will fall back to configure tool
  }
}

// Minimal dotenv: KEY=VALUE lines, no override of existing vars (dotenv semantics).
function loadEnvFile(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return;
  }
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(ENV_PATH);

// Per-project override: CWD/.env can override individual keys from the main config.
// Only keys that SERVER/.env originally set are overridable — MCP client env vars
// (passed via the environment block) are never touched.
const keysBeforeServer = Object.keys(process.env);
try {
  const cwdEnvPath = resolve(process.cwd(), '.env');
  const cwdContent = readFileSync(cwdEnvPath, 'utf-8');
  for (const line of cwdContent.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    // Only override if the key was set by SERVER/.env, not by MCP client
    if (!keysBeforeServer.includes(key)) {
      process.env[key] = val;
    }
  }
} catch {
  // No CWD/.env — fine, SERVER/.env is sufficient
}

export function buildProviderLimits(parsed: Config): Record<string, ProviderLimits> {
  return {
    ddg: {
      rpm: parsed.DDG_RPM,
      rpd: parsed.DDG_RPD,
      rpmonth: parsed.DDG_RPMONTH,
    },
    bing: {
      rpm: parsed.BING_RPM,
      rpd: parsed.BING_RPD,
      rpmonth: parsed.BING_RPMONTH,
    },
    startpage: {
      rpm: parsed.STARTPAGE_RPM,
      rpd: parsed.STARTPAGE_RPD,
      rpmonth: parsed.STARTPAGE_RPMONTH,
    },
    brave: {
      rpm: parsed.BRAVE_WEB_RPM,
      rpd: parsed.BRAVE_WEB_RPD,
      rpmonth: parsed.BRAVE_WEB_RPMONTH,
    },
    brave_api: {
      rpm: parsed.BRAVE_RPM,
      rpd: parsed.BRAVE_RPD,
      rpmonth: parsed.BRAVE_RPMONTH,
    },
    tavily: {
      rpm: parsed.TAVILY_RPM,
      rpd: parsed.TAVILY_RPD,
      rpmonth: parsed.TAVILY_RPMONTH,
    },
    exa: {
      rpm: parsed.EXA_RPM,
      rpd: parsed.EXA_RPD,
      rpmonth: parsed.EXA_RPMONTH,
    },
    firecrawl: {
      rpm: parsed.FIRECRAWL_RPM,
      rpd: parsed.FIRECRAWL_RPD,
      rpmonth: parsed.FIRECRAWL_RPMONTH,
    },
  };
}

function loadConfig(): Config {
  const parsed = parseConfig(process.env);

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const hasDdg = parsed.DDG_ENABLED;
  const hasBing = parsed.BING_ENABLED;
  const hasStartpage = parsed.STARTPAGE_ENABLED;
  const hasBraveWeb = parsed.BRAVE_WEB_ENABLED;
  const hasBraveApi = !!parsed.BRAVE_API_KEY;
  const hasTavily = !!parsed.TAVILY_API_KEY;
  const hasExa = !!parsed.EXA_API_KEY;
  const hasFirecrawl = !!parsed.FIRECRAWL_API_KEY;

  if (!hasStartpage && !hasDdg && !hasBraveWeb && !hasBing && !hasBraveApi && !hasTavily && !hasExa && !hasFirecrawl) {
    throw new Error(
      'No search providers configured. Set at least one: STARTPAGE_ENABLED=true (Google mirror), DDG_ENABLED=true, BING_ENABLED=true, BRAVE_WEB_ENABLED=true, BRAVE_API_KEY, TAVILY_API_KEY, EXA_API_KEY, or FIRECRAWL_API_KEY',
    );
  }

  return parsed;
}

export const config = loadConfig();
