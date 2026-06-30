import { z } from 'zod';

/**
 * Shared Types for MCP Web Hound Server
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
// The single source for all configuration.
// Add `.describe()` to user-facing fields for automatic docs/help/logging.

export const ConfigSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
    .describe('Logging verbosity'),
  DATA_DIR: z.string().default('./data')
    .describe('Directory for cache database (relative paths resolve from CWD)'),
  DB_FILENAME: z.string().default('search.db')
    .describe('SQLite database file name inside DATA_DIR'),

  // --- Providers (free, no key) ---
  DDG_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true)
    .describe('Enable DuckDuckGo search (free, no key)'),
  BING_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true)
    .describe('Enable Bing search (free, no key)'),
  STARTPAGE_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true)
    .describe('Enable Startpage / Google mirror (free, no key)'),
  BRAVE_WEB_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true)
    .describe('Enable Brave Web HTML scrape (free, no key)'),

  // --- API keys (premium providers) ---
  BRAVE_API_KEY: z.string().optional()
    .describe('API key for Brave Search API (2000 queries/month free)'),
  BRAVE_DAILY_LIMIT: z.number().or(z.string().transform(Number)).default(60)
    .describe('Max Brave Search API queries per day'),
  TAVILY_API_KEY: z.string().optional()
    .describe('API key for Tavily Search (1000 queries/month free)'),
  TAVILY_DAILY_LIMIT: z.number().or(z.string().transform(Number)).default(30)
    .describe('Max Tavily queries per day'),
  EXA_API_KEY: z.string().optional()
    .describe('API key for Exa Search (trial 1000 queries)'),
  FIRECRAWL_API_KEY: z.string().optional()
    .describe('API key for Firecrawl (trial 500 credits)'),

  // --- Tokens ---
  GITHUB_TOKEN: z.string().optional()
    .describe('GitHub personal access token (optional, 60 req/hr without)'),
  GITLAB_TOKEN: z.string().optional()
    .describe('GitLab personal access token with read_api scope'),

  // --- Behavior ---
  PROVIDER_ORDER: z.string().default('startpage,ddg,brave_web,bing,brave_api,tavily,exa,firecrawl')
    .describe('Comma-separated provider priority list (tried top to bottom)'),
  MAX_PARALLEL_PROVIDERS: z.number().or(z.string().transform(Number)).default(2)
    .describe('Max providers to query simultaneously'),
  PROVIDER_EXECUTION_MODE: z.enum(['parallel', 'sequential']).default('parallel')
    .describe('Run providers in parallel or fall through one by one'),
  MAX_RESULTS_AFTER_RERANK: z.number().or(z.string().transform(Number)).default(10)
    .describe('Max results returned after reranking'),
  SEARCH_TIMEOUT_MS: z.number().or(z.string().transform(Number)).default(15000)
    .describe('Per-provider search timeout in milliseconds'),

  // --- Budget limits ---
  BUDGET_MAX_SEARCHES: z.number().or(z.string().transform(Number)).default(15)
    .describe('Max searches allowed per budget window'),
  BUDGET_MAX_FETCHES: z.number().or(z.string().transform(Number)).default(30)
    .describe('Max page fetches allowed per budget window'),
  BUDGET_WINDOW_MINUTES: z.number().or(z.string().transform(Number)).default(30)
    .describe('Budget window duration in minutes'),

  // --- Cache ---
  CACHE_MAX_SIZE_MB: z.number().or(z.string().transform(Number)).default(500)
    .describe('Max cache database size in MB (0 = unlimited)'),
  CACHE_EVICTION_INTERVAL_MIN: z.number().or(z.string().transform(Number)).default(30)
    .describe('Interval between automatic cache size checks (minutes)'),
  CACHE_TTL_MINUTES: z.number().or(z.string().transform(Number)).default(1440)
    .describe('Cache entry time-to-live in minutes (1440 = 24h)'),

  // --- Features ---
  SEMANTIC_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true)
    .describe('Enable semantic search with embeddings (~120MB model download)'),
  EMBEDDING_MODEL: z.string().default('multilingual-e5-small')
    .describe('HuggingFace model for text embeddings'),
  EMBEDDING_DIMENSION: z.number().or(z.string().transform(Number)).default(384)
    .describe('Embedding vector dimension (must match model output)'),
  SEMANTIC_THRESHOLD: z.number().or(z.string().transform(Number)).default(0.92)
    .describe('Cosine similarity threshold for semantic dedup'),
  INTENT_CLASSIFIER_MODEL: z.string().default('Xenova/nli-deberta-v3-xsmall')
    .describe('HuggingFace model for NLI-based intent classification'),
  RERANK_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true)
    .describe('Enable cross-encoder reranking for result relevance'),
  SEARCH_LOG_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(false)
    .describe('Log search queries, candidates, and reranker scores for ML training dataset'),

  // --- Session ---
  SESSION_DEDUP_WINDOW_MINUTES: z.number().or(z.string().transform(Number)).default(5)
    .describe('Window in minutes for deduplicating identical queries'),
  SESSION_DEDUP_STRETCH_MINUTES: z.number().or(z.string().transform(Number)).default(0)
    .describe('Extra minutes to extend dedup window on new activity'),

  // --- Provider tuning ---
  DDG_DELAY_MS: z.number().or(z.string().transform(Number)).default(1000)
    .describe('Delay between DuckDuckGo requests in milliseconds'),
  DDG_MAX_PER_MINUTE: z.number().or(z.string().transform(Number)).default(10)
    .describe('Max DuckDuckGo requests per minute'),
  DDG_RESULTS_PER_PAGE: z.number().or(z.string().transform(Number)).default(10)
    .describe('DuckDuckGo results per page'),
  DDG_MAX_PAGES: z.number().or(z.string().transform(Number)).default(1)
    .describe('Max DuckDuckGo pages to scrape'),
  BING_RESULTS_PER_PAGE: z.number().or(z.string().transform(Number)).default(10)
    .describe('Bing results per page'),
  BING_MAX_PAGES: z.number().or(z.string().transform(Number)).default(1)
    .describe('Max Bing pages to scrape'),

  // --- Per-provider rate limits ---
  DDG_RPM: z.number().or(z.string().transform(Number)).default(10)
    .describe('DuckDuckGo max requests per minute'),
  DDG_RPD: z.number().or(z.string().transform(Number)).default(200)
    .describe('DuckDuckGo max requests per day'),
  DDG_RPMONTH: z.number().or(z.string().transform(Number)).default(6000)
    .describe('DuckDuckGo max requests per month'),
  BING_RPM: z.number().or(z.string().transform(Number)).default(15)
    .describe('Bing max requests per minute'),
  BING_RPD: z.number().or(z.string().transform(Number)).default(60)
    .describe('Bing max requests per day'),
  BING_RPMONTH: z.number().or(z.string().transform(Number)).default(1800)
    .describe('Bing max requests per month'),
  STARTPAGE_RPM: z.number().or(z.string().transform(Number)).default(10)
    .describe('Startpage max requests per minute'),
  STARTPAGE_RPD: z.number().or(z.string().transform(Number)).default(200)
    .describe('Startpage max requests per day'),
  STARTPAGE_RPMONTH: z.number().or(z.string().transform(Number)).default(6000)
    .describe('Startpage max requests per month'),
  BRAVE_RPM: z.number().or(z.string().transform(Number)).default(15)
    .describe('Brave Search API max requests per minute'),
  BRAVE_RPD: z.number().or(z.string().transform(Number)).default(60)
    .describe('Brave Search API max requests per day'),
  BRAVE_RPMONTH: z.number().or(z.string().transform(Number)).default(2000)
    .describe('Brave Search API max requests per month'),
  BRAVE_WEB_RPM: z.number().or(z.string().transform(Number)).default(10)
    .describe('Brave Web scrape max requests per minute'),
  BRAVE_WEB_RPD: z.number().or(z.string().transform(Number)).default(100)
    .describe('Brave Web scrape max requests per day'),
  BRAVE_WEB_RPMONTH: z.number().or(z.string().transform(Number)).default(6000)
    .describe('Brave Web scrape max requests per month'),
  TAVILY_RPM: z.number().or(z.string().transform(Number)).default(10)
    .describe('Tavily max requests per minute'),
  TAVILY_RPD: z.number().or(z.string().transform(Number)).default(30)
    .describe('Tavily max requests per day'),
  TAVILY_RPMONTH: z.number().or(z.string().transform(Number)).default(1000)
    .describe('Tavily max requests per month'),
  EXA_RPM: z.number().or(z.string().transform(Number)).default(10)
    .describe('Exa max requests per minute'),
  EXA_RPD: z.number().or(z.string().transform(Number)).default(30)
    .describe('Exa max requests per day'),
  EXA_RPMONTH: z.number().or(z.string().transform(Number)).default(1000)
    .describe('Exa max requests per month'),
  FIRECRAWL_RPM: z.number().or(z.string().transform(Number)).default(5)
    .describe('Firecrawl max requests per minute'),
  FIRECRAWL_RPD: z.number().or(z.string().transform(Number)).default(15)
    .describe('Firecrawl max requests per day'),
  FIRECRAWL_RPMONTH: z.number().or(z.string().transform(Number)).default(500)
    .describe('Firecrawl max requests per month'),
});

export type Config = z.infer<typeof ConfigSchema>;
