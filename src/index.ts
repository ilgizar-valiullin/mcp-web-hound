import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { SqliteCache } from './cache/sqlite.js';
import { SemanticCache } from './cache/semantic-cache.js';
import { BudgetManager } from './limits/budget-manager.js';
import { ProviderRouter } from './search/provider-router.js';
import { Orchestrator } from './search/orchestrator.js';
import { EmbeddingService } from './embeddings/embedding-service.js';
import { registerSearchTool } from './tools/search.js';
import { registerStatusTool } from './tools/status.js';
import { registerGitHubSearchTool } from './tools/github-search.js';
import { registerGitLabSearchTool } from './tools/gitlab-search.js';
import { IntentClassifier } from './search/intent-classifier.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const SERVER_NAME = 'search-mcp';
const SERVER_VERSION = pkg.version;

async function main(): Promise<void> {
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
    },
  );

  const cache = new SqliteCache();
  const budgetManager = new BudgetManager();
  const router = new ProviderRouter();

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
  const orchestrator = new Orchestrator(budgetManager, cache, router, semanticCache, embeddingService, classifier);

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

  logger.info(
    {
      providers: {
        ddg: config.DDG_ENABLED,
        bing: config.BING_ENABLED,
        brave: !!config.BRAVE_API_KEY,
        tavily: !!config.TAVILY_API_KEY,
        exa: !!config.EXA_API_KEY,
        firecrawl: !!config.FIRECRAWL_API_KEY,
      },
      semantic: config.SEMANTIC_ENABLED ? config.EMBEDDING_MODEL : 'disabled',
      dataDir: config.DATA_DIR,
    },
    'Starting Search MCP Server',
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Server connected and listening on stdio');
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
