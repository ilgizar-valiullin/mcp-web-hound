# Configuration

## Environment Variables

All settings via `.env` file or environment variables.

### General

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
| `DATA_DIR` | `./data` | SQLite database directory |
| `DB_FILENAME` | `search.db` | Database file name |

### Providers — Tier 1

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARXNG_URL` | — | SearXNG instance URL |
| `SEARXNG_ENGINES` | `google,bing,duckduckgo` | SearXNG engines (comma-separated) |
| `DDG_ENABLED` | `true` | Enable DuckDuckGo |
| `DDG_DELAY_MS` | `1000` | Delay between DDG requests (ms) |
| `DDG_MAX_PER_MINUTE` | `10` | Max DDG requests per minute |

### Providers — Tier 2

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAVE_API_KEY` | — | Brave Search API key |
| `BRAVE_DAILY_LIMIT` | `60` | Daily request limit |
| `TAVILY_API_KEY` | — | Tavily API key |
| `TAVILY_DAILY_LIMIT` | `30` | Daily request limit |

### Providers — Tier 3

| Variable | Default | Description |
|----------|---------|-------------|
| `EXA_API_KEY` | — | Exa API key |
| `FIRECRAWL_API_KEY` | — | Firecrawl API key |

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
| `CACHE_EVICTION_INTERVAL_MIN` | `30` | Eviction interval (min) |

### Semantic Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_MODEL` | `multilingual-e5-small` | Embedding model |
| `EMBEDDING_DIMENSION` | `384` | Vector dimension |
| `SEMANTIC_THRESHOLD` | `0.92` | Similarity threshold for cache hit |
| `SEMANTIC_ENABLED` | `false` | Enable semantic cache (V2) |

### Fetch Layer

| Variable | Default | Description |
|----------|---------|-------------|
| `FETCH_TIMEOUT_MS` | `10000` | Fetch timeout (ms) |
| `FETCH_MAX_RETRIES` | `2` | Max retries |
| `FETCH_MAX_BODY_SIZE` | `5242880` | Max response size (bytes, 5MB) |
| `FETCH_CONCURRENT_LIMIT` | `3` | Concurrent fetches |
| `FETCH_USER_AGENT` | `SearchMCP/1.0` | User-Agent header |
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

## Example `.env`

```env
# === General ===
LOG_LEVEL=info
DATA_DIR=./data

# === Tier 1: SearXNG ===
SEARXNG_URL=http://localhost:8888
SEARXNG_ENGINES=google,bing,duckduckgo,stackoverflow

# === Tier 1: DuckDuckGo ===
DDG_ENABLED=true
DDG_DELAY_MS=1000

# === Tier 2: Brave ===
BRAVE_API_KEY=
BRAVE_DAILY_LIMIT=60

# === Tier 2: Tavily ===
TAVILY_API_KEY=
TAVILY_DAILY_LIMIT=30

# === Tier 3 (optional) ===
EXA_API_KEY=
FIRECRAWL_API_KEY=

# === Budget ===
BUDGET_MAX_SEARCHES=15
BUDGET_MAX_FETCHES=30
BUDGET_WINDOW_MINUTES=30

# === Cache ===
CACHE_MAX_SIZE_MB=500

# === Semantic (V2) ===
SEMANTIC_ENABLED=false
EMBEDDING_MODEL=multilingual-e5-small
SEMANTIC_THRESHOLD=0.92

# === Fetch ===
FETCH_TIMEOUT_MS=10000
FETCH_CONCURRENT_LIMIT=3
CONTENT_MAX_LENGTH=8000

# === Reranking ===
RERANK_ENABLED=true
```

## Validation

On startup, the server validates:

1. **At least one provider available** — `DDG_ENABLED=true`, `SEARXNG_URL`, etc.
2. **API key format** — if provided, checks key format
3. **DATA_DIR exists** — created if missing
4. **SQLite works** — test query on startup
5. **Embedding model** — loaded if `SEMANTIC_ENABLED=true`

On critical errors: `process.exit(1)` with a clear message.
