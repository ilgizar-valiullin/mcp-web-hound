# Configuration

## Environment Variables

All settings via `.env` file or environment variables.

### General

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
| `DATA_DIR` | `./data` | SQLite database directory |
| `DB_FILENAME` | `search.db` | Database file name |

### Provider Order & Execution

| Variable | Default | Description |
|----------|---------|-------------|
| `PROVIDER_ORDER` | `ddg,bing,brave,tavily,exa,firecrawl` | Priority order (comma-separated) |
| `PROVIDER_EXECUTION_MODE` | `parallel` | `parallel` or `sequential` |
| `MAX_PARALLEL_PROVIDERS` | `2` | How many providers to call concurrently (parallel mode) |

### DuckDuckGo (Tier 1 — scrape, free)

| Variable | Default | Description |
|----------|---------|-------------|
| `DDG_ENABLED` | `true` | Enable DuckDuckGo |
| `DDG_DELAY_MS` | `1000` | Delay between DDG requests (ms) |
| `DDG_MAX_PER_MINUTE` | `10` | Max DDG requests per minute |
| `DDG_RESULTS_PER_PAGE` | `10` | Results per page (DDG returns 10) |
| `DDG_MAX_PAGES` | `2` | Max pages to scrape (up to 20 raw results) |

### Bing (Tier 1 — scrape, free)

| Variable | Default | Description |
|----------|---------|-------------|
| `BING_ENABLED` | `false` | Enable Bing |
| `BING_RESULTS_PER_PAGE` | `10` | Results per page |
| `BING_MAX_PAGES` | `1` | Max pages to scrape |

### Brave (Tier 2 — API)

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAVE_API_KEY` | — | Brave Search API key |
| `BRAVE_DAILY_LIMIT` | `60` | Daily request limit |
| `BRAVE_MAX_RESULTS` | `10` | Max raw results |

### Tavily (Tier 2 — API)

| Variable | Default | Description |
|----------|---------|-------------|
| `TAVILY_API_KEY` | — | Tavily API key |
| `TAVILY_DAILY_LIMIT` | `30` | Daily request limit |
| `TAVILY_MAX_RESULTS` | `10` | Max raw results |

### Exa (Tier 3 — API)

| Variable | Default | Description |
|----------|---------|-------------|
| `EXA_API_KEY` | — | Exa API key |
| `EXA_MAX_RESULTS` | `10` | Max raw results |

### Firecrawl (Tier 3 — API)

| Variable | Default | Description |
|----------|---------|-------------|
| `FIRECRAWL_API_KEY` | — | Firecrawl API key |
| `FIRECRAWL_MAX_RESULTS` | `10` | Max raw results |

### Search & Output

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_TIMEOUT_MS` | `15000` | Max time for one search() call (ms) |
| `MAX_RESULTS_AFTER_RERANK` | `10` | Final results returned to agent after reranking |

### Budget (agent protection)

| Variable | Default | Description |
|----------|---------|-------------|
| `BUDGET_MAX_SEARCHES` | `15` | Max search queries per window |
| `BUDGET_MAX_FETCHES` | `30` | Max page fetches per window |
| `BUDGET_WINDOW_MINUTES` | `30` | Sliding window size (min) |

### Caching

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_MAX_SIZE_MB` | `500` | Max SQLite database size (MB) |
| `CACHE_EVICTION_INTERVAL_MIN` | `30` | Eviction check interval (min) |
| `CACHE_TTL_MINUTES` | `1440` | Default cache TTL (min, 24h) |

### Semantic Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `SEMANTIC_ENABLED` | `false` | Enable semantic cache (requires ~120MB model) |
| `EMBEDDING_MODEL` | `multilingual-e5-small` | Embedding model name |
| `EMBEDDING_DIMENSION` | `384` | Vector dimension |
| `SEMANTIC_THRESHOLD` | `0.92` | Similarity threshold for cache hit |
| `INTENT_CLASSIFICATION_ENABLED` | `true` | Auto-classify query intent (github/docs/news/web) via embedding zero-shot with confidence + ambiguity gates. When disabled, agent controls `intent` |

### Fetch Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `FETCH_TIMEOUT_MS` | `10000` | Fetch timeout (ms) |
| `FETCH_MAX_RETRIES` | `2` | Max retries per URL |
| `FETCH_MAX_BODY_SIZE` | `5242880` | Max response size (bytes, 5MB) |
| `FETCH_CONCURRENT_LIMIT` | `3` | Concurrent fetches |
| `FETCH_USER_AGENT` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36` | User-Agent header |
| `CONTENT_MAX_LENGTH` | `8000` | Max content length (chars) |

### Reranking

| Variable | Default | Description |
|----------|---------|-------------|
| `RERANK_ENABLED` | `true` | Enable reranking |
| `RERANK_WEIGHT_SEMANTIC` | `0.35` | Semantic similarity weight |
| `RERANK_WEIGHT_DOMAIN` | `0.30` | Domain quality weight |
| `RERANK_WEIGHT_FRESHNESS` | `0.15` | Freshness weight |
| `RERANK_WEIGHT_POSITION` | `0.20` | Position weight |

---

## Validation

On startup, the server validates:

1. **At least one provider available** — based on `PROVIDER_ORDER` and individual enable/API-key guards
2. **API key format** — if provided, checks key format
3. **DATA_DIR exists** — created if missing
4. **SQLite works** — test query on startup
5. **Embedding model** — loaded if `SEMANTIC_ENABLED=true`

On critical errors: `process.exit(1)` with a clear message.
