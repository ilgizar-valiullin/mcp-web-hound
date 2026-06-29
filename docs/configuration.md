# Configuration

## Config model

Config is split across two `.env` files:

| Tier | File | Purpose |
|------|------|---------|
| **Server** | `~/.config/mcp-web-hound/.env` | Main config — written by `mcp-web-hound-configure` |
| **Project** | `<cwd>/.env` | Optional per-folder overrides (individual keys only) |

**AI agent rule:** Agents MUST write config ONLY to the server `.env` via
`npx mcp-web-hound-configure --json set`. NEVER write to a project's `.env`.

## Configure tool

```bash
npx mcp-web-hound-configure                  # Interactive TUI
npx mcp-web-hound-configure --json get       # Machine-readable list of all 64 fields
npx mcp-web-hound-configure --json set KEY=VALUE    # Set one or more values
npx mcp-web-hound-configure --help                 # Full help
```

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
| `PROVIDER_ORDER` | `startpage,ddg,brave_web,bing,brave_api,tavily,exa,firecrawl` | Priority order (comma-separated) |
| `PROVIDER_EXECUTION_MODE` | `parallel` | `parallel` or `sequential` |
| `MAX_PARALLEL_PROVIDERS` | `2` | How many providers to call concurrently (parallel mode) |

### Startpage (Tier 1 — Google mirror, scrape, free)

| Variable | Default | Description |
|----------|---------|-------------|
| `STARTPAGE_ENABLED` | `true` | Enable Startpage |

### DuckDuckGo (Tier 1 — scrape, free)

| Variable | Default | Description |
|----------|---------|-------------|
| `DDG_ENABLED` | `true` | Enable DuckDuckGo |
| `DDG_DELAY_MS` | `1000` | Delay between DDG requests (ms) |
| `DDG_MAX_PER_MINUTE` | `10` | Max DDG requests per minute |
| `DDG_RESULTS_PER_PAGE` | `10` | Results per page (DDG returns 10) |
| `DDG_MAX_PAGES` | `1` | Max pages to scrape |

### Brave Web (Tier 1 — scrape, free)

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAVE_WEB_ENABLED` | `true` | Enable Brave Web scrape |

### Bing (Tier 1 — scrape, free)

| Variable | Default | Description |
|----------|---------|-------------|
| `BING_ENABLED` | `true` | Enable Bing |
| `BING_RESULTS_PER_PAGE` | `10` | Results per page |
| `BING_MAX_PAGES` | `1` | Max pages to scrape |

### Brave API (Tier 2 — API key)

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

### Intent Classification & Reranking

| Variable | Default | Description |
|----------|---------|-------------|
| `INTENT_CLASSIFIER_MODEL` | `Xenova/nli-deberta-v3-xsmall` | NLI model for intent classification + reranking (177M params, ONNX) |

The classifier runs automatically on every search query — no `intent` parameter needed. The same NLI model scores each result's relevance for reranking. See [reranking.md](reranking.md).

### Reranking

| Variable | Default | Description |
|----------|---------|-------------|
| `RERANK_ENABLED` | `true` | Enable reranking |

Results are scored as `0.9 * NLI(query, snippet) + 0.04 * domain + 0.03 * freshness + 0.03 * position`.  
The NLI model is shared with intent classification — no separate config needed.

---

On startup, the server validates:

1. **At least one provider available** — based on `PROVIDER_ORDER` and individual enable/API-key guards
2. **API key format** — if provided, checks key format
3. **DATA_DIR exists** — created if missing
4. **SQLite works** — test query on startup
5. **Embedding model** — loaded if `SEMANTIC_ENABLED=true`

On critical errors: `process.exit(1)` with a clear message.
