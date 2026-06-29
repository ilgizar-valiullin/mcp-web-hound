import { z } from 'zod';

/**
 * Shared Types for Search MCP Server
 */

// --- Input Schemas ---

export const SearchRequestSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  intent: z.enum(["web", "docs", "github", "news"]).default("web"),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

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

// --- Config ---

export const ConfigSchema = z.object({
  // General
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATA_DIR: z.string().default('./data'),
  DB_FILENAME: z.string().default('search.db'),


  // Providers — DuckDuckGo (scrape, free)
  DDG_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true),
  DDG_DELAY_MS: z.number().or(z.string().transform(Number)).default(1000),
  DDG_MAX_PER_MINUTE: z.number().or(z.string().transform(Number)).default(10),
  DDG_RESULTS_PER_PAGE: z.number().or(z.string().transform(Number)).default(10),
  DDG_MAX_PAGES: z.number().or(z.string().transform(Number)).default(1),

  // Providers — Bing (scrape, free)
  BING_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true),
  BING_RESULTS_PER_PAGE: z.number().or(z.string().transform(Number)).default(10),
  BING_MAX_PAGES: z.number().or(z.string().transform(Number)).default(1),

  // Providers — Startpage (scrape, free, Google results via proxy — google mirror)
  STARTPAGE_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true),

  // Providers — Brave (API key)
  BRAVE_API_KEY: z.string().optional(),
  BRAVE_DAILY_LIMIT: z.number().or(z.string().transform(Number)).default(60),

  // Providers — Tavily (API key)
  TAVILY_API_KEY: z.string().optional(),
  TAVILY_DAILY_LIMIT: z.number().or(z.string().transform(Number)).default(30),

  // Providers — Exa (API key, trial 1000)
  EXA_API_KEY: z.string().optional(),

  // Providers — Firecrawl (API key, trial 500 credits)
  FIRECRAWL_API_KEY: z.string().optional(),

  // GitHub Search API (optional, without token: 60 req/hr)
  GITHUB_TOKEN: z.string().optional(),

  // GitLab Search API (optional)
  GITLAB_TOKEN: z.string().optional(),

  // Provider order (comma-separated, uses name field — startpage is a Google mirror)
  PROVIDER_ORDER: z.string().default('startpage,ddg,brave_web,bing,brave_api,tavily,exa,firecrawl'),

  // Parallel — how many providers to call simultaneously (applied in parallel mode only)
  MAX_PARALLEL_PROVIDERS: z.number().or(z.string().transform(Number)).default(2),

  // Execution mode: 'parallel' — call providers concurrently, 'sequential' — stop on first success
  PROVIDER_EXECUTION_MODE: z.enum(['parallel', 'sequential']).default('parallel'),

  // Provider retry — number of retries before suspending a provider on transient failure
  PROVIDER_RETRY_COUNT: z.number().or(z.string().transform(Number)).default(1),
  PROVIDER_RETRY_DELAY_MS: z.number().or(z.string().transform(Number)).default(1000),

  // Final results — how many results returned to agent after reranking
  MAX_RESULTS_AFTER_RERANK: z.number().or(z.string().transform(Number)).default(10),

  // Search timeout — total time budget for one search() call
  SEARCH_TIMEOUT_MS: z.number().or(z.string().transform(Number)).default(15000),

  // Budget
  BUDGET_MAX_SEARCHES: z.number().or(z.string().transform(Number)).default(15),
  BUDGET_MAX_FETCHES: z.number().or(z.string().transform(Number)).default(30),
  BUDGET_WINDOW_MINUTES: z.number().or(z.string().transform(Number)).default(30),

  // Cache
  CACHE_MAX_SIZE_MB: z.number().or(z.string().transform(Number)).default(500),
  CACHE_EVICTION_INTERVAL_MIN: z.number().or(z.string().transform(Number)).default(30),
  CACHE_TTL_MINUTES: z.number().or(z.string().transform(Number)).default(1440),

  // Semantic
  SEMANTIC_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true),
  EMBEDDING_MODEL: z.string().default('multilingual-e5-small'),
  EMBEDDING_DIMENSION: z.number().or(z.string().transform(Number)).default(384),
  SEMANTIC_THRESHOLD: z.number().or(z.string().transform(Number)).default(0.92),

  // Intent classification — server-side auto-classifies query intent (github/docs/news/web)
  // when enabled. When disabled, the agent provides `intent` in the search request.
  INTENT_CLASSIFIER_MODEL: z.string().default('Xenova/nli-deberta-v3-xsmall'),

  // Reranking
  RERANK_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true),

  // Providers — Brave Web (HTML scrape, no key)
  BRAVE_WEB_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true),

  // Provider rate limits (requests per window)
  DDG_RPM: z.number().or(z.string().transform(Number)).default(10),
  DDG_RPD: z.number().or(z.string().transform(Number)).default(200),
  DDG_RPMONTH: z.number().or(z.string().transform(Number)).default(6000),
  BING_RPM: z.number().or(z.string().transform(Number)).default(15),
  BING_RPD: z.number().or(z.string().transform(Number)).default(60),
  BING_RPMONTH: z.number().or(z.string().transform(Number)).default(1800),
  STARTPAGE_RPM: z.number().or(z.string().transform(Number)).default(10),
  STARTPAGE_RPD: z.number().or(z.string().transform(Number)).default(200),
  STARTPAGE_RPMONTH: z.number().or(z.string().transform(Number)).default(6000),
  BRAVE_RPM: z.number().or(z.string().transform(Number)).default(15),
  BRAVE_RPD: z.number().or(z.string().transform(Number)).default(60),
  BRAVE_RPMONTH: z.number().or(z.string().transform(Number)).default(2000),
  BRAVE_WEB_RPM: z.number().or(z.string().transform(Number)).default(10),
  BRAVE_WEB_RPD: z.number().or(z.string().transform(Number)).default(100),
  BRAVE_WEB_RPMONTH: z.number().or(z.string().transform(Number)).default(6000),
  TAVILY_RPM: z.number().or(z.string().transform(Number)).default(10),
  TAVILY_RPD: z.number().or(z.string().transform(Number)).default(30),
  TAVILY_RPMONTH: z.number().or(z.string().transform(Number)).default(1000),
  EXA_RPM: z.number().or(z.string().transform(Number)).default(10),
  EXA_RPD: z.number().or(z.string().transform(Number)).default(30),
  EXA_RPMONTH: z.number().or(z.string().transform(Number)).default(1000),
  FIRECRAWL_RPM: z.number().or(z.string().transform(Number)).default(5),
  FIRECRAWL_RPD: z.number().or(z.string().transform(Number)).default(15),
  FIRECRAWL_RPMONTH: z.number().or(z.string().transform(Number)).default(500),
});

export type Config = z.infer<typeof ConfigSchema>;
