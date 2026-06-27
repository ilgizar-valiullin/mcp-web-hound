# Search Pipeline Flow

## Main Search Flow

```mermaid
flowchart TD
    A["Agent: search(query)"] --> B[MCP Transport Layer]
    B --> C[Validate Input - zod]
    C --> D[Budget Manager: checkBudget]
    D -->|Exceeded| D_ERR["Return error: BUDGET_EXCEEDED"]
    D -->|OK| E[Query Normalizer]
    E --> F["Generate cache_key + normalized query"]

    F --> FC["NLI Zero-Shot(query, 4 labels) → intent"]
    FC --> INTENT_META["Extract language metadata for github intent"]
    INTENT_META --> FR["NLI(query, 1 freshness hypothesis) → requiresFreshness"]
    FR --> FF["intent ∈ {github, docs, news, web} | requiresFreshness ∈ {true, false}"]

    FF --> G{Semantic Enabled?}
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
    P --o PA["ProviderRouter.selectProviders()"]
    PA --> SUSP["RateLimitStore.check() per provider"]
    SUSP -->|Suspended| SKIP["Skip provider, try next"]
    SUSP -->|OK| PRL["RateLimitStore.record() before call"]
    PRL --> PB{Execution mode?}
    PB -->|Parallel| PC1["Startpage (Google mirror)"]
    PB -->|Parallel| PC2["DuckDuckGo"]
    PB -->|Parallel| PC3["Brave Web (scrape)"]
    PB -->|Parallel| PC4["Bing"]
    PB -->|Parallel| PC6["Brave API"]
    PB -->|Parallel| PC7["Tavily"]
    PB -->|Parallel| PC8["Exa"]
    PB -->|Parallel| PC9["Firecrawl"]
    PB -->|Sequential| SD["Ordered by tier, stop on threshold"]

    PC1 & PC2 & PC3 & PC4 & PC5 & PC6 & PC7 & PC8 & PC9 --> R["Raw results"]
    SD --> R

    R --> ERRH{Provider error?}
    ERRH -->|Yes| SUSPEND["RateLimitStore.suspend(provider, reason)"]
    SUSPEND --> REC["Log and continue to next provider"]
    ERRH -->|No| DEDUP

    R --> S[Deduplicate by URL]
    S --> S2["NLI(query, result.snippet) → entailment score (0-1)"]
    S2 --> T["Reranker (with requiresFreshness)"]
    T --> U["Score = 0.9*NLI + 0.04*domain + 0.03*freshness + 0.03*position"]
    U --> V[Sort by final_score DESC]
    V --> W[Truncate to MAX_RESULTS_AFTER_RERANK]

    W --> Y[Save to caches]

    Y --> AA[Record budget usage]
    AA --> AB["Return SearchResponse to Agent"]

    K --> AB
    N --> AB
```

## Rate Limit and Suspension Flow

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Check: ProviderRouter.selectProviders()
    Check --> Suspended: RateLimitStore.check() returns suspension
    Check --> RateLimited: RateLimitStore.check() rate limit exceeded
    Check --> Allowed: Rate limit OK, no suspension

    Allowed --> Record: RateLimitStore.record() before provider call
    Record --> Success: Provider returns results
    Record --> Error: Provider throws
    Error --> Classify: classifyError(message)
    Classify --> SuspendStore: RateLimitStore.suspend(reason, duration)
    SuspendStore --> Suspended: Suspension written to JSON

    Suspended --> Expired: Time passes
    Expired --> Allowed: RateLimitStore stores purge expired entries
    Suspended --> Allowed: Manual or time-based expiry

    RateLimited --> Wait: Budget resets per rolling window
    Wait --> Allowed: Minute/day/month window rolls over
```

## Brave Web HTML Parsing

```mermaid
flowchart TD
    A["fetch(search.brave.com)"] --> B[Raw HTML]
    B --> C["snip loop: /<div.*snippet.*data-pos="(\d+)"/>gi"]
    C --> D[Depth counter: match opening/closing div tags]
    D --> E[Extract snippet block from <div> to matching </div>]
    E --> F[Extract URL: href="https?..." from block]
    E --> G[Extract title: class="...title..." > content </]
    E --> H[Extract snippet: class="...content..." > content </div>]
    H --> I[Strip HTML tags, normalize whitespace]
    E --> J[Extract date: span class="t-secondary" > text - </]
    J --> K{new Date(text) valid?}
    K -->|Yes| L[Set published_date]
    K -->|No| M[Skip date]
    G & F & I & L & M --> N[Deduplicate by URL (seen Set)]
    N --> O[Return results slice(max_results)]
```

## Startpage Search Flow

```mermaid
sequenceDiagram
    participant Agent as Provider
    participant SP as startpage.com
    participant Home as Homepage /

    Agent->>Home: GET / (sc code fetch, 1h cache)
    Home-->>Agent: HTML with <input name="sc" value="...">
    Note over Agent: build N1N-delimited preferences cookie
    Agent->>SP: POST /sp/search (query, sc, cat=web, language)
    SP-->>Agent: HTML with React.createElement(UIStartpage.AppSerpWeb, {...})
    Note over Agent: depth-track JSON extraction<br/>parse render.presenter.regions.mainline[].results[]
    Agent->>Agent: filter web-google / news-bing sections
    Agent->>Agent: extract title, url, snippet, published_date
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


