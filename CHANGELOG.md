# Changelog

## [1.12.2] - 2026-10-30

### Fixed

- `status` and `configure --json get` no longer expose full API keys/tokens — values are partially masked (`abcd****wxyz`).
- `github_search` / `gitlab_search` retry on HTTP 429 and rate-limit 403 with truncated exponential backoff (honors `Retry-After`, capped at 5s).
- `brave_web` provider is actually registered now (registry key was `brave`, but `PROVIDER_ORDER` uses `brave_web`) — it was silently skipped and missing from `status`.

### Changed

- `package.json`: `homepage` + expanded `keywords`; README badges and absolute repo/npm links (SEO).
- `docs/`: landing page, `sitemap.xml`, `robots.txt` scaffold for GitHub Pages.
- Tests: router registration, secret masking, fetch retry (15 new tests).

## [1.12.0] - 2026-10-28

Cold-footprint rework: thin main + single hot worker, global install as the official path.

### Added

- Minimal MCP over stdio (`src/mcp/server.ts`, zero deps — newline + Content-Length framing, protocol negotiation, `initialize` with `instructions`, `tools/list`, `tools/call`): replaces `@modelcontextprotocol/sdk` in the cold path. Plain JSON tool schemas (`src/mcp/schemas.ts`) instead of zod-generated ones.
- Zero-dependency config (`FIELD_DEFS` + `parseConfig` in `src/utils/types.ts`, single source for parser/docs/TUI/status) and mini stderr logger (`src/utils/logger.ts`): replaces `zod`, `pino`, `dotenv`. All throw/parse semantics verified identical to zod via differential test.
- Hot worker (`src/hot/`): one private child per MCP server owns the entire heavy stack — SQLite cache (+sqlite-vec), rate limits, provider router, orchestrator, ONNX models. Spawned on first tool call, killed after `MODEL_IDLE_TIMEOUT_SEC` idle with verified `shutdown → SIGTERM → SIGKILL` escalation; suicides on parent death. Replaces `src/models/` (removed).
- `npm i -g mcp-web-hound` as the recommended distribution: single Node process (~22MB cold) instead of the npx relay chain (outer `px-cli` ~90MB + inner server). `npx -y` stays as zero-install fallback.
- CI `smoke-global` job: `npm pack` → `npm i -g tarball` → `--help` + `configure --json get` before publish.
- Tests: `tests/hot-worker.test.ts` (kill escalation, mock IPC roundtrip, orphan suicide).

### Changed

- `MODEL_IDLE_TIMEOUT_SEC` default 25 → 5 (applies to the whole hot worker; hot start ~1-2s, first semantic search loads models). In-RAM dedup/budget windows live and die with the hot worker.
- `src/index.ts` is thin: MCP + config + logging only, no `better-sqlite3`/`sqlite-vec`/providers in the cold import graph. Measured: main 71.6MB @75s idle with zero children; hot 80MB while serving, 0 after 5s idle (kill verified).
- Removed `@modelcontextprotocol/sdk`, `zod`, `pino`, `dotenv` from dependencies. Measured: main **22.5MB @75s idle** (was 71.6MB) — near bare-node level; e2e MCP stdio smoke passes (initialize/instructions/tools-list/tools-call/ping).
- Pinned all dependency versions (was `"latest"`); removed dead `linkedom` / `@mozilla/readability` / `turndown` / `turndown-plugin-gfm` (zero imports in `src`, only stale `dist/fetch/*`); `clean+build` drops stale artifacts.

## [1.11.1] - 2026-10-26

Fix `status` worker observability: `worker_pid` / `worker_last_kill_verified` were snapshotted once at startup (always null) instead of being read live. The worker lifecycle itself (spawn → serve → verified idle kill) was already correct.

## [1.11.0] - 2026-10-26

Memory usage optimization. Previously, the reranker models started together with the server and consumed ~500MB of RAM; now they start on first reranker use and die after 25 seconds idle.

### Added

- Private model worker (`src/models/`): ONNX embedding + NLI pipelines run in a dedicated child process per MCP server, killed after `MODEL_IDLE_TIMEOUT_SEC` (25s) idle with verified `shutdown → SIGTERM → SIGKILL` escalation.
- Worker suicide on parent death (IPC `disconnect` + PPID watchdog), so a crashed/killed server can never leak the worker.
- New config: `MODEL_IDLE_TIMEOUT_SEC` (25), `MODEL_PRELOAD` (false), `MODEL_WORKER` (true).
- `status` tool now reports `models` block (`embedding_loaded`, `nli_loaded`, `worker_mode`, `worker_pid`, `worker_last_kill_verified`).
- Tests: `tests/models-idle.test.ts` (idle unload) and `tests/models-worker.test.ts` (kill escalation, mock IPC roundtrip, orphan suicide).

### Changed

- Cold start by default: no eager model load at startup (`MODEL_PRELOAD=false`); first search pays ~3-6s load, idle server sits at ~65MB committed instead of ~930MB.
- In-process `dispose()` now actually releases ONNX sessions via `pipeline.dispose()` (previously only nulled JS refs, native memory stayed committed).
- Worker logs go to stderr (`MCP_WORKER=1`), stdout stays clean for the MCP protocol.
