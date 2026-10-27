/**
 * Shared Types for MCP Web Hound Server
 */

// --- Input Schemas (zero-dependency, zod-compatible facades) ---

export interface SearchRequest {
  query: string;
  intent: 'web' | 'docs' | 'github' | 'news';
}

const SEARCH_INTENTS = ['web', 'docs', 'github', 'news'] as const;

export const SearchRequestSchema = {
  parse(data: unknown): SearchRequest {
    const d = data as Record<string, unknown> | null;
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      throw new Error('Search request must be an object');
    }
    if (typeof d.query !== 'string' || d.query.length < 1) {
      throw new Error('Query cannot be empty');
    }
    const intent = d.intent === undefined ? 'web' : d.intent;
    if (typeof intent !== 'string' || !(SEARCH_INTENTS as readonly string[]).includes(intent)) {
      throw new Error(`Invalid intent: ${String(d.intent)}`);
    }
    return { query: d.query, intent: intent as SearchRequest['intent'] };
  },
};

// --- Search Models ---

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published_date?: string;
  relevance_score: number;
}

export interface SearchMeta {
  total_results: number;
  cached: boolean;
  query_normalized: string;
  search_time_ms: number;
  session_deduped_count: number;
}

export interface SearchResponse {
  results: SearchResult[];
  meta: SearchMeta;
}

// --- Provider Models ---

export interface ProviderOptions {
  intent: string;
  freshness: string;
  max_results: number;
}

export interface ProviderResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string;
  raw_position: number;
  provider: string;
}

export interface ProviderStats {
  name: string;
  requests_today: number;
  limit_today: number | null;
  avg_latency_ms: number;
  last_error?: string;
  healthy: boolean;
  rate_limits?: ProviderRateUsage;
}

export interface ProviderHealth {
  consecutive_errors: number;
  last_success: Date | null;
  last_error: Date | null;
  avg_latency_ms: number;
  requests_today: number;
  is_healthy: boolean;
}

// --- Cache & Limits ---

export interface RecentQuery {
  query: string;
  embedding: number[];
  timestamp: number;
  cache_key: string;
}

export interface TaskBudget {
  window_start: number;
  window_minutes: number;
  max_searches: number;
  max_fetches: number;
  searches_used: number;
  fetches_used: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  remaining: number;
  message?: string;
}

export interface ProviderLimits {
  rpm: number;
  rpd: number;
  rpmonth: number;
}

export interface RateLimitUsage {
  used: number;
  limit: number;
  resets_at: string;
}

export interface ProviderRateUsage {
  provider: string;
  minute: RateLimitUsage;
  day: RateLimitUsage;
  month: RateLimitUsage;
  last_request: string | null;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  reason: string | null;
  remaining: {
    minute: number;
    day: number;
    month: number;
  };
  resets_at: {
    minute: string;
    day: string;
    month: string;
  };
}

export interface CacheStats {
  total_queries: number;
  total_results: number;
  total_pages: number;
  db_size_mb: number;
}

// --- Diagnostics ---

export interface StatusResponse {
  providers: Array<{
    name: string;
    tier: 1 | 2 | 3;
    healthy: boolean;
    requests_today: number;
    limit_today: number | null;
    avg_latency_ms: number;
    rate_limits: ProviderRateUsage;
  }>;
  cache: CacheStats;
  budget: {
    searches_remaining: number;
    fetches_remaining: number;
    budget_window: string;
  };
  embedding_model: string;
  uptime_seconds: number;
}

// --- Search Logging ---

export interface ProviderRanking {
  source: string;
  engine_rank: number;
}

export interface RankingSignals {
  nli: number;
  domain: number;
  freshness: number;
  position_bias: number;
}

export interface ScoredDocEntry {
  baseline_score: number;
  signals: RankingSignals;
}

export interface CandidateLogEntry {
  doc_id: string;
  title: string;
  snippet: string;
  url: string;
  provider_rankings: ProviderRanking[];
}

export interface SearchStats {
  total_from_providers: number;
  unique_after_dedup: number;
  returned_to_agent: number;
}

export interface SearchLogEntry {
  type: string;
  data_role: string;
  search_id: string;
  query: string;
  normalized_query: string;
  intent: string;
  providers_used: string[];
  candidates: CandidateLogEntry[];
  scoring: Record<string, ScoredDocEntry>;
  stats: SearchStats;
  final_order: string[];
  agent_usage: string[] | null;
  system_version: {
    mcp: string;
    ranker: string;
    signals: string;
    nli_model: string;
  };
  meta: {
    timestamp: string;
    latency_ms: number;
    cache_hit: boolean;
  };
}

// --- Config ---
// The single source for all configuration (zero-dependency).
// FIELD_DEFS drives parsing, docs, configure-TUI and status help.

