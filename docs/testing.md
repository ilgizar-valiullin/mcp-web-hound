# Testing

## Quick Start

```bash
# Run all unit tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage

# Integration tests (live API — requires .env keys)
npm run test:providers

# All tests (unit + integration)
npm run test:all
```

## Test Structure

```
tests/
├── search/
│   ├── providers/
│   │   ├── duckduckgo.test.ts   — DDG HTML scrape parsing
│   │   ├── bing.test.ts         — Bing HTML scrape parsing
│   │   ├── searxng.test.ts      — SearXNG REST API
│   │   ├── brave.test.ts        — Brave Search API (mocked)
│   │   ├── tavily.test.ts       — Tavily API (mocked)
│   │   ├── exa.test.ts          — Exa API (mocked)
│   │   └── firecrawl.test.ts    — Firecrawl v2 API (mocked)
│   ├── orchestrator.test.ts     — Full search pipeline
│   ├── provider-router.test.ts  — Parallel fallback logic
│   ├── reranker.test.ts         — Domain/freshness/position scoring
│   ├── query-normalizer.test.ts — Cache key generation
│   └── search.test.ts           — Tool layer validation
├── embeddings/
│   └── embedding-service.test.ts
├── limits/
│   └── budget-manager.test.ts
├── utils/
│   └── types.test.ts
└── integration/
    └── providers.integration.test.ts — Live API smoke tests
```

## Coverage

Current coverage targets (enforced by vitest):

| Metric | Target |
|--------|--------|
| Statements | 50% |
| Branches | 35% |
| Functions | 55% |
| Lines | 55% |

Coverage report: `./coverage/index.html`

## Writing Tests

### Provider Unit Tests

Mock the `search()` method on each provider. Use vitest `vi.mock()` for config and HTTP:

```ts
import { BraveProvider } from '../../src/search/providers/brave.js';

vi.mock('../../src/utils/config.js', () => ({
  config: { BRAVE_API_KEY: 'test-key' },
}));
```

### Integration Tests

Set the corresponding env var in `.env` to enable live testing for a provider. Tests skip automatically if the key is missing:

```ts
const config = { BRAVE_API_KEY: process.env.BRAVE_API_KEY };
const isConfigured = !!config.BRAVE_API_KEY;

(isConfigured ? describe : describe.skip)('Brave (live)', () => { ... });
```

## CI

The CI workflow (`.github/workflows/ci.yml`) runs unit tests on Node 20 and 22:
