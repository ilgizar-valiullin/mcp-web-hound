# Конфигурация

## Переменные окружения

Все настройки через `.env` файл или переменные окружения.

### Общие

| Переменная | Default | Описание |
|-----------|---------|----------|
| `LOG_LEVEL` | `info` | Уровень логирования: debug, info, warn, error |
| `DATA_DIR` | `./data` | Директория для SQLite базы |
| `DB_FILENAME` | `search.db` | Имя файла базы |

### Провайдеры — Tier 1

| Переменная | Default | Описание |
|-----------|---------|----------|
| `SEARXNG_URL` | — | URL инстанса SearXNG |
| `SEARXNG_ENGINES` | `google,bing,duckduckgo` | Движки SearXNG через запятую |
| `DDG_ENABLED` | `true` | Включить DuckDuckGo |
| `DDG_DELAY_MS` | `1000` | Задержка между DDG запросами (мс) |
| `DDG_MAX_PER_MINUTE` | `10` | Максимум DDG запросов/мин |

### Провайдеры — Tier 2

| Переменная | Default | Описание |
|-----------|---------|----------|
| `BRAVE_API_KEY` | — | API ключ Brave Search |
| `BRAVE_DAILY_LIMIT` | `60` | Дневной лимит запросов |
| `TAVILY_API_KEY` | — | API ключ Tavily |
| `TAVILY_DAILY_LIMIT` | `30` | Дневной лимит запросов |

### Провайдеры — Tier 3

| Переменная | Default | Описание |
|-----------|---------|----------|
| `EXA_API_KEY` | — | API ключ Exa |
| `FIRECRAWL_API_KEY` | — | API ключ Firecrawl |

### Budget (защита от агента)

| Переменная | Default | Описание |
|-----------|---------|----------|
| `BUDGET_MAX_SEARCHES` | `15` | Макс. поисковых запросов за окно |
| `BUDGET_MAX_FETCHES` | `30` | Макс. загрузок страниц за окно |
| `BUDGET_WINDOW_MINUTES` | `30` | Размер sliding window (мин) |

### Кэширование

| Переменная | Default | Описание |
|-----------|---------|----------|
| `CACHE_MAX_SIZE_MB` | `500` | Макс. размер SQLite базы (МБ) |
| `CACHE_EVICTION_INTERVAL_MIN` | `30` | Интервал очистки expired (мин) |

### Семантический слой

| Переменная | Default | Описание |
|-----------|---------|----------|
| `EMBEDDING_MODEL` | `multilingual-e5-small` | Модель для embeddings |
| `EMBEDDING_DIMENSION` | `384` | Размерность вектора |
| `SEMANTIC_THRESHOLD` | `0.92` | Порог similarity для cache hit |
| `SEMANTIC_ENABLED` | `false` | Включить семантический слой (V2) |

### Fetch Layer

| Переменная | Default | Описание |
|-----------|---------|----------|
| `FETCH_TIMEOUT_MS` | `10000` | Таймаут загрузки (мс) |
| `FETCH_MAX_RETRIES` | `2` | Макс. ретраев |
| `FETCH_MAX_BODY_SIZE` | `5242880` | Макс. размер ответа (байт, 5MB) |
| `FETCH_CONCURRENT_LIMIT` | `3` | Параллельных загрузок |
| `FETCH_USER_AGENT` | `SearchMCP/1.0` | User-Agent для запросов |
| `CONTENT_MAX_LENGTH` | `8000` | Макс. длина content (символов) |

### Реранкинг

| Переменная | Default | Описание |
|-----------|---------|----------|
| `RERANK_ENABLED` | `true` | Включить реранкинг |
| `RERANK_WEIGHT_SEMANTIC` | `0.35` | Вес semantic similarity |
| `RERANK_WEIGHT_DOMAIN` | `0.30` | Вес domain quality |
| `RERANK_WEIGHT_FRESHNESS` | `0.15` | Вес freshness |
| `RERANK_WEIGHT_POSITION` | `0.20` | Вес position |

---

## Пример `.env`

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

## Валидация

При запуске сервер проверяет:

1. **Минимум один провайдер доступен** — хотя бы `SEARXNG_URL` или `DDG_ENABLED=true`
2. **API ключи валидны** — если указаны, проверяет формат
3. **DATA_DIR существует** — создаёт если нет
4. **SQLite работает** — тестовый запрос при старте
5. **Embedding модель** — загружена если `SEMANTIC_ENABLED=true`

При критических ошибках — process.exit(1) с понятным сообщением.
