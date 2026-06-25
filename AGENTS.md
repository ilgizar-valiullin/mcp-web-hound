# Search MCP Server — Agent Rules

## Project-specific rules

1. **No code changes without plan approval.** This project follows the planning mode protocol.

2. **TypeScript only.** All source code in `src/` must be TypeScript with strict mode enabled.

3. **Provider interface.** All search providers MUST implement the `SearchProvider` interface defined in `src/search/providers/base-provider.ts`. No ad-hoc provider implementations.

4. **Web search via orchestrator only.** The `src/tools/search.ts` layer must only call the orchestrator. All web-search provider logic stays in `src/search/`. GitHub/GitLab tools (`github-search.ts`, `gitlab-search.ts`) are separate API tools, not part of the web-search pipeline.

5. **Cache invariant.** Every successful provider response MUST be cached before returning to the agent. No uncached responses.

6. **Budget enforcement.** Budget check MUST happen before any provider call. No exceptions.

7. **Env-based config.** All configurable values come from environment variables (`.env`). No hardcoded API keys, URLs, or limits in source code.

8. **Logging.** Use `pino` structured logger. No `console.log` in production code.

9. **Error handling.** Provider errors must never crash the server. Log, mark unhealthy, fallback to next provider.

10. **Documentation.** After any architectural change, update the corresponding doc in `docs/` and the flow diagram in `docs/diagrams/`.
