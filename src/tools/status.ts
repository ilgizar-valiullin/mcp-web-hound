import { config } from '../utils/config.js';
import { ENV_PATH } from '../utils/env-path.js';
import { logger } from '../utils/logger.js';
import { FIELD_DEFS } from '../utils/types.js';
import { maskSecretValue } from '../utils/config-help.js';
import type { HotStatusResult } from '../hot/protocol.js';
import type { ToolDef } from '../mcp/schemas.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const startTime = Date.now();

function pkgVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function inferCategory(key: string): string {
  if (key.startsWith('SEMANTIC_') || key.startsWith('RERANK_') || key.startsWith('INTENT_') || key.startsWith('MODEL_') || key.startsWith('EMBEDDING_')) return 'feature';
  if (key.endsWith('_ENABLED')) return 'provider_flag';
  if (key.endsWith('_API_KEY')) return 'api_key';
  if (key.endsWith('_TOKEN')) return 'token';
  if (key.startsWith('BUDGET_') || key.startsWith('CACHE_') || key.endsWith('_RPM') || key.endsWith('_RPD') || key.endsWith('_RPMONTH')) return 'limit';
  return 'behavior';
}

function getConfigHelp(): Array<{ key: string; category: string; description: string; value: unknown }> {
  const help: Array<{ key: string; category: string; description: string; value: unknown }> = [];

  for (const def of FIELD_DEFS) {
    const key = def.key;
    const description = def.description ?? '';
    if (!description) continue;
    help.push({
      key,
      category: inferCategory(key),
      description,
      value: maskSecretValue(key, config[key as keyof typeof config]),
    });
  }

  return help.sort((a, b) => `${a.category}:${a.key}`.localeCompare(`${b.category}:${b.key}`));
}

/** Thin adapter: cache/provider/budget/model stats come from the hot worker. */
export function makeStatusTool(
  statusFn: () => Promise<HotStatusResult>,
  worker?: { mode: string; pid: number | null; lastKillVerified: boolean | null },
): ToolDef {
  return {
    name: 'status',
    description: 'Get server diagnostics, provider health, and budget state',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      try {
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        const hot = await statusFn();

        const configModel = `2-tier: server .env (${ENV_PATH}) + optional project .env overrides. Agents use configure --json set. NEVER write to project .env.`;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  config_model: configModel,
                  providers: hot.providers,
                  cache: hot.cache,
                  budget: {
                    searches_remaining: hot.budget.searches_remaining,
                    fetches_remaining: hot.budget.fetches_remaining,
                    budget_window: `${config.BUDGET_WINDOW_MINUTES} minutes`,
                  },
                  embedding_model: config.SEMANTIC_ENABLED ? config.EMBEDDING_MODEL : 'disabled',
                  models: {
                    embedding_loaded: hot.models.embedding_loaded,
                    nli_loaded: hot.models.nli_loaded,
                    idle_timeout_sec: config.MODEL_IDLE_TIMEOUT_SEC,
                    preload: config.MODEL_PRELOAD,
                    worker_mode: worker?.mode ?? 'hot',
                    worker_pid: worker?.pid ?? null,
                    worker_last_kill_verified: worker?.lastKillVerified ?? null,
                  },
                  uptime_seconds: uptimeSeconds,
                  version: pkgVersion(),
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
  };
}
