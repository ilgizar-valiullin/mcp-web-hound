import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SqliteCache } from '../cache/sqlite.js';
import { ProviderRouter } from '../search/provider-router.js';
import { BudgetManager } from '../limits/budget-manager.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const startTime = Date.now();

export function registerStatusTool(
  server: McpServer,
  cache: SqliteCache,
  router: ProviderRouter,
  budgetManager: BudgetManager,
): void {
  server.registerTool(
    'status',
    {
      description: 'Get server diagnostics, provider health, and budget state',
    },
    async () => {
      try {
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        const cacheStats = cache.getStats();
        const providerStats = router.getProviderStats();
        const remaining = budgetManager.getRemaining();

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  providers: providerStats,
                  cache: cacheStats,
                  budget: {
                    searches_remaining: remaining.searches,
                    fetches_remaining: remaining.fetches,
                    budget_window: `${config.BUDGET_WINDOW_MINUTES} minutes`,
                  },
                  embedding_model: config.SEMANTIC_ENABLED ? config.EMBEDDING_MODEL : 'disabled',
                  uptime_seconds: uptimeSeconds,
                  version: pkg.version,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        logger.error({ err }, 'Status tool error');
        return {
          content: [{ type: 'text' as const, text: 'Failed to get server status' }],
          isError: true,
        };
      }
    },
  );
}
