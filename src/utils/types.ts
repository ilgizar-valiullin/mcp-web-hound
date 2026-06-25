import { z } from 'zod';

/**
 * Shared Types for Search MCP Server
 */

// --- Input Schemas ---

export const SearchRequestSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  intent: z.enum(["web", "docs", "github", "news"]).default("web"),
  freshness: z.enum(["any", "day", "week", "month"]).default("any"),
  max_results: z.number().int().min(1).max(30).default(10),
  include_content: z.boolean().default(false),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

// --- Search Models ---

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
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
  requests_today: number;
  limit_today: number | null;
  avg_latency_ms: number;
  last_error?: string;
  healthy: boolean;
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

  // Tier 1: SearXNG
  SEARXNG_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(false),
  SEARXNG_URL: z.string().url().optional(),
  SEARXNG_ENGINES: z.string().default('google,bing,duckduckgo,stackoverflow'),

  // Tier 1: DuckDuckGo
  DDG_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true),
  DDG_DELAY_MS: z.number().or(z.string().transform(Number)).default(1000),
  DDG_MAX_PER_MINUTE: z.number().or(z.string().transform(Number)).default(10),

  // Tier 1: Bing
  BING_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(false),

  // Tier 2: Brave
  BRAVE_API_KEY: z.string().optional(),
  BRAVE_DAILY_LIMIT: z.number().or(z.string().transform(Number)).default(60),

  // Tier 2: Tavily
  TAVILY_API_KEY: z.string().optional(),
  TAVILY_DAILY_LIMIT: z.number().or(z.string().transform(Number)).default(30),

  // Tier 3
  EXA_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),

  // GitHub Search API (optional, without token: 60 req/hr)
  GITHUB_TOKEN: z.string().optional(),

  // GitLab Search API (optional)
  GITLAB_TOKEN: z.string().optional(),

  // Budget
  BUDGET_MAX_SEARCHES: z.number().or(z.string().transform(Number)).default(15),
  BUDGET_MAX_FETCHES: z.number().or(z.string().transform(Number)).default(30),
  BUDGET_WINDOW_MINUTES: z.number().or(z.string().transform(Number)).default(30),

  // Cache
  CACHE_MAX_SIZE_MB: z.number().or(z.string().transform(Number)).default(500),
  CACHE_EVICTION_INTERVAL_MIN: z.number().or(z.string().transform(Number)).default(30),

  // Semantic
  SEMANTIC_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(false),
  EMBEDDING_MODEL: z.string().default('multilingual-e5-small'),
  EMBEDDING_DIMENSION: z.number().or(z.string().transform(Number)).default(384),
  SEMANTIC_THRESHOLD: z.number().or(z.string().transform(Number)).default(0.92),

  // Fetch
  FETCH_TIMEOUT_MS: z.number().or(z.string().transform(Number)).default(10000),
  FETCH_MAX_RETRIES: z.number().or(z.string().transform(Number)).default(2),
  FETCH_MAX_BODY_SIZE: z.number().or(z.string().transform(Number)).default(5242880),
  FETCH_CONCURRENT_LIMIT: z.number().or(z.string().transform(Number)).default(3),
  FETCH_USER_AGENT: z.string().default('SearchMCP/1.0'),
  CONTENT_MAX_LENGTH: z.number().or(z.string().transform(Number)).default(8000),

  // Reranking
  RERANK_ENABLED: z.boolean().or(z.string().transform(v => v === 'true')).default(true),
  RERANK_WEIGHT_SEMANTIC: z.number().or(z.string().transform(Number)).default(0.35),
  RERANK_WEIGHT_DOMAIN: z.number().or(z.string().transform(Number)).default(0.30),
  RERANK_WEIGHT_FRESHNESS: z.number().or(z.string().transform(Number)).default(0.15),
  RERANK_WEIGHT_POSITION: z.number().or(z.string().transform(Number)).default(0.20),
});

export type Config = z.infer<typeof ConfigSchema>;
