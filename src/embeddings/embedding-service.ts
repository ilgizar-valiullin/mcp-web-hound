import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

type FeatureExtractionPipeline = {
  (texts: string | string[], options?: { pooling?: string; normalize?: boolean }): Promise<{
    data: Float32Array;
    dims: number[];
    size: number;
  }>;
  dispose?: () => Promise<unknown>;
};

export class EmbeddingService {
  private pipeline: FeatureExtractionPipeline | null = null;
  private modelLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private modelId: string;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private activeRequests = 0;
  private readonly idleTimeoutMs: number;

  constructor(idleTimeoutMs?: number) {
    const model = config.EMBEDDING_MODEL;
    this.modelId = model.startsWith('Xenova/') || model.startsWith('Xenova') ? model : `Xenova/${model}`;
    this.idleTimeoutMs = idleTimeoutMs ?? config.MODEL_IDLE_TIMEOUT_SEC * 1000;
  }

  async ensureLoaded(): Promise<void> {
    if (this.modelLoaded) {
      this.touch();
      return;
    }
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.loadModel();
    await this.loadPromise;
    this.touch();
  }

  /** Free ONNX sessions + reset state. Safe to call anytime; reloads lazily on next embed(). */
  dispose(): void {
    if (this.activeRequests > 0) {
      // Request in flight — defer unload until it finishes.
      this.scheduleUnload();
      return;
    }
    this.cancelUnload();
    if (this.modelLoaded || this.pipeline) {
      logger.info({ model: this.modelId }, 'Unloading embedding model after idle timeout');
    }
    const p = this.pipeline;
    this.pipeline = null;
    this.modelLoaded = false;
    this.loadPromise = null;
    // Actually release ONNX InferenceSessions — nulling refs alone keeps
    // native/WASM memory committed until GC finalizers (which may never run).
    if (p?.dispose) {
      void Promise.resolve()
        .then(() => p.dispose!())
        .catch((err) => logger.warn({ err, model: this.modelId }, 'Embedding pipeline dispose failed'));
    }
  }

  private touch(): void {
    this.cancelUnload();
    this.scheduleUnload();
  }

  private cancelUnload(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private scheduleUnload(): void {
    if (this.idleTimeoutMs <= 0) return;
    if (!this.modelLoaded) return;
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.dispose();
    }, this.idleTimeoutMs);
    if (typeof (this.idleTimer as unknown as NodeJS.Timeout).unref === 'function') {
      (this.idleTimer as unknown as NodeJS.Timeout).unref();
    }
  }

  private async loadModel(): Promise<void> {
    try {
      logger.info({ model: this.modelId }, 'Loading embedding model');

      const { pipeline } = await import('@xenova/transformers');

      this.pipeline = (await pipeline(
        'feature-extraction',
        this.modelId,
      )) as unknown as FeatureExtractionPipeline;

      this.modelLoaded = true;
      logger.info({ model: this.modelId }, 'Embedding model loaded');
    } catch (err) {
      logger.warn({ err, model: this.modelId }, 'Failed to load embedding model, semantic features disabled');
      this.modelLoaded = false;
      this.loadPromise = null;
    }
  }

  async embed(text: string, prefix: string = 'query'): Promise<number[]> {
    this.activeRequests++;
    this.cancelUnload();
    try {
      await this.ensureLoaded();

      const prefixed = `${prefix}: ${text}`;
      const result = await this.pipeline!(prefixed, {
        pooling: 'mean',
        normalize: true,
      });

      return Array.from(result.data);
    } finally {
      this.activeRequests--;
      if (this.activeRequests <= 0) {
        this.activeRequests = 0;
        this.touch();
      }
    }
  }

  async embedBatch(texts: string[], prefix: string = 'query'): Promise<number[][]> {
    this.activeRequests++;
    this.cancelUnload();
    try {
      await this.ensureLoaded();

      const prefixed = texts.map((t) => `${prefix}: ${t}`);
      const result = await this.pipeline!(prefixed, {
        pooling: 'mean',
        normalize: true,
      });

      const dims = result.dims;
      const vectorDim = dims[dims.length - 1];
      const vectors: number[][] = [];

      for (let i = 0; i < texts.length; i++) {
        const start = i * vectorDim;
        const slice = result.data.slice(start, start + vectorDim);
        vectors.push(Array.from(slice));
      }

      return vectors;
    } finally {
      this.activeRequests--;
      if (this.activeRequests <= 0) {
        this.activeRequests = 0;
        this.touch();
      }
    }
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error(`Vectors must have same dimension: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  get isLoaded(): boolean {
    return this.modelLoaded;
  }

  get dimension(): number {
    return config.EMBEDDING_DIMENSION;
  }
}
