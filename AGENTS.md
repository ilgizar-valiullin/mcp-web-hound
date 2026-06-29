# MCP Web Hound — Agent Rules

## Project-specific rules

1. **No code changes without plan approval.** This project follows the planning mode protocol.

2. **TypeScript only.** All source code in `src/` must be TypeScript with strict mode enabled.

3. **Provider interface.** All search providers MUST implement the `SearchProvider` interface defined in `src/search/providers/base-provider.ts`. No ad-hoc provider implementations.

4. **Web search via orchestrator only.** The `src/tools/search.ts` layer must only call the orchestrator. All web-search provider logic stays in `src/search/`. GitHub/GitLab tools (`github-search.ts`, `gitlab-search.ts`) are separate API tools, not part of the web-search pipeline.

5. **Cache invariant.** Every successful provider response MUST be cached before returning to the agent. No uncached responses.

6. **Budget enforcement.** Budget check MUST happen before any provider call. No exceptions.

7. **Env-based config.** All configurable values come from environment variables (`.env`). Use `npx mcp-web-hound-configure --json get/set` for machine-readable access. Two-tier model: `~/.config/mcp-web-hound/.env` (main) + project `.env` (per-folder overrides). Agents must only write to server `.env`.

8. **Logging.** Use `pino` structured logger. No `console.log` in production code.

9. **Error handling.** Provider errors must never crash the server. Log, mark unhealthy, fallback to next provider.

10. **Documentation.** After any architectural change, update the corresponding doc in `docs/` and the flow diagram in `docs/diagrams/`.

11. **Tests before merge.** Every feature or fix MUST include tests. Run `npm test` before committing. For live provider testing, set API keys in `.env` and run `npm run test:providers`.

12. **Coverage check.** After adding tests, verify coverage doesn't regress: `npm run test:coverage`. Current thresholds: statements 50%, branches 35%, functions 55%, lines 55%.