export type FieldKind = 'string' | 'boolean' | 'number' | 'optional-string' | 'loglevel' | 'execmode';

export interface FieldDef {
  key: string;
  kind: FieldKind;
  default: string | number | boolean | undefined;
  description: string;
}

export interface Config {
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  DB_FILENAME: string;
  DDG_ENABLED: boolean;
  BING_ENABLED: boolean;
  STARTPAGE_ENABLED: boolean;
  BRAVE_WEB_ENABLED: boolean;
  BRAVE_API_KEY?: string;
  BRAVE_DAILY_LIMIT: number;
  TAVILY_API_KEY?: string;
  TAVILY_DAILY_LIMIT: number;
  EXA_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  GITHUB_TOKEN?: string;
  GITLAB_TOKEN?: string;
  PROVIDER_ORDER: string;
  MAX_PARALLEL_PROVIDERS: number;
  PROVIDER_EXECUTION_MODE: 'parallel' | 'sequential';
  MAX_RESULTS_AFTER_RERANK: number;
  SEARCH_TIMEOUT_MS: number;
  BUDGET_MAX_SEARCHES: number;
  BUDGET_MAX_FETCHES: number;
  BUDGET_WINDOW_MINUTES: number;
  CACHE_MAX_SIZE_MB: number;
  CACHE_EVICTION_INTERVAL_MIN: number;
  CACHE_TTL_MINUTES: number;
  SEMANTIC_ENABLED: boolean;
  EMBEDDING_MODEL: string;
  EMBEDDING_DIMENSION: number;
  SEMANTIC_THRESHOLD: number;
  INTENT_CLASSIFIER_MODEL: string;
  MODEL_IDLE_TIMEOUT_SEC: number;
  MODEL_WORKER: boolean;
  MODEL_PRELOAD: boolean;
  RERANK_ENABLED: boolean;
  SEARCH_LOG_ENABLED: boolean;
  SESSION_DEDUP_WINDOW_MINUTES: number;
  SESSION_DEDUP_STRETCH_MINUTES: number;
  DDG_DELAY_MS: number;
  DDG_MAX_PER_MINUTE: number;
  DDG_RESULTS_PER_PAGE: number;
  DDG_MAX_PAGES: number;
  BING_RESULTS_PER_PAGE: number;
  BING_MAX_PAGES: number;
  DDG_RPM: number;
  DDG_RPD: number;
  DDG_RPMONTH: number;
  BING_RPM: number;
  BING_RPD: number;
  BING_RPMONTH: number;
  STARTPAGE_RPM: number;
  STARTPAGE_RPD: number;
  STARTPAGE_RPMONTH: number;
  BRAVE_RPM: number;
  BRAVE_RPD: number;
  BRAVE_RPMONTH: number;
  BRAVE_WEB_RPM: number;
  BRAVE_WEB_RPD: number;
  BRAVE_WEB_RPMONTH: number;
  TAVILY_RPM: number;
  TAVILY_RPD: number;
  TAVILY_RPMONTH: number;
  EXA_RPM: number;
  EXA_RPD: number;
  EXA_RPMONTH: number;
  FIRECRAWL_RPM: number;
  FIRECRAWL_RPD: number;
  FIRECRAWL_RPMONTH: number;
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'LOG_LEVEL', kind: 'loglevel', default: 'info', description: 'Logging verbosity' },
  { key: 'DB_FILENAME', kind: 'string', default: 'search.db', description: 'SQLite database file name' },
  { key: 'DDG_ENABLED', kind: 'boolean', default: true, description: 'Enable DuckDuckGo search (free, no key)' },
  { key: 'BING_ENABLED', kind: 'boolean', default: true, description: 'Enable Bing search (free, no key)' },
  { key: 'STARTPAGE_ENABLED', kind: 'boolean', default: true, description: 'Enable Startpage / Google mirror (free, no key)' },
  { key: 'BRAVE_WEB_ENABLED', kind: 'boolean', default: true, description: 'Enable Brave Web HTML scrape (free, no key)' },
  { key: 'BRAVE_API_KEY', kind: 'optional-string', default: undefined, description: 'API key for Brave Search API (2000 queries/month free)' },
  { key: 'BRAVE_DAILY_LIMIT', kind: 'number', default: 60, description: 'Max Brave Search API queries per day' },
  { key: 'TAVILY_API_KEY', kind: 'optional-string', default: undefined, description: 'API key for Tavily Search (1000 queries/month free)' },
  { key: 'TAVILY_DAILY_LIMIT', kind: 'number', default: 30, description: 'Max Tavily queries per day' },
  { key: 'EXA_API_KEY', kind: 'optional-string', default: undefined, description: 'API key for Exa Search (trial 1000 queries)' },
  { key: 'FIRECRAWL_API_KEY', kind: 'optional-string', default: undefined, description: 'API key for Firecrawl (trial 500 credits)' },
  { key: 'GITHUB_TOKEN', kind: 'optional-string', default: undefined, description: 'GitHub personal access token (optional, 60 req/hr without)' },
  { key: 'GITLAB_TOKEN', kind: 'optional-string', default: undefined, description: 'GitLab personal access token with read_api scope' },
  { key: 'PROVIDER_ORDER', kind: 'string', default: 'startpage,ddg,brave_web,bing,brave_api,tavily,exa,firecrawl', description: 'Comma-separated provider priority list (tried top to bottom)' },
  { key: 'MAX_PARALLEL_PROVIDERS', kind: 'number', default: 2, description: 'Max providers to query simultaneously' },
  { key: 'PROVIDER_EXECUTION_MODE', kind: 'execmode', default: 'parallel', description: 'Run providers in parallel or fall through one by one' },
  { key: 'MAX_RESULTS_AFTER_RERANK', kind: 'number', default: 10, description: 'Max results returned after reranking' },
  { key: 'SEARCH_TIMEOUT_MS', kind: 'number', default: 15000, description: 'Per-provider search timeout in milliseconds' },
  { key: 'BUDGET_MAX_SEARCHES', kind: 'number', default: 15, description: 'Max searches allowed per budget window' },
  { key: 'BUDGET_MAX_FETCHES', kind: 'number', default: 30, description: 'Max page fetches allowed per budget window' },
  { key: 'BUDGET_WINDOW_MINUTES', kind: 'number', default: 30, description: 'Budget window duration in minutes' },
  { key: 'CACHE_MAX_SIZE_MB', kind: 'number', default: 500, description: 'Max cache database size in MB (0 = unlimited)' },
  { key: 'CACHE_EVICTION_INTERVAL_MIN', kind: 'number', default: 30, description: 'Interval between automatic cache size checks (minutes)' },
  { key: 'CACHE_TTL_MINUTES', kind: 'number', default: 1440, description: 'Cache entry time-to-live in minutes (1440 = 24h)' },
  { key: 'SEMANTIC_ENABLED', kind: 'boolean', default: true, description: 'Enable semantic search with embeddings (~120MB model download)' },
  { key: 'EMBEDDING_MODEL', kind: 'string', default: 'multilingual-e5-small', description: 'HuggingFace model for text embeddings' },
  { key: 'EMBEDDING_DIMENSION', kind: 'number', default: 384, description: 'Embedding vector dimension (must match model output)' },
  { key: 'SEMANTIC_THRESHOLD', kind: 'number', default: 0.92, description: 'Cosine similarity threshold for semantic dedup' },
  { key: 'INTENT_CLASSIFIER_MODEL', kind: 'string', default: 'Xenova/nli-deberta-v3-xsmall', description: 'HuggingFace model for NLI-based intent classification' },
  { key: 'MODEL_IDLE_TIMEOUT_SEC', kind: 'number', default: 5, description: 'Unload hot worker (DB/vec/router/models) after N seconds idle (0 = never unload, hot start ~1-2s)' },
  { key: 'MODEL_WORKER', kind: 'boolean', default: true, description: 'Run ONNX models in a private child process killed on idle (OS fully reclaims RAM)' },
  { key: 'MODEL_PRELOAD', kind: 'boolean', default: false, description: 'Preload embedding model at startup (true = hot start, false = lazy cold start)' },
  { key: 'RERANK_ENABLED', kind: 'boolean', default: true, description: 'Enable cross-encoder reranking for result relevance' },
  { key: 'SEARCH_LOG_ENABLED', kind: 'boolean', default: false, description: 'Log search queries, candidates, and reranker scores for ML training dataset' },
  { key: 'SESSION_DEDUP_WINDOW_MINUTES', kind: 'number', default: 5, description: 'Window in minutes for deduplicating identical queries' },
  { key: 'SESSION_DEDUP_STRETCH_MINUTES', kind: 'number', default: 0, description: 'Extra minutes to extend dedup window on new activity' },
  { key: 'DDG_DELAY_MS', kind: 'number', default: 1000, description: 'Delay between DuckDuckGo requests in milliseconds' },
  { key: 'DDG_MAX_PER_MINUTE', kind: 'number', default: 10, description: 'Max DuckDuckGo requests per minute' },
  { key: 'DDG_RESULTS_PER_PAGE', kind: 'number', default: 10, description: 'DuckDuckGo results per page' },
  { key: 'DDG_MAX_PAGES', kind: 'number', default: 1, description: 'Max DuckDuckGo pages to scrape' },
  { key: 'BING_RESULTS_PER_PAGE', kind: 'number', default: 10, description: 'Bing results per page' },
  { key: 'BING_MAX_PAGES', kind: 'number', default: 1, description: 'Max Bing pages to scrape' },
  { key: 'DDG_RPM', kind: 'number', default: 10, description: 'DuckDuckGo max requests per minute' },
  { key: 'DDG_RPD', kind: 'number', default: 200, description: 'DuckDuckGo max requests per day' },
  { key: 'DDG_RPMONTH', kind: 'number', default: 6000, description: 'DuckDuckGo max requests per month' },
  { key: 'BING_RPM', kind: 'number', default: 15, description: 'Bing max requests per minute' },
  { key: 'BING_RPD', kind: 'number', default: 60, description: 'Bing max requests per day' },
  { key: 'BING_RPMONTH', kind: 'number', default: 1800, description: 'Bing max requests per month' },
  { key: 'STARTPAGE_RPM', kind: 'number', default: 10, description: 'Startpage max requests per minute' },
  { key: 'STARTPAGE_RPD', kind: 'number', default: 200, description: 'Startpage max requests per day' },
  { key: 'STARTPAGE_RPMONTH', kind: 'number', default: 6000, description: 'Startpage max requests per month' },
  { key: 'BRAVE_RPM', kind: 'number', default: 15, description: 'Brave Search API max requests per minute' },
  { key: 'BRAVE_RPD', kind: 'number', default: 60, description: 'Brave Search API max requests per day' },
  { key: 'BRAVE_RPMONTH', kind: 'number', default: 2000, description: 'Brave Search API max requests per month' },
  { key: 'BRAVE_WEB_RPM', kind: 'number', default: 10, description: 'Brave Web scrape max requests per minute' },
  { key: 'BRAVE_WEB_RPD', kind: 'number', default: 100, description: 'Brave Web scrape max requests per day' },
  { key: 'BRAVE_WEB_RPMONTH', kind: 'number', default: 6000, description: 'Brave Web scrape max requests per month' },
  { key: 'TAVILY_RPM', kind: 'number', default: 10, description: 'Tavily max requests per minute' },
  { key: 'TAVILY_RPD', kind: 'number', default: 30, description: 'Tavily max requests per day' },
  { key: 'TAVILY_RPMONTH', kind: 'number', default: 1000, description: 'Tavily max requests per month' },
  { key: 'EXA_RPM', kind: 'number', default: 10, description: 'Exa max requests per minute' },
  { key: 'EXA_RPD', kind: 'number', default: 30, description: 'Exa max requests per day' },
  { key: 'EXA_RPMONTH', kind: 'number', default: 1000, description: 'Exa max requests per month' },
  { key: 'FIRECRAWL_RPM', kind: 'number', default: 5, description: 'Firecrawl max requests per minute' },
  { key: 'FIRECRAWL_RPD', kind: 'number', default: 15, description: 'Firecrawl max requests per day' },
  { key: 'FIRECRAWL_RPMONTH', kind: 'number', default: 500, description: 'Firecrawl max requests per month' },
];

