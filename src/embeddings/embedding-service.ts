import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

type FeatureExtractionPipeline = {
  (texts: string | string[], options?: { pooling?: string; normalize?: boolean }): Promise<{
    data: Float32Array;
    dims: number[];
    size: number;
  }>;
};

export class EmbeddingService {
  private pipeline: FeatureExtractionPipeline | null = null;
  private modelLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private modelId: string;

  constructor() {
    const model = config.EMBEDDING_MODEL;
    this.modelId = model.startsWith('Xenova/') || model.startsWith('Xenova') ? model : `Xenova/${model}`;
  }

  async ensureLoaded(): Promise<void> {
    if (this.modelLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.loadModel();
    return this.loadPromise;
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

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();

    const prefixed = `query: ${text}`;
    const result = await this.pipeline!(prefixed, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(result.data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensureLoaded();

    const prefixed = texts.map((t) => `query: ${t}`);
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
