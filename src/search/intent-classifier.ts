import { EmbeddingService } from '../embeddings/embedding-service.js';
import { logger } from '../utils/logger.js';

type Intent = 'web' | 'docs' | 'github' | 'news';

const INTENT_ANCHORS: Record<Intent, string> = {
  github:
    'source code, git repository, github issue, pull request, scripts, code implementation, programming library, source files',
  docs: 'official documentation, api reference, technical manual, user guide, configuration parameters, function signature, developer docs',
  news: 'latest tech news, product announcement, recent release, updates, industry events, what is new today, tech blog posts',
  web: 'general web search, internet articles, wikipedia, discussion forums, public knowledge, general information, overview',
};

export class IntentClassifier {
  private embeddingService?: EmbeddingService;
  private anchorVectors: Map<string, number[]> | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly confidenceThreshold: number;
  private readonly ambiguityThreshold: number;

  constructor(
    embeddingService?: EmbeddingService,
    confidenceThreshold: number = 0.73,
    ambiguityThreshold: number = 0.04,
  ) {
    this.embeddingService = embeddingService;
    this.confidenceThreshold = confidenceThreshold;
    this.ambiguityThreshold = ambiguityThreshold;
  }

  async classify(query: string): Promise<Intent> {
    return this.classifyByEmbedding(query);
  }

  private async classifyByEmbedding(query: string): Promise<Intent> {
    if (!this.embeddingService?.isLoaded) return 'web';

    await this.ensureAnchorsReady();
    if (!this.anchorVectors || this.anchorVectors.size === 0) return 'web';

    try {
      const queryVec = await this.embeddingService.embed(query);
      const scores: Array<[Intent, number]> = [];

      for (const [intent, anchorVec] of this.anchorVectors.entries()) {
        const score = EmbeddingService.cosineSimilarity(queryVec, anchorVec);
        scores.push([intent as Intent, score]);
      }

      scores.sort((a, b) => b[1] - a[1]);

      const [bestIntent, bestScore] = scores[0];
      const secondScore = scores[1][1];

      logger.debug(
        { query, scores: scores.map(([i, s]) => `${i}=${s.toFixed(3)}`), bestScore: bestScore.toFixed(3) },
        'Intent scores',
      );

      if (bestScore < this.confidenceThreshold || bestScore - secondScore < this.ambiguityThreshold) {
        return 'web';
      }

      return bestIntent;
    } catch (err) {
      logger.error({ err }, 'Embedding classification failed, falling back to web');
      return 'web';
    }
  }

  private async ensureAnchorsReady(): Promise<void> {
    if (this.anchorVectors) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.initAnchors();
    await this.initPromise;
  }

  private async initAnchors(): Promise<void> {
    if (!this.embeddingService) return;

    try {
      const intents = Object.keys(INTENT_ANCHORS) as Intent[];
      const passages = intents.map((i) => INTENT_ANCHORS[i]);
      const embeddings = await this.embeddingService.embedBatch(passages, 'passage');

      const map = new Map<string, number[]>();
      for (let i = 0; i < intents.length; i++) {
        map.set(intents[i], embeddings[i]);
      }

      this.anchorVectors = map;
      logger.info({ intents }, 'Intent anchor vectors computed');
    } catch (err) {
      logger.error({ err }, 'Failed to compute intent anchor vectors');
      this.anchorVectors = new Map();
    }
  }
}
