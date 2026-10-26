#!/usr/bin/env node
/**
 * Private model worker: hosts ONNX embedding + NLI pipelines in a child
 * process of one MCP server. Dies instantly on parent death (suicide) so it
 * can never leak — the OS reclaims ALL native memory, no dispose needed.
 *
 * stdout is ignored by the parent (MCP protocol lives there); logs go to
 * stderr via MCP_WORKER=1 (see utils/logger.ts).
 */
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { EmbeddingService } from '../embeddings/embedding-service.js';
import { IntentClassifier } from '../search/intent-classifier.js';
import { installParentWatchdog } from '../utils/parent-watchdog.js';

const MOCK = process.env.MODEL_WORKER_MOCK === '1';
const EMBEDDING_DIM = 384;

function suicide(code: number): never {
  // Instant exit — no pipeline.dispose(): the whole point is that death
  // itself frees every byte of native/WASM memory immediately.
  process.exit(code);
}

// Parent dead → die. Covers SIGKILL/OOM/crash of the MCP server where no
// cleanup runs. Fast poll: this process exists only to serve one parent.
installParentWatchdog({
  intervalMs: 2000,
  onParentDeath: () => undefined,
});

// fork() IPC channel closed → parent is gone → die immediately.
process.on('disconnect', () => suicide(1));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Model worker unhandled rejection, suicide');
  suicide(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Model worker uncaught exception, suicide');
  suicide(1);
});

const emb = new EmbeddingService(0);
const clf = new IntentClassifier(config.INTENT_CLASSIFIER_MODEL, 0.45, undefined, 0);

interface WorkerRequest {
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

async function handle(msg: WorkerRequest): Promise<void> {
  const id = typeof msg.id === 'number' ? msg.id : -1;
  const op = msg.op;
  const args = msg.args ?? {};
  try {
    switch (op) {
      case 'ping':
        reply(id, true, { pid: process.pid, mock: MOCK });
        return;
      case 'stats':
        reply(
          id,
          true,
          MOCK
            ? { embeddingLoaded: false, nliLoaded: false, mock: true, pid: process.pid }
            : { embeddingLoaded: emb.isLoaded, nliLoaded: clf.isLoaded, mock: false, pid: process.pid },
        );
        return;
      case 'shutdown':
        reply(id, true, {});
        setImmediate(() => suicide(0));
        return;
      case 'embed': {
        if (MOCK) {
          reply(id, true, new Array(EMBEDDING_DIM).fill(0.1));
          return;
        }
        reply(id, true, await emb.embed(String(args.text ?? ''), String(args.prefix ?? 'query')));
        return;
      }
      case 'embedBatch': {
        if (MOCK) {
          const texts = (args.texts as string[]) ?? [];
          reply(id, true, texts.map(() => new Array(EMBEDDING_DIM).fill(0.1)));
          return;
        }
        reply(
          id,
          true,
          await emb.embedBatch((args.texts as string[]) ?? [], String(args.prefix ?? 'query')),
        );
        return;
      }
      case 'classify': {
        if (MOCK) {
          reply(id, true, { intent: 'web' });
          return;
        }
        reply(id, true, await clf.classify(String(args.query ?? '')));
        return;
      }
      case 'classifyFreshness': {
        if (MOCK) {
          reply(id, true, false);
          return;
        }
        reply(id, true, await clf.classifyFreshness(String(args.query ?? '')));
        return;
      }
      case 'scoreEntailment': {
        if (MOCK) {
          reply(id, true, 0.5);
          return;
        }
        reply(id, true, await clf.scoreEntailment(String(args.query ?? ''), String(args.text ?? '')));
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
  void handle((msg ?? {}) as WorkerRequest);
});

logger.info({ pid: process.pid, mock: MOCK }, 'Model worker online');
