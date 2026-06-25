# Search MCP Server

> Unified MCP search tools for AI agents — abstracts providers, caching, reranking, and rate limits behind a few simple tools.

## Tools

| Tool | Purpose |
|------|---------|
| `search` | Universal web search with caching, reranking, and fallback across 6 providers |
| `github_search` | Search GitHub repos, code, issues, and users |
| `gitlab_search` | Search GitLab projects, issues, MRs, and code blobs |
| `status` | Server diagnostics, provider health, budget state |

## Quick Start

```bash
git clone <repo-url> search-mcp
cd search-mcp
npm install
cp .env.example .env
npm run build
npm start
```

## Configuration

Copy `.env.example` to `.env` and set your API keys. No keys are required — DuckDuckGo and Bing work out of the box.

| Provider | Key Required | Tier | Rate Limit |
|----------|-------------|------|------------|
| DuckDuckGo | No | 1 | 10 req/min |
| Bing | No | 1 | — |
| Brave | `BRAVE_API_KEY` | 2 | 2000/month |
| Tavily | `TAVILY_API_KEY` | 2 | 1000/month |
| Exa | `EXA_API_KEY` | 3 | Trial |
| Firecrawl | `FIRECRAWL_API_KEY` | 3 | Trial |

## Tool Reference

### `search`

```typescript
search({
  query: string,
  intent?: "web" | "docs" | "github" | "news",
  freshness?: "any" | "day" | "week" | "month",
  include_content?: boolean   // fetch page content as markdown
})
```

Returns merged results from the first 2 healthy providers (parallel), deduplicated and reranked by relevance.

### `github_search`

```typescript
github_search({
  query: string,
  type?: "repositories" | "code" | "issues" | "users",
  language?: string,
  stars?: string,             // e.g. ">1000", "500..5000"
  page?: number
})
```

Rate limit: 60 req/hr without token, 5000 req/hr with `GITHUB_TOKEN`.

### `gitlab_search`

```typescript
gitlab_search({
  query: string,
  scope?: "projects" | "issues" | "merge_requests" | "blobs",
  per_page?: number,          // default 10, max 100
  page?: number
})
```

Requires `GITLAB_TOKEN` with `read_api` scope.

### `status`

```typescript
status()
```

Returns provider health, cache stats, budget state, uptime.

## Architecture

[Pipeline](docs/diagrams/search-pipeline-flow.md)

Core pipeline: `Normalize → Budget Check → Cache → Router (parallel 2) → Rerank → Cache → Respond`

Full docs:
- [Architecture](docs/architecture.md)
- [Providers & Fallback](docs/providers.md)
- [Caching](docs/caching.md)
- [Reranking](docs/reranking.md)
- [Fetch Layer](docs/fetch-layer.md)
- [Budget System](docs/budget.md)
- [Configuration](docs/configuration.md)
- [Roadmap](docs/roadmap.md)

## License

MIT
