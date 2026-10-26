import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { EmbeddingService } from '../embeddings/embedding-service.js';
import { IntentClassifier, type ClassifierResult } from '../search/intent-classifier.js';
import { ModelWorkerManager, WorkerSpawnError } from './manager.js';

/**
 * Worker-backed facades: same public API as the in-process services
 * (subclasses, so Orchestrator/search/status need no changes), but inference
 * runs in a private child process killed on idle — the OS reclaims native
 * ONNX memory fully, unlike in-process dispose() (~50% retained arena).
 *
 * Error contracts match the base classes (rule: provider errors never crash):
 * - embed/embedBatch may throw (orchestrator already try/catches these);
 * - classify* never throw (safe fallbacks, like the base class).
 */
export class WorkerEmbeddingService extends EmbeddingService {
  private readonly mgr: ModelWorkerManager;
  private localFallback = false;

  constructor(mgr: ModelWorkerManager) {
    super(0);
    this.mgr = mgr;
  }

  override async ensureLoaded(): Promise<void> {
    if (this.localFallback) {
      await super.ensureLoaded();
      return;
    }
    try {
      await this.mgr.ensureSpawned();
    } catch (err) {
      if (err instanceof WorkerSpawnError) {
        this.useLocalFallback(err);
        await super.ensureLoaded();
        return;
      }
      throw err;
    }
  }

  override async embed(text: string, prefix = 'query'): Promise<number[]> {
    if (this.localFallback) return super.embed(text, prefix);
    try {
      return await this.mgr.op<number[]>('embed', { text, prefix });
    } catch (err) {
      if (err instanceof WorkerSpawnError) {
        this.useLocalFallback(err);
        return super.embed(text, prefix);
      }
      throw err;
    }
  }

  override async embedBatch(texts: string[], prefix = 'query'): Promise<number[][]> {
    if (this.localFallback) return super.embedBatch(texts, prefix);
    try {
      return await this.mgr.op<number[][]>('embedBatch', { texts, prefix });
    } catch (err) {
      if (err instanceof WorkerSpawnError) {
        this.useLocalFallback(err);
        return super.embedBatch(texts, prefix);
      }
      throw err;
    }
  }

  override get isLoaded(): boolean {
    if (this.localFallback) return super.isLoaded;
    return this.mgr.isAlive && this.mgr.flags.embeddingLoaded;
  }

  override dispose(): void {
    // Lifecycle owned by the manager (idle-kill + index cleanup).
    // Local fallback still needs explicit unload.
    if (this.localFallback) super.dispose();
  }

  private useLocalFallback(err: Error): void {
    if (!this.localFallback) {
      this.localFallback = true;
      logger.warn({ err: err.message }, 'Model worker unavailable, in-process fallback (dev only)');
    }
  }
}

export class WorkerClassifier extends IntentClassifier {
  private readonly mgr: ModelWorkerManager;
  private localFallback = false;

  constructor(mgr: ModelWorkerManager) {
    super(config.INTENT_CLASSIFIER_MODEL, 0.45, undefined, 0);
    this.mgr = mgr;
  }

  override async classify(query: string): Promise<ClassifierResult> {
    if (this.localFallback) return super.classify(query);
    try {
      return await this.mgr.op<ClassifierResult>('classify', { query });
    } catch (err) {
      if (err instanceof WorkerSpawnError) {
        this.useLocalFallback(err);
        return super.classify(query);
      }
      logger.error({ err, query }, 'Worker classify failed, falling back to web');
      return { intent: 'web' };
    }
  }

  override async classifyFreshness(query: string): Promise<boolean> {
    if (this.localFallback) return super.classifyFreshness(query);
    try {
      return await this.mgr.op<boolean>('classifyFreshness', { query });
    } catch (err) {
      if (err instanceof WorkerSpawnError) {
        this.useLocalFallback(err);
        return super.classifyFreshness(query);
      }
      logger.error({ err, query }, 'Worker freshness check failed, defaulting to false');
      return false;
    }
  }

  override async scoreEntailment(query: string, text: string): Promise<number> {
    if (this.localFallback) return super.scoreEntailment(query, text);
    try {
      return await this.mgr.op<number>('scoreEntailment', { query, text });
    } catch (err) {
      if (err instanceof WorkerSpawnError) {
        this.useLocalFallback(err);
        return super.scoreEntailment(query, text);
      }
      return 0.5;
    }
  }

  override get isLoaded(): boolean {
    if (this.localFallback) return super.isLoaded;
    return this.mgr.isAlive && this.mgr.flags.nliLoaded;
  }

  override dispose(): void {
    if (this.localFallback) super.dispose();
  }

  private useLocalFallback(err: Error): void {
    if (!this.localFallback) {
      this.localFallback = true;
      logger.warn({ err: err.message }, 'Model worker unavailable, in-process fallback (dev only)');
    }
  }
}
