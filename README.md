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

## Query Formats

| Tool | Pattern | Example |
|------|---------|---------|
| `search` | General web search | `typescript tutorial`, `how to install docker` |
| `search` | GitHub-oriented | `repo:vercel/next.js`, `stars:>1000 language:rust` |
| `search` | Docs-oriented | `express api reference`, `docker compose guide` |
| `search` | News-oriented | `react 19 release notes`, `latest ai news` |
| `github_search` | Native GitHub search syntax | `repo:org/name`, `user:vercel`, `language:typescript` |
| `gitlab_search` | Native GitLab search syntax | `project:org/name`, scope filter via `type` param |

## Tool Reference

### `search`

```typescript
search({
  query: string,
})
```

Returns merged results from the first 2 healthy providers (parallel), deduplicated and reranked by relevance.

Intent classification runs automatically (no `intent` parameter). The server detects query intent
(github / docs / news / web) via NLI zero-shot (DeBERTa-v3-xsmall).

### NLI Reranking

Every search result is scored against the query using the same NLI model:

- **Model**: `Xenova/nli-deberta-v3-xsmall` (177M params, ONNX-optimized)
- **Inference**: ~10–15ms per result on CPU, ~300ms for 20 results (parallelized)
- **Score**: `0.9 * NLI(query, snippet) + 0.04 * domain + 0.03 * freshness + 0.03 * position`
- **Config**: Override via `INTENT_CLASSIFIER_MODEL` in `.env`

The NLI model loads lazily on first request and is shared between intent classification and reranking.

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

Core pipeline: `Budget Check → Normalize → Classify (intent + freshness) → Cache → Router (parallel 2) → Rerank → Cache → Respond`

Full docs:
- [Architecture](docs/architecture.md)
- [Providers & Fallback](docs/providers.md)
- [Caching](docs/caching.md)
- [Reranking](docs/reranking.md)
- [Budget System](docs/budget.md)
- [Configuration](docs/configuration.md)
- [Roadmap](docs/roadmap.md)

## Donations / Support the Project

* **EVM Address** (USDT, USDC, ETH, BNB): `0x3acf78e721aa065bd1509735a3ace630fcd0f452`

  _Supported networks: BNB Smart Chain (BEP20), Polygon, Arbitrum One, Ethereum (ERC20)_
  <details>
  <summary>Show EVM QR Code</summary>
  <img src=".github/images/evm.jpg" width="300" alt="EVM Deposit QR">
  </details>

* **USDT (TRC20)**: `TMG1BZJswd8UacHANKVi9Veq5FqSbaMjAQ`

  _Supported network: Tron (TRC20)_
  <details>
  <summary>Show TRC20 QR Code</summary>
  <img src=".github/images/trc20.jpg" width="300" alt="TRC20 Deposit QR">
  </details>

* **TON / USDT (TON)**: `UQDjf84AZSwuCPC3UWFv28p-V44zI-1lfhqCMfaex2Q-jDsY`

  _Supported network: The Open Network (TON)_
  <details>
  <summary>Show TON QR Code</summary>
  <img src=".github/images/ton.jpg" width="300" alt="TON Deposit QR">
  </details>

## License

MIT
