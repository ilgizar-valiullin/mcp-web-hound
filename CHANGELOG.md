# Changelog

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
