#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config, buildProviderLimits } from './utils/config.js';
import { DATA_DIR, ENV_PATH } from './utils/env-path.js';
import { logger } from './utils/logger.js';
import { getStartupSummary } from './utils/config-help.js';
import { SqliteCache } from './cache/sqlite.js';
import { SemanticCache } from './cache/semantic-cache.js';
import { BudgetManager } from './limits/budget-manager.js';
import { SessionStore } from './limits/session-store.js';
import { RateLimitStore } from './limits/rate-limit-store.js';
import { ProviderRouter } from './search/provider-router.js';
import { Orchestrator } from './search/orchestrator.js';
import { EmbeddingService } from './embeddings/embedding-service.js';
import { registerSearchTool } from './tools/search.js';
import { registerStatusTool } from './tools/status.js';
import { registerGitHubSearchTool } from './tools/github-search.js';
import { registerGitLabSearchTool } from './tools/gitlab-search.js';
import { registerReportUsageTool } from './tools/report-usage.js';
import { IntentClassifier } from './search/intent-classifier.js';
import { ModelWorkerManager } from './models/manager.js';
import { WorkerClassifier, WorkerEmbeddingService } from './models/facades.js';
import { installParentWatchdog } from './utils/parent-watchdog.js';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const SERVER_NAME = 'mcp-web-hound';
const SERVER_VERSION = pkg.version;

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
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: 'Unified search() tool for AI agents — hiding providers, caching, reranking, and rate limits',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: `# Search Protocol — mcp-web-hound

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

`,
    },
  );

  const cache = new SqliteCache();
  const budgetManager = new BudgetManager();
  const rateLimitStore = new RateLimitStore(DATA_DIR, buildProviderLimits(config));
  const router = new ProviderRouter(rateLimitStore);

  let semanticCache: SemanticCache | undefined;
  let embeddingService: EmbeddingService | undefined;
  let workerManager: ModelWorkerManager | undefined;
  let classifier: IntentClassifier;

  if (config.MODEL_WORKER) {
    workerManager = new ModelWorkerManager();
    classifier = new WorkerClassifier(workerManager);
    if (config.SEMANTIC_ENABLED) {
      semanticCache = new SemanticCache(cache.getDb());
      semanticCache.init();
      embeddingService = new WorkerEmbeddingService(workerManager);
      logger.info('Semantic layer lazy (cold start, models live in a private worker)');
    } else {
      logger.info('Semantic layer disabled, NLI runs in a private worker');
    }
    if (config.MODEL_PRELOAD) {
      try {
        await workerManager.ensureSpawned();
        logger.info('Model worker prewarmed');
      } catch (err) {
        logger.warn({ err }, 'Model worker prewarm failed, will spawn on first search');
      }
    }
  } else {
    if (config.SEMANTIC_ENABLED) {
      semanticCache = new SemanticCache(cache.getDb());
      semanticCache.init();
      embeddingService = new EmbeddingService();
      if (config.MODEL_PRELOAD) {
        await embeddingService.ensureLoaded();
        logger.info('Semantic layer initialized (preloaded)');
      } else {
        logger.info('Semantic layer lazy (cold start, models load on first search)');
      }
    }

    classifier = new IntentClassifier(
      config.INTENT_CLASSIFIER_MODEL,
      0.45,
      undefined,
      config.MODEL_IDLE_TIMEOUT_SEC * 1000,
    );
  }
  const sessionStore = new SessionStore(
    config.SESSION_DEDUP_WINDOW_MINUTES,
    config.SESSION_DEDUP_STRETCH_MINUTES,
  );
  const orchestrator = new Orchestrator(budgetManager, cache, router, semanticCache, embeddingService, classifier, sessionStore);

  registerSearchTool(server, orchestrator, classifier);
  registerStatusTool(server, cache, router, budgetManager, {
    embeddingService,
    classifier,
    worker: workerManager
      ? { mode: 'worker', pid: workerManager.workerPid, lastKillVerified: workerManager.lastKillVerified }
      : { mode: 'in-process', pid: null, lastKillVerified: null },
  });
  registerGitHubSearchTool(server);
  registerReportUsageTool(server, cache);

  if (config.GITLAB_TOKEN) {
    registerGitLabSearchTool(server);
  }

  let shuttingDown = false;

  async function cleanup(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('Shutting down server');

    if (workerManager) {
      try {
        await workerManager.dispose();
      } catch (err) {
        logger.error({ err }, 'Error terminating model worker');
      }
    }

    try {
      embeddingService?.dispose();
    } catch (err) {
      logger.error({ err }, 'Error disposing embedding model');
    }

    try {
      classifier.dispose();
    } catch (err) {
      logger.error({ err }, 'Error disposing NLI model');
    }

    try {
      rateLimitStore.flush();
    } catch (err) {
      logger.error({ err }, 'Error flushing rate limit store');
    }

    try {
      cache.close();
    } catch (err) {
      logger.error({ err }, 'Error closing cache');
    }

    try {
      await server.close();
    } catch (err) {
      logger.error({ err }, 'Error during server shutdown');
    }

    logger.info('Server shut down complete');
  }

  process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
  });

  installParentWatchdog({ onParentDeath: cleanup });

  const summary = getStartupSummary(config);
  logger.info({ summary, dataDir: DATA_DIR }, 'Starting MCP Web Hound');

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Server connected and listening on stdio');
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
