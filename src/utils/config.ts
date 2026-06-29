import dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema, type Config, type ProviderLimits } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Server root = ../../ from src/utils/ (next to package.json)
const SERVER_ROOT = resolve(__dirname, '../..');

// Config file lives next to package.json — written by mcp-web-hound-configure.
// This is the main config for the server, shared across all projects.
export const ENV_PATH = resolve(SERVER_ROOT, '.env');
dotenv.config({ path: ENV_PATH, quiet: true });

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
  const parsed = ConfigSchema.parse(process.env);

  const dataDir = isAbsolute(parsed.DATA_DIR)
    ? parsed.DATA_DIR
    : resolve(process.cwd(), parsed.DATA_DIR);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
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
