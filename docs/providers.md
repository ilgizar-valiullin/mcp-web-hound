# Search Providers

## Overview

Providers work with the router, which selects the first 2 healthy providers and calls them in parallel. Results are aggregated, deduplicated, and reranked. If a provider is unavailable — fallback to the next ones.

## Tier 1 — Core (free, scraping)

### DuckDuckGo

| Parameter | Value |
|-----------|-------|
| Type | HTML scraping |
| API | POST `html.duckduckgo.com/html/` |
| Limits | 10 req/min (IP-based) |
| Key | Not required |
| Intents | web, docs |

**Features:**
- Free, no registration
- 10 results per page, up to 2 pages = 20 raw results
- Rate limit with delay between requests

**Configuration:**
```env
DDG_ENABLED=true
DDG_DELAY_MS=1000
DDG_MAX_PER_MINUTE=10
```

---

### Bing

| Parameter | Value |
|-----------|-------|
| Type | HTML scraping |
| API | GET `bing.com/search` |
| Limits | Implicit (IP-based) |
| Key | Not required |
| Intents | web |

**Features:**
- Free, no registration
- Parses `b_algo` blocks from HTML results page
- Different index from DDG — expands coverage

**Configuration:**
```env
BING_ENABLED=true
```

---

### SearXNG

| Parameter | Value |
|-----------|-------|
| Type | Self-hosted metasearch engine |
| API | REST JSON API |
| Limits | Unlimited (your own server) |
| Key | Not required |
| Intents | web, docs, news |

**Features:**
- Full control, no rate limits
- Aggregates Google, Bing, DuckDuckGo, and others
- Requires a deployed instance

**Configuration:**
```env
SEARXNG_ENABLED=true
SEARXNG_URL=http://localhost:8888
SEARXNG_ENGINES=google,bing,duckduckgo,stackoverflow
```

---

## Tier 2 — Official APIs (free tier)

### Brave Search API

| Parameter | Value |
|-----------|-------|
| Type | Official REST API |
| Limits | 2000 requests/month (free) |
| Key | Required (free registration) |
| Intents | web, docs, news |

**Configuration:**
```env
BRAVE_API_KEY=BSA...
BRAVE_DAILY_LIMIT=60
```

---

### Tavily API

| Parameter | Value |
|-----------|-------|
| Type | AI-oriented search |
| Limits | 1000 requests/month (free) |
| Key | Required (free registration) |
| Intents | web, docs |

**Features:**
- Built specifically for AI agents
- Returns `content` (extracted text) out of the box
- Works well for docs intent

**Configuration:**
```env
TAVILY_API_KEY=tvly-...
TAVILY_DAILY_LIMIT=30
```

---

## Tier 3 — Optional

### Exa

| Parameter | Value |
|-----------|-------|
| Type | Semantic search |
| Limits | 1000 requests/month (free) |
| Key | Required |
| Intents | web, docs |

```env
EXA_API_KEY=...
```

### Firecrawl

| Parameter | Value |
|-----------|-------|
| Type | Web scraping + search |
| Limits | 500 credits/month (free) |
| Key | Required |
| API | `api.firecrawl.dev/v2/search` |
| Intents | docs |

```env
FIRECRAWL_API_KEY=...
```

---

## Provider Router: selection algorithm

```mermaid
flowchart TD
    START["Incoming Query"] --> HEALTH["Check health for first 2 providers"]
    HEALTH --> PARALLEL["Call 2 healthy providers in parallel"]
    PARALLEL --> MERGE["Merge + deduplicate results"]
    MERGE --> RERANK["Rerank by relevance score"]
    RERANK --> RETURN["Return top-N to orchestrator"]
    
    HEALTH -->|"Fewer than 2 healthy"| FALLBACK["Use what's available"]
    FALLBACK --> PARALLEL
    
    PARALLEL -->|"All failed"| FAIL["Return error: all providers failed"]
```

## Routing Strategy

**Parallel request to 2 providers:**
1. Find the first 2 healthy providers in order
2. Call them in parallel via `Promise.allSettled`
3. Aggregate results
4. Reranker deduplicates by normalized URL and sorts

**Provider order:** DDG → Bing → SearXNG → Brave → Tavily → Exa → Firecrawl

If one of the two fails — results from the other are still returned. If both fail — error.

## Health Tracking

Each provider tracks:

```typescript
interface ProviderHealth {
  consecutive_errors: number;
  last_success: Date | null;
  last_error: Date | null;
  avg_latency_ms: number;
  requests_today: number;
  is_healthy: boolean;
}
```

**Provider is unhealthy if:**
- `consecutive_errors >= 3`

**Recovery:** an unhealthy provider gets a trial attempt on the next cycle. If successful — it recovers.
