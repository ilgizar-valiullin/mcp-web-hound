#!/usr/bin/env node

import { config } from './utils/config.js';
import { DATA_DIR, ENV_PATH } from './utils/env-path.js';
import { logger } from './utils/logger.js';
import { getStartupSummary } from './utils/config-help.js';
import { makeSearchTool } from './tools/search.js';
import { makeStatusTool } from './tools/status.js';
import { makeGitHubSearchTool } from './tools/github-search.js';
import { makeGitLabSearchTool } from './tools/gitlab-search.js';
import { makeReportUsageTool } from './tools/report-usage.js';
import { HotProcessManager } from './hot/manager.js';
import type { HotStatusResult } from './hot/protocol.js';
import type { SearchResponse } from './utils/types.js';
import { serveMcp } from './mcp/server.js';
import type { ToolDef } from './mcp/schemas.js';
import { installParentWatchdog } from './utils/parent-watchdog.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

function pkgVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const SERVER_NAME = 'mcp-web-hound';
const SERVER_VERSION = pkgVersion();

function printHelp(): void {
  const repoUrl = 'https://github.com/ilgizar-valiullin/mcp-web-hound';
  const cwdEnv = resolve(process.cwd(), '.env');
  process.stdout.write(`
mcp-web-hound v${SERVER_VERSION} — MCP search server for AI agents

Usage:
  npx mcp-web-hound                     Start MCP server (stdio, default)
  npx mcp-web-hound configure           Interactive settings editor
  npx mcp-web-hound configure --json get     List all settings (machine-readable)
  npx mcp-web-hound configure --json set KEY=VAL  Set config values
  npx mcp-web-hound export-logs         Export search logs (training dataset)
  npx mcp-web-hound --help              Show this help

Configuration:
  ${ENV_PATH}          Main config (auto-created, edit via \`npx mcp-web-hound configure\`)
  ${cwdEnv}             Per-project overrides (optional)

  ALWAYS use "npx mcp-web-hound configure --json set" to change settings.

OpenCode setup (opencode.json):
  "web_search": {
    "type": "local",
    "command": ["npx.cmd", "-y", "mcp-web-hound"],
    "enabled": true
  }

Claude Code setup (claude.json):
  "mcpServers": {
    "web_search": {
      "command": "npx",
      "args": ["-y", "mcp-web-hound"]
    }
  }

Docs: ${repoUrl}
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === 'configure') {
    const { main: configureMain } = await import('./cli/configure.js');
    configureMain(args.slice(1));
    return;
  }

  if (args[0] === 'export-logs') {
    const { main: exportLogsMain } = await import('./cli/export-logs.js');
    exportLogsMain(args.slice(1));
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const instructions = `# Search Protocol — mcp-web-hound

For agents using search tools provided by this server. Adopt as-is or adapt.

## Zero Guessing [CRITICAL]
Search web_search before answering any factual question. Training data is stale by default. Only skip for pure logic, basic math, universally known constants. If unclear after search, state the gap.

## Pre-Call Plan
Before executing ANY search tool, emit a planning block. Search from 2-3 distinct angles — use different keywords and different source types each time, don't rephrase the same query:
<plan>[Tool Name] | [Why searching] | [Keywords query]</plan>

Snippets are hints, pages are answers — fetch results before starting another search.

## Tool Selection
- web_search — default for any external topic (libraries, APIs, docs, pricing, releases).
- github_search — open source repos, code examples, issues, users. Prefer for code patterns and real-world usage.
- gitlab_search — same scope as github_search, for GitLab.

Cite sources. If you can't confirm a claim, search first.

## Query Formatting
Exact quotes for error messages or code signatures. Prepend site:domain to narrow results. Use relative freshness terms like "latest api", "current version", "recent changes" — search engines handle recency ranking natively. Hardcoded years become stale and give wrong results.

`;

  // Thin main: the entire heavy stack (SQLite/vec, router, orchestrator, models)
  // lives in a single hot child, spawned on first tool call and killed on
  // idle (MODEL_IDLE_TIMEOUT_SEC). Cold main holds only MCP + config + logger.
  const hotManager = new HotProcessManager();

  async function hotSearch(query: string): Promise<SearchResponse> {
    const { response } = await hotManager.op<{ response: SearchResponse }>('search', { query });
    return response;
  }

  async function hotStatus(): Promise<HotStatusResult> {
    const { status } = await hotManager.op<{ status: HotStatusResult }>('status', {});
    return status;
  }

  async function hotReportUsage(search_id: string, used_doc_ids: string[]): Promise<boolean> {
    const { updated } = await hotManager.op<{ updated: boolean }>('reportUsage', { search_id, used_doc_ids });
    return updated;
  }

  if (config.MODEL_PRELOAD) {
    try {
      await hotManager.ensureSpawned();
      logger.info('Hot worker prewarmed');
    } catch (err) {
      logger.warn({ err }, 'Hot worker prewarm failed, will spawn on first search');
    }
  } else {
    logger.info('Hot worker lazy (cold start, spawns on first tool call)');
  }

  const tools: ToolDef[] = [
    makeSearchTool(hotSearch),
    // NOTE: worker pid/verified read via getters — a plain snapshot object here
    // would freeze them at startup values (null) forever.
    makeStatusTool(hotStatus, {
      mode: 'hot' as const,
      get pid(): number | null {
        return hotManager.workerPid;
      },
      get lastKillVerified(): boolean | null {
        return hotManager.lastKillVerified;
      },
    }),
    makeGitHubSearchTool(),
  ];

  // report_search_usage only makes sense when search logging is enabled:
  // without rows in search_logs it would always answer "Search ID not found".
  if (config.SEARCH_LOG_ENABLED) {
    tools.push(makeReportUsageTool(hotReportUsage));
  }

  if (config.GITLAB_TOKEN) {
    tools.push(makeGitLabSearchTool());
  }

  async function cleanup(): Promise<void> {
    logger.info('Shutting down server');

    try {
      await hotManager.dispose();
    } catch (err) {
      logger.error({ err }, 'Error terminating hot worker');
    }

    logger.info('Server shut down complete');
  }

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
  });

  installParentWatchdog({ onParentDeath: () => void cleanup() });

  const summary = getStartupSummary(config);
  logger.info({ summary, dataDir: DATA_DIR }, 'Starting MCP Web Hound');

  await serveMcp({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    instructions,
    tools,
    onShutdown: cleanup,
  });
  logger.info('Server connected and listening on stdio');
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
