#!/usr/bin/env node
/**
 * Hot worker: single child per MCP server, owns the entire heavy stack —
 * SQLite cache (+sqlite-vec), rate limits, provider router, orchestrator,
 * and ONNX models (in-process). Spawned on first tool call, killed on idle
 * (default 5s) so the OS reclaims ALL native memory — sqlite-vec pages
 * cannot be unloaded any other way.
 *
 * stdout is ignored by the parent (MCP protocol lives there); logs go to
 * stderr via MCP_HOT=1 (see utils/logger.ts).
 */
import { BudgetManager } from '../limits/budget-manager.js';
import { RateLimitStore } from '../limits/rate-limit-store.js';
import { SessionStore } from '../limits/session-store.js';
import { ProviderRouter } from '../search/provider-router.js';
import { Orchestrator } from '../search/orchestrator.js';
import { IntentClassifier } from '../search/intent-classifier.js';
import { EmbeddingService } from '../embeddings/embedding-service.js';
import { SqliteCache } from '../cache/sqlite.js';
import { SemanticCache } from '../cache/semantic-cache.js';
import { buildProviderLimits, config } from '../utils/config.js';
import { DATA_DIR } from '../utils/env-path.js';
import { logger } from '../utils/logger.js';
import { installParentWatchdog } from '../utils/parent-watchdog.js';

const MOCK = process.env.HOT_MOCK === '1';

function suicide(code: number): never {
  // Instant exit — death itself frees every byte of native memory.
  process.exit(code);
}

// Parent dead → die. Covers SIGKILL/OOM/crash of the MCP server.
installParentWatchdog({
  intervalMs: 2000,
  onParentDeath: () => undefined,
});

// fork() IPC channel closed → parent is gone → die immediately.
process.on('disconnect', () => suicide(1));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Hot worker unhandled rejection, suicide');
  suicide(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Hot worker uncaught exception, suicide');
  suicide(1);
});

interface HotRequest {
  id?: number;
  op?: string;
  args?: Record<string, unknown>;
}

function reply(id: number, ok: boolean, result?: unknown, error?: string): void {
  try {
    process.send?.({ id, ok, result, error });
  } catch {
    // Parent gone — suicide watchdogs will fire; nothing more to do.
  }
}

// ---- Heavy stack lives here (single owner of the DB handle) ----
const cache = MOCK ? null : new SqliteCache();
const budgetManager = MOCK ? null : new BudgetManager();
const rateLimitStore = MOCK ? null : new RateLimitStore(DATA_DIR, buildProviderLimits(config));
const router = MOCK || !rateLimitStore ? null : new ProviderRouter(rateLimitStore);

let semanticCache: SemanticCache | undefined;
let embeddingService: EmbeddingService | undefined;
let classifier: IntentClassifier | undefined;

if (!MOCK && cache) {
  if (config.SEMANTIC_ENABLED) {
    semanticCache = new SemanticCache(cache.getDb());
    semanticCache.init();
    embeddingService = new EmbeddingService();
  }
  classifier = new IntentClassifier(
    config.INTENT_CLASSIFIER_MODEL,
    0.45,
    undefined,
    config.MODEL_IDLE_TIMEOUT_SEC * 1000,
  );
  if (config.MODEL_PRELOAD && embeddingService) {
    await embeddingService.ensureLoaded().catch((err) => {
      logger.warn({ err }, 'Hot worker prewarm failed, will load on first search');
    });
  }
}

const sessionStore = MOCK ? null : new SessionStore(
  config.SESSION_DEDUP_WINDOW_MINUTES,
  config.SESSION_DEDUP_STRETCH_MINUTES,
);

const orchestrator = MOCK || !budgetManager || !cache || !router || !sessionStore
  ? null
  : new Orchestrator(budgetManager, cache, router, semanticCache, embeddingService, classifier, sessionStore);

function shutdown(): void {
  try {
    rateLimitStore?.flush();
  } catch (err) {
    logger.error({ err }, 'Error flushing rate limit store');
  }
  try {
    embeddingService?.dispose();
  } catch (err) {
    logger.error({ err }, 'Error disposing embedding model');
  }
  try {
    classifier?.dispose();
  } catch (err) {
    logger.error({ err }, 'Error disposing NLI model');
  }
  try {
    cache?.close();
  } catch (err) {
    logger.error({ err }, 'Error closing cache');
  }
}

async function handle(msg: HotRequest): Promise<void> {
  const id = typeof msg.id === 'number' ? msg.id : -1;
  const op = msg.op;
  const args = msg.args ?? {};
  try {
    switch (op) {
      case 'ping':
        reply(id, true, { pid: process.pid, mock: MOCK });
        return;
      case 'stats':
        reply(id, true, {
          pid: process.pid,
          mock: MOCK,
          embeddingLoaded: embeddingService?.isLoaded ?? false,
          nliLoaded: classifier?.isLoaded ?? false,
        });
        return;
      case 'shutdown':
        reply(id, true, {});
        shutdown();
        setImmediate(() => suicide(0));
        return;
      case 'search': {
        if (MOCK || !orchestrator || !classifier) {
          reply(id, true, { response: { results: [], meta: { total_results: 0, cached: false, query_normalized: '', search_time_ms: 0, session_deduped_count: 0 } } });
          return;
        }
        const query = String(args.query ?? '');
        const classification = await classifier.classify(query);
        const response = await orchestrator.search({ query, intent: classification.intent });
        reply(id, true, { response });
        return;
      }
      case 'status': {
        if (MOCK || !cache || !router || !budgetManager) {
          reply(id, true, {
            status: {
              cache: { total_queries: 0, total_results: 0, total_pages: 0, db_size_mb: 0 },
              providers: [],
              budget: { searches_remaining: 0, fetches_remaining: 0 },
              models: { embedding_loaded: false, nli_loaded: false },
            },
          });
          return;
        }
        const remaining = budgetManager.getRemaining();
        reply(id, true, {
          status: {
            cache: cache.getStats(),
            providers: router.getProviderStats(),
            budget: { searches_remaining: remaining.searches, fetches_remaining: remaining.fetches },
            models: {
              embedding_loaded: embeddingService?.isLoaded ?? false,
              nli_loaded: classifier?.isLoaded ?? false,
            },
          },
        });
        return;
      }
      case 'reportUsage': {
        if (MOCK || !cache) {
          reply(id, true, { updated: false });
          return;
        }
        const updated = cache.updateSearchLogUsage(
          String(args.search_id ?? ''),
          (args.used_doc_ids as string[]) ?? [],
        );
        reply(id, true, { updated });
        return;
      }
      default:
        reply(id, false, undefined, `Unknown op: ${op}`);
    }
  } catch (err) {
    reply(id, false, undefined, err instanceof Error ? err.message : String(err));
  }
}

process.on('message', (msg: unknown) => {
  void handle((msg ?? {}) as HotRequest);
});

logger.info({ pid: process.pid, mock: MOCK }, 'Hot worker online');
