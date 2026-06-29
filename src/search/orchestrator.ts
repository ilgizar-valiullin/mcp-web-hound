import { BudgetManager } from '../limits/budget-manager.js';
import { SessionStore } from '../limits/session-store.js';
import { SqliteCache } from '../cache/sqlite.js';
import { SemanticCache } from '../cache/semantic-cache.js';
import { ProviderRouter } from './provider-router.js';
import { processQuery } from './query-normalizer.js';
import { rerankResults, deduplicateResults, normalizeUrl } from './reranker.js';
import { EmbeddingService } from '../embeddings/embedding-service.js';
import { IntentClassifier } from './intent-classifier.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { SearchRequest, SearchResponse, SearchResult } from '../utils/types.js';

interface TTLConfig {
  base: number;
}

const TTL_BY_INTENT: Record<string, TTLConfig> = {
  web: { base: 6 * 3600 },
  docs: { base: 3 * 3600 },
  news: { base: 30 * 60 },
  github: { base: 4 * 3600 },
};

function calculateTTL(intent: string): number {
  return TTL_BY_INTENT[intent]?.base ?? TTL_BY_INTENT.web.base;
}

export class Orchestrator {
  private budgetManager: BudgetManager;
  private cache: SqliteCache;
  private semanticCache?: SemanticCache;
  private router: ProviderRouter;
  private embeddingService?: EmbeddingService;
  private classifier?: IntentClassifier;
  private sessionStore?: SessionStore;

