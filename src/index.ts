#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config, ENV_PATH, buildProviderLimits } from './utils/config.js';
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
import { IntentClassifier } from './search/intent-classifier.js';
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
  npx mcp-web-hound                  Start MCP server (stdio)
  npx mcp-web-hound --help           Show this help

Configuration model (2-tier):
  ${ENV_PATH}         Server config (main — written by configure tool)
  ${cwdEnv}            Per-project overrides (optional)

  AGENT RULE: AI agents MUST write config ONLY to the server .env via
  configure --json set. NEVER write to a project's .env.

Commands:
  npx mcp-web-hound-configure                  Interactive settings editor
  npx mcp-web-hound-configure --json get       List all settings (machine-readable JSON)
  npx mcp-web-hound-configure --json set KEY=VAL   Apply settings (machine-readable JSON)

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

For automated setup by AI agents:
  mcp-web-hound-configure --help

Docs: ${repoUrl}
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args[0] === 'configure') {
    const { main: configureMain } = await import('./cli/configure.js');
    configureMain();
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
For technical specifics — API signatures, versions, errors, current data — ALWAYS call web_search rather than relying on training data. Never invent or extrapolate. If results lack the exact fact, re-query from a different angle. Stop when confident or after a few reformulations yield no new signal. If still missing, state it explicitly rather than guessing.

## Pre-Call Plan
Before executing ANY search tool, emit a strict planning block:
<plan>[Tool Name] | [Target Fact] | [Optimized Query]</plan>

## Tool Selection
- web_search — default for any external topic (libraries, APIs, docs, pricing, releases).
- github_search — open source repos, code examples, issues, users. Prefer for code patterns and real-world usage.
- gitlab_search — same scope as github_search, for GitLab.

Cite sources. If you can't confirm a claim, search first.

## Query Formatting
Keywords only (strip filler). Exact quotes for error messages or code signatures. Prepend site:domain to narrow results. Never hardcode a year — if temporal context matters, state the need naturally (e.g. "latest api", "current version", "recent changes"). Search engines handle freshness; hardcoded years become stale and give wrong results.

## Source Quality
Prefer: official docs → official repos → issues/discussions → release notes → technical articles → forums (supporting only).
Red flags: outdated versions without migration notes, unofficial sources for critical functionality, conflicting info without clear resolution.`,
    },
  );

  const cache = new SqliteCache();
  const budgetManager = new BudgetManager();
  const rateLimitStore = new RateLimitStore(config.DATA_DIR, buildProviderLimits(config));
  const router = new ProviderRouter(rateLimitStore);

  let semanticCache: SemanticCache | undefined;
  let embeddingService: EmbeddingService | undefined;

  if (config.SEMANTIC_ENABLED) {
    semanticCache = new SemanticCache(cache.getDb());
    semanticCache.init();
    embeddingService = new EmbeddingService();
    await embeddingService.ensureLoaded();
    logger.info('Semantic layer initialized');
  }

  const classifier = new IntentClassifier(config.INTENT_CLASSIFIER_MODEL);
  const sessionStore = new SessionStore(
    config.SESSION_DEDUP_WINDOW_MINUTES,
    config.SESSION_DEDUP_STRETCH_MINUTES,
  );
  const orchestrator = new Orchestrator(budgetManager, cache, router, semanticCache, embeddingService, classifier, sessionStore);

  registerSearchTool(server, orchestrator, classifier);
  registerStatusTool(server, cache, router, budgetManager);
  registerGitHubSearchTool(server);

  if (config.GITLAB_TOKEN) {
    registerGitLabSearchTool(server);
  }

  let shuttingDown = false;

  async function cleanup(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('Shutting down server');

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

  const summary = getStartupSummary(config);
  logger.info({ summary, dataDir: config.DATA_DIR }, 'Starting MCP Web Hound');

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Server connected and listening on stdio');
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
