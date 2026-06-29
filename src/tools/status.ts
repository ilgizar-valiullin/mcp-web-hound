import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SqliteCache } from '../cache/sqlite.js';
import { ProviderRouter } from '../search/provider-router.js';
import { BudgetManager } from '../limits/budget-manager.js';
import { config, ENV_PATH } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { ConfigSchema } from '../utils/types.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const startTime = Date.now();

function inferCategory(key: string): string {
  if (key.startsWith('SEMANTIC_') || key.startsWith('RERANK_') || key.startsWith('INTENT_')) return 'feature';
  if (key.endsWith('_ENABLED')) return 'provider_flag';
  if (key.endsWith('_API_KEY')) return 'api_key';
  if (key.endsWith('_TOKEN')) return 'token';
  if (key.startsWith('BUDGET_') || key.startsWith('CACHE_') || key.endsWith('_RPM') || key.endsWith('_RPD') || key.endsWith('_RPMONTH')) return 'limit';
  return 'behavior';
}

function getConfigHelp(): Array<{ key: string; category: string; description: string; value: unknown }> {
  const shape = ConfigSchema.shape as Record<string, any>;
  const help: Array<{ key: string; category: string; description: string; value: unknown }> = [];

  for (const key of Object.keys(shape)) {
    const type = shape[key];
    const description = type.description ?? '';
    if (!description) continue;
    help.push({
      key,
      category: inferCategory(key),
      description,
      value: config[key as keyof typeof config],
    });
  }

  return help.sort((a, b) => `${a.category}:${a.key}`.localeCompare(`${b.category}:${b.key}`));
}

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

        const configModel = `2-tier: server .env (${ENV_PATH}) + optional project .env overrides. Agents use configure --json set. NEVER write to project .env.`;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  config_model: configModel,
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
                  config_file: ENV_PATH,
                  config_help: getConfigHelp(),
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