  constructor(
    budgetManager: BudgetManager,
    cache: SqliteCache,
    router: ProviderRouter,
    semanticCache?: SemanticCache,
    embeddingService?: EmbeddingService,
    classifier?: IntentClassifier,
    sessionStore?: SessionStore,
  ) {
    this.budgetManager = budgetManager;
    this.cache = cache;
    this.router = router;
    this.semanticCache = semanticCache;
    this.embeddingService = embeddingService;
    this.classifier = classifier;
    this.sessionStore = sessionStore;
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const startTime = Date.now();
    const { normalized, cacheKey } = processQuery(request.query, request.intent);

    const requiresFreshness = this.classifier
      ? await this.classifier.classifyFreshness(request.query)
      : false;

    const budgetCheck = this.budgetManager.checkBudget('search');
    if (!budgetCheck.allowed) {
      return {
        results: [],
        meta: {
          total_results: 0,
          cached: false,
          query_normalized: normalized,
          search_time_ms: Date.now() - startTime,
          session_deduped_count: 0,
        },
      };
    }

    if (this.semanticCache && this.embeddingService && config.SEMANTIC_ENABLED) {
      try {
        const embedding = await this.embeddingService.embed(request.query);

        const similarQueryId = this.budgetManager.isDuplicate(embedding);
        if (similarQueryId) {
          const cached = this.cache.getQuery(similarQueryId.cacheKey);
          if (cached) {
            logger.info({ query: request.query, similarTo: cached.queryNorm }, 'Semantic dedup hit');
            return {
              results: cached.results,
              meta: {
                total_results: cached.results.length,
                cached: true,
                query_normalized: cached.queryNorm,
                search_time_ms: Date.now() - startTime,
                session_deduped_count: 0,
              },
            };
          }
        }

        const semanticHit = this.semanticCache.findSimilar(embedding);
        if (semanticHit) {
          const resolvedQuery = this.cache.getQueryById(semanticHit.queryId);
          if (resolvedQuery) {
            logger.info({ query: request.query, similarity: (1 - semanticHit.distance).toFixed(3) }, 'Semantic cache hit');
            return {
              results: resolvedQuery.results,
              meta: {
                total_results: resolvedQuery.results.length,
                cached: true,
                query_normalized: resolvedQuery.queryNorm,
                search_time_ms: Date.now() - startTime,
                session_deduped_count: 0,
              },
            };
          }
        }
      } catch (err) {
        logger.error({ err }, 'Semantic cache check failed, falling through');
      }
    }

    const cached = this.cache.getQuery(cacheKey);
    if (cached) {
      logger.debug({ cacheKey }, 'Exact cache hit');
      this.budgetManager.addToDedupBuffer({
        normalized: cached.queryNorm,
        embedding: [],
        timestamp: Date.now(),
        cacheKey,
        queryId: cached.id,
      });
      return {
        results: cached.results,
        meta: {
          total_results: cached.results.length,
          cached: true,
          query_normalized: cached.queryNorm,
          search_time_ms: Date.now() - startTime,
          session_deduped_count: 0,
        },
      };
    }

    if (this.semanticCache && this.embeddingService && config.SEMANTIC_ENABLED) {
      try {
        const embedding = await this.embeddingService.embed(request.query);
        this.budgetManager.addToDedupBuffer({
          normalized,
          embedding,
          timestamp: Date.now(),
          cacheKey,
          queryId: 0,
        });
      } catch (err) {
        logger.error({ err }, 'Failed to compute embedding for dedup');
      }
    }

    this.budgetManager.recordUsage('search');

    const searchTimeout = AbortSignal.timeout(config.SEARCH_TIMEOUT_MS);
    const providerResults = await Promise.race([
      this.router.search(normalized, {
        intent: request.intent,
        freshness: requiresFreshness ? 'day' : 'any',
        max_results: 20,
      }),
      new Promise<never>((_, reject) => {
        searchTimeout.onabort = () => reject(new Error(`Search timed out after ${config.SEARCH_TIMEOUT_MS}ms`));
      }),
    ]);

    const deduped = deduplicateResults(providerResults);
    let nliScores: number[] | undefined;

    if (this.classifier) {
      nliScores = await Promise.all(
        deduped.map(async (r) => {
          const text = r.snippet || r.title;
          if (!text) return 0.5;
          try {
            return await this.classifier!.scoreEntailment(request.query, text);
          } catch {
            return 0.5;
          }
        }),
      );
    }

    const scoredResults = rerankResults(deduped, requiresFreshness, nliScores, true);

    let searchResults: SearchResult[];
    let sessionDedupedCount = 0;

    if (this.sessionStore?.enabled) {
      const filtered: SearchResult[] = [];
      for (const r of scoredResults) {
        if (filtered.length >= config.MAX_RESULTS_AFTER_RERANK) break;
        const normalizedUrl = normalizeUrl(r.url);
        if (this.sessionStore.isSeen(normalizedUrl)) {
          sessionDedupedCount++;
          continue;
        }
        filtered.push({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          published_date: r.published_date,
          source: r.provider,
          relevance_score: r.relevance_score,
        });
      }
      searchResults = filtered;
      this.sessionStore.markSeen(filtered.map((r) => normalizeUrl(r.url)));
    } else {
      searchResults = scoredResults.slice(0, config.MAX_RESULTS_AFTER_RERANK).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        published_date: r.published_date,
        source: r.provider,
        relevance_score: r.relevance_score,
      }));
    }

    const ttl = calculateTTL(request.intent);
    this.cache.setQuery(cacheKey, request.query, normalized, request.intent, searchResults, ttl);

    const insertedQuery = this.cache.getQuery(cacheKey);
    if (insertedQuery && this.semanticCache && this.embeddingService && config.SEMANTIC_ENABLED) {
      try {
        const embedding = await this.embeddingService.embed(request.query);
        this.semanticCache.index(insertedQuery.id, embedding);
        logger.debug({ queryId: insertedQuery.id }, 'Semantic index updated');
      } catch (err) {
        logger.error({ err }, 'Failed to index embedding');
      }
    }

    return {
      results: searchResults,
      meta: {
        total_results: searchResults.length,
        cached: false,
        query_normalized: normalized,
        search_time_ms: Date.now() - startTime,
        session_deduped_count: sessionDedupedCount,
      },
    };
  }
}
