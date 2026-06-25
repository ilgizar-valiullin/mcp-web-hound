# Search MCP Server Architecture

## Pipeline Overview

Each `search()` call goes through a linear pipeline:

```mermaid
flowchart TD
    A["Agent calls search()"] --> B[MCP Transport Layer]
    B --> C[Budget Manager]
    C -->|Budget exceeded| C_ERR[Return budget error]
    C -->|Budget OK| D[Query Normalizer]
    D --> E[Semantic Cache Lookup]
    E -->|Cache HIT| F_CACHED[Return cached results]
    E -->|Cache MISS| F[SQLite Exact Cache]
    F -->|Cache HIT| G_CACHED[Return cached results]
    F -->|Cache MISS| G[Provider Router]
    G --> H1[Tier 1: DuckDuckGo]
    G --> H2[Tier 1: Bing]
    G --> H3[Tier 2: Brave / Tavily]
    G --> H4[Tier 3: Exa / Firecrawl]
    H1 --> I[Result Aggregator]
    H2 --> I
    H3 --> I
    H4 --> I
    I --> J[Reranker]
    J --> K{include_content?}
    K -->|Yes| L[Content Fetcher]
    K -->|No| M[Cache Results]
    L --> M
    M --> N[Return to Agent]
```

## System Layers

### 1. MCP Transport Layer (`src/index.ts`)

Entry point. Registers 4 tools via `@modelcontextprotocol/sdk`: `search`, `github_search`, `gitlab_search`, `status`. Handles JSON-RPC over stdio.

**Responsibilities:**
- Tool registration
- Input validation (zod)
- Response serialization
- Top-level error handling

### 2. Budget Manager (`src/limits/budget-manager.ts`)

First gate. If the task budget is exceeded — immediate rejection without calling providers.

**Responsibilities:**
- Search count in current window
- Page fetch count in current window
- Semantic deduplication of similar queries
- Budget rejection with clear message

### 3. Query Normalizer (`src/search/query-normalizer.ts`)

Normalizes agent queries for better cache hits and more consistent results.

**Responsibilities:**
- Lowercase conversion
- Whitespace and special character cleanup
- Abbreviation expansion (optional)
- Stable cache key generation

### 4. Semantic Cache (`src/cache/semantic-cache.ts`)

Looks for semantically similar queries with cached results.

**Responsibilities:**
- Query embedding computation
- Nearest neighbor search in sqlite-vec
- Configurable similarity threshold (default 0.92)
- Return cached results for similar query

### 5. SQLite Exact Cache (`src/cache/sqlite.ts`)

Exact-match cache using normalized cache keys.

**Responsibilities:**
- Store queries, results, pages
- TTL-based eviction
- Stats for status() tool

### 6. Provider Router (`src/search/provider-router.ts`)

Selects providers and manages fallback logic.

**Responsibilities:**
- Health-based provider selection
- Parallel request to 2 healthy providers
- Provider health tracking
- Rate limit enforcement

### 7. Search Providers (`src/search/providers/`)

Adapters for specific search engines. All implement the `SearchProvider` interface.

### 8. Reranker (`src/search/reranker.ts`)

Final ranking of aggregated results.

**Responsibilities:**
- Semantic similarity scoring
- Domain quality scoring
- Freshness scoring
- Position blending

### 9. Content Fetcher (`src/fetch/`)

Optional layer for downloading and cleaning web pages.

**Responsibilities:**
- HTTP GET with retry and timeout
- HTML → Markdown (readability + turndown)
- Content truncation by max length
- SQLite page caching

## Data Flow

### Normal Search (cache miss)

```mermaid
sequenceDiagram
    participant Agent
    participant MCP as MCP Server
    participant BM as Budget Manager
    participant QN as Query Normalizer
    participant SC as Semantic Cache
    participant EC as Exact Cache
    participant PR as Provider Router
    participant SP as Search Provider
    participant RR as Reranker

    Agent->>MCP: search({ query: "react hooks tutorial" })
    MCP->>BM: checkBudget()
    BM-->>MCP: OK (8/15 searches used)
    MCP->>QN: normalize("react hooks tutorial")
    QN-->>MCP: { normalized: "react hooks tutorial", key: "abc123" }
    MCP->>SC: findSimilar(embedding)
    SC-->>MCP: null (no similar query)
    MCP->>EC: get("abc123")
    EC-->>MCP: null (cache miss)
    MCP->>PR: search(query, intent, freshness)
    PR->>SP: search(query)
    SP-->>PR: results[]
    PR-->>MCP: results[]
    MCP->>RR: rerank(results, queryEmbedding)
    RR-->>MCP: rankedResults[]
    MCP->>EC: set("abc123", rankedResults)
    MCP->>SC: index(embedding, "abc123")
    MCP-->>Agent: { results: [...], meta: { cached: false } }
```

### Semantic Cache Hit

```mermaid
sequenceDiagram
    participant Agent
    participant MCP as MCP Server
    participant SC as Semantic Cache
    participant EC as Exact Cache

    Agent->>MCP: search({ query: "react hooks guide" })
    Note over MCP: Normalization, budget OK
    MCP->>SC: findSimilar(embedding)
    SC-->>MCP: similarKey: "abc123" (similarity: 0.96)
    MCP->>EC: get("abc123")
    EC-->>MCP: cachedResults[]
    MCP-->>Agent: { results: [...], meta: { cached: true } }
```

## Data Model

### Core Types

```typescript
interface SearchRequest {
  query: string;
  intent: "web" | "docs" | "github" | "news";
  freshness: "any" | "day" | "week" | "month";
  include_content: boolean;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  source: string;
  published_date?: string;
  relevance_score: number;
}

interface SearchResponse {
  results: SearchResult[];
  meta: SearchMeta;
}

interface SearchMeta {
  total_results: number;
  cached: boolean;
  query_normalized: string;
  search_time_ms: number;
}
```

### Provider Interface

```typescript
interface SearchProvider {
  name: string;
  tier: 1 | 2 | 3;

  search(query: string, options: ProviderOptions): Promise<ProviderResult[]>;
  healthCheck(): Promise<boolean>;

  getStats(): ProviderStats;
}

interface ProviderOptions {
  intent: string;
  freshness: string;
  max_results: number;  // internal, set by orchestrator
}

interface ProviderResult {
  title: string;
  url: string;
  snippet: string;
  published_date?: string;
  raw_position: number;
  provider: string;
}

interface ProviderStats {
  requests_today: number;
  limit_today: number | null;
  avg_latency_ms: number;
  last_error?: string;
  healthy: boolean;
}
```

## Principles

1. **Agent Ignorance** — agent does not see provider internals
2. **Graceful Degradation** — if Tier 1 fails, fallback to Tier 2/3
3. **Cache First** — semantic → exact → provider
4. **Budget Safety** — hard limits on searches and fetches
5. **Cache First** — semantic → exact → provider