/** Parse raw (stringly) env into Config. Same coercion semantics as the old zod schema. */
export function parseConfig(input: Record<string, unknown>): Config {
  const out: Record<string, unknown> = {};
  for (const def of FIELD_DEFS) {
    const raw = input[def.key];
    if (raw === undefined) {
      out[def.key] = def.default;
      continue;
    }
    switch (def.kind) {
      case 'boolean':
        if (typeof raw === 'boolean') out[def.key] = raw;
        else if (typeof raw === 'string') out[def.key] = raw === 'true';
        else throw new Error(`Invalid boolean for ${def.key}`);
        break;
      case 'number':
        if (typeof raw === 'number') out[def.key] = raw;
        else if (typeof raw === 'string') out[def.key] = Number(raw);
        else throw new Error(`Invalid number for ${def.key}`);
        break;
      case 'string':
        if (typeof raw !== 'string') throw new Error(`Invalid string for ${def.key}`);
        out[def.key] = raw;
        break;
      case 'optional-string':
        if (typeof raw !== 'string') throw new Error(`Invalid string for ${def.key}`);
        out[def.key] = raw;
        break;
      case 'loglevel':
        if (typeof raw !== 'string' || !['debug', 'info', 'warn', 'error'].includes(raw)) {
          throw new Error(`Invalid LOG_LEVEL: ${String(raw)}`);
        }
        out[def.key] = raw;
        break;
      case 'execmode':
        if (raw !== 'parallel' && raw !== 'sequential') {
          throw new Error(`Invalid PROVIDER_EXECUTION_MODE: ${String(raw)}`);
        }
        out[def.key] = raw;
        break;
    }
  }
  return out as unknown as Config;
}

/** zod-compatible facade: parse() with identical defaults/coercion. */
export const ConfigSchema = {
  parse(input: unknown): Config {
    const d = (input ?? {}) as Record<string, unknown>;
    if (typeof d !== 'object' || Array.isArray(d)) throw new Error('Config must be an object');
    return parseConfig(d);
  },
};
