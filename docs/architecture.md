# Архитектура Search MCP Server

## Обзор Pipeline

Каждый вызов `search()` проходит через линейный pipeline:

```mermaid
flowchart TD
    A["Agent вызывает search()"] --> B[MCP Transport Layer]
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
    G --> H3[Tier 1: SearXNG]
    G --> H4[Tier 2: Brave / Tavily]
    G --> H5[Tier 3: Exa / Firecrawl]
    H1 --> I[Result Aggregator]
    H2 --> I
    H3 --> I
    H4 --> I
    H5 --> I
    I --> J[Reranker]
    J --> K{include_content?}
    K -->|Yes| L[Content Fetcher]
    K -->|No| M[Cache Results]
    L --> M
    M --> N[Return to Agent]
```

## Слои системы

### 1. MCP Transport Layer (`src/index.ts`)

Точка входа. Регистрирует 4 инструмента через `@modelcontextprotocol/sdk`: `search`, `github_search`, `gitlab_search`, `status`. Обрабатывает JSON-RPC через stdio.

**Ответственность:**
- Регистрация инструментов
- Валидация входных параметров (zod)
- Сериализация ответов
- Обработка ошибок верхнего уровня

### 2. Budget Manager (`src/limits/budget-manager.ts`)

Первая проверка. Если лимит задачи исчерпан — мгновенный отказ без обращения к провайдерам.

**Ответственность:**
- Подсчёт запросов в текущем окне
- Подсчёт page fetch в текущем окне
- Дедупликация семантически похожих запросов
- Отказ при превышении бюджета

### 3. Query Normalizer (`src/search/query-normalizer.ts`)

Нормализует запрос агента для лучшего попадания в кэш и более качественной выдачи.

**Ответственность:**
- Приведение к lowercase
- Удаление лишних пробелов и спецсимволов
- Расширение аббревиатур (опционально)
- Генерация стабильного cache key

### 4. Semantic Cache (`src/cache/semantic-cache.ts`)

Ищет семантически похожий запрос, для которого уже есть результаты.

**Ответственность:**
- Вычисление embedding запроса
- Поиск ближайших соседей в sqlite-vec
- Порог similarity (configurable, default 0.92)
- Возврат результатов похожего запроса

### 5. SQLite Exact Cache (`src/cache/sqlite.ts`)

Точный кэш по нормализованному cache key.

**Ответственность:**
- Хранение queries, results, pages
- TTL-based eviction
- Статистика для status()

### 6. Provider Router (`src/search/provider-router.ts`)

Выбирает провайдера и управляет fallback.

**Ответственность:**
- Выбор провайдера на основе health
- Параллельный запрос 2 healthy провайдеров
- Health tracking провайдеров
- Rate limit enforcement

### 7. Search Providers (`src/search/providers/`)

Адаптеры для конкретных поисковых систем. Все реализуют единый интерфейс `SearchProvider`.

### 8. Reranker (`src/search/reranker.ts`)

Финальное ранжирование агрегированных результатов.

**Ответственность:**
- Semantic similarity scoring
- Domain quality scoring
- Freshness scoring
- Position blending

### 9. Content Fetcher (`src/fetch/`)

Опциональный слой. Скачивает и очищает страницы.

**Ответственность:**
- HTTP GET с retry и timeout
- HTML → Markdown (readability + turndown)
- Усечение по max length
- Кэширование в SQLite

## Потоки данных

### Обычный поиск (cache miss)

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
    PR->>SP: SearXNG.search(query)
    SP-->>PR: results[]
    PR-->>MCP: results[]
    MCP->>RR: rerank(results, queryEmbedding)
    RR-->>MCP: rankedResults[]
    MCP->>EC: set("abc123", rankedResults)
    MCP->>SC: index(embedding, "abc123")
    MCP-->>Agent: { results: [...], meta: { cached: false } }
```

### Семантический cache hit

```mermaid
sequenceDiagram
    participant Agent
    participant MCP as MCP Server
    participant SC as Semantic Cache
    participant EC as Exact Cache

    Agent->>MCP: search({ query: "react hooks guide" })
    Note over MCP: Нормализация, budget OK
    MCP->>SC: findSimilar(embedding)
    SC-->>MCP: similarKey: "abc123" (similarity: 0.96)
    MCP->>EC: get("abc123")
    EC-->>MCP: cachedResults[]
    MCP-->>Agent: { results: [...], meta: { cached: true } }
```

## Модель данных

### Основные типы

```typescript
interface SearchRequest {
  query: string;
  intent: "web" | "docs" | "github" | "news";
  freshness: "any" | "day" | "week" | "month";
  max_results: number;
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

### Интерфейс провайдера

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
  max_results: number;
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

## Принципы

1. **Agent Ignorance** — агент не знает внутреннюю механику
2. **Graceful Degradation** — если Tier 1 упал, fallback на Tier 2/3
3. **Cache First** — семантический → точный → провайдер
4. **Budget Safety** — жёсткие лимиты на запросы и fetch
5. **Local First** — предпочтение SearXNG и локальным embeddings
