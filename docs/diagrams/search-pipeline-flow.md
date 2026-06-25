# Search Pipeline Flow

## Main Search Flow

```mermaid
flowchart TD
    A["Agent: search(query, intent?, freshness?, include_content?)"] --> B[MCP Transport Layer]
    B --> C[Validate Input - zod]
    C --> D[Budget Manager: checkBudget]
    D -->|Exceeded| D_ERR["Return error: BUDGET_EXCEEDED"]
    D -->|OK| E[Query Normalizer]
    E --> F["Generate cache_key + normalized query"]

    F --> G{Semantic Enabled?}
    G -->|Yes| H[Compute embedding]
    H --> I[Semantic Cache: findSimilar]
    I -->|"similarity >= 0.92"| J[Semantic HIT]
    J --> K[Load results from SQLite by matched key]
    I -->|"similarity < 0.92"| L[Exact Cache lookup]
    G -->|No| L

    L --> M{cache_key in SQLite?}
    M -->|HIT and not expired| N[Return cached results]
    M -->|MISS or expired| O[Provider Router]

    O --> P["Select N healthy providers (parallel / sequential per config)"]
    P --> Q1["DuckDuckGo"]
    P --> Q2["Bing"]
    P --> Q3["Brave / Tavily (if keys)"]
    P --> Q4["Exa / Firecrawl (if keys)"]

    Q1 -->|Success| R[Raw results]
    Q2 -->|Success| R
    Q3 -->|Success| R
    Q4 -->|Success| R
    Q1 -->|Fail| Q2
    Q2 -->|Fail| Q3
    Q3 -->|Fail| Q4
    Q4 -->|Fail| ERR["Return error: ALL_PROVIDERS_FAILED"]

    R --> S[Deduplicate by URL]
    S --> T[Reranker]
    T --> U["Score = w1*semantic + w2*domain + w3*freshness + w4*position"]
    U --> V[Sort by final_score DESC]
    V --> W[Truncate to MAX_RESULTS_AFTER_RERANK]

    W --> X{include_content?}
    X -->|No| Y[Save to caches]
    X -->|Yes| Z[Content Fetcher]
    Z --> Z1[For each URL: check page cache]
    Z1 -->|Cached| Z2[Use cached markdown]
    Z1 -->|Not cached| Z3[HTTP GET with retry]
    Z3 --> Z4[Readability extract]
    Z4 --> Z5[Turndown HTML to Markdown]
    Z5 --> Z6[Truncate to max length]
    Z6 --> Z7[Save to page cache]
    Z7 --> Z2
    Z2 --> Y

    Y --> AA[Record budget usage]
    AA --> AB["Return SearchResponse to Agent"]

    K --> AB
    N --> AB
```

## Status Flow

```mermaid
flowchart TD
    A["Agent: status()"] --> B[MCP Transport Layer]
    B --> C[Collect provider stats]
    C --> D[Collect cache stats from SQLite]
    D --> E[Collect budget state]
    E --> F[Collect embedding model info]
    F --> G[Calculate uptime]
    G --> H["Return StatusResponse to Agent"]
```

## Provider Health Recovery

```mermaid
stateDiagram-v2
    [*] --> Healthy
    Healthy --> Degraded: 1 error
    Degraded --> Healthy: successful request
    Degraded --> Unhealthy: 3 consecutive errors OR latency > 10s
    Unhealthy --> ProbeTrial: after 5 minutes
    ProbeTrial --> Healthy: probe succeeds
    ProbeTrial --> Unhealthy: probe fails
    Unhealthy --> Healthy: manual reset via status tool
```
