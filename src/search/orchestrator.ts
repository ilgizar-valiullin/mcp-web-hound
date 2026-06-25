import { BudgetManager } from '../limits/budget-manager.js';
import { SqliteCache } from '../cache/sqlite.js';
import { SemanticCache } from '../cache/semantic-cache.js';
import { ProviderRouter } from './provider-router.js';
import { processQuery } from './query-normalizer.js';
import { rerankResults } from './reranker.js';
import { Fetcher } from '../fetch/fetcher.js';
import { extractContent, truncateContent } from '../fetch/readability.js';
import { EmbeddingService } from '../embeddings/embedding-service.js';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { SearchRequest, SearchResponse, SearchResult } from '../utils/types.js';

interface TTLConfig {
  base: number;
  freshnessMultiplier: Record<string, number>;
}

const TTL_BY_INTENT: Record<string, TTLConfig> = {
  web: { base: 6 * 3600, freshnessMultiplier: { any: 1.0, month: 0.8, week: 0.5, day: 0.2 } },
  docs: { base: 3 * 3600, freshnessMultiplier: { any: 1.0, month: 0.8, week: 0.5, day: 0.2 } },
  news: { base: 30 * 60, freshnessMultiplier: { any: 1.0, month: 0.8, week: 0.5, day: 0.2 } },
  github: { base: 4 * 3600, freshnessMultiplier: { any: 1.0, month: 0.8, week: 0.5, day: 0.2 } },
};

function calculateTTL(intent: string, freshness: string): number {
  const ttlConfig = TTL_BY_INTENT[intent] ?? TTL_BY_INTENT.web;
  const multiplier = ttlConfig.freshnessMultiplier[freshness] ?? 1.0;
  return Math.floor(ttlConfig.base * multiplier);
}

const PAGE_TTL: Record<string, number> = {
  docs: 7 * 24 * 3600,
  readthedocs: 7 * 24 * 3600,
  developer: 5 * 24 * 3600,
  'github.com': 2 * 24 * 3600,
  stackoverflow: 3 * 24 * 3600,
  'medium.com': 1 * 24 * 3600,
  'dev.to': 1 * 24 * 3600,
};

function getPageTTL(url: string): number {
  try {
    const hostname = new URL(url).hostname;
    for (const [key, ttl] of Object.entries(PAGE_TTL)) {
      if (hostname.includes(key)) return ttl;
    }
  } catch {
    // fall through to default
  }
  return 2 * 24 * 3600;
}

export class Orchestrator {
  private budgetManager: BudgetManager;
  private cache: SqliteCache;
  private semanticCache?: SemanticCache;
  private router: ProviderRouter;
  private fetcher: Fetcher;
  private embeddingService?: EmbeddingService;

  constructor(
    budgetManager: BudgetManager,
    cache: SqliteCache,
    router: ProviderRouter,
    fetcher: Fetcher,
    semanticCache?: SemanticCache,
    embeddingService?: EmbeddingService,
  ) {
    this.budgetManager = budgetManager;
    this.cache = cache;
    this.router = router;
    this.fetcher = fetcher;
    this.semanticCache = semanticCache;
    this.embeddingService = embeddingService;
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const startTime = Date.now();
    const { normalized, cacheKey } = processQuery(request.query, request.intent, request.freshness);

    const budgetCheck = this.budgetManager.checkBudget('search');
    if (!budgetCheck.allowed) {
      return {
        results: [],
        meta: {
          total_results: 0,
          cached: false,
          query_normalized: normalized,
          search_time_ms: Date.now() - startTime,
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
              results: this.enrichResults(cached.results, request.include_content),
              meta: {
                total_results: cached.results.length,
                cached: true,
                query_normalized: cached.queryNorm,
                search_time_ms: Date.now() - startTime,
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
              results: this.enrichResults(resolvedQuery.results, request.include_content),
              meta: {
                total_results: resolvedQuery.results.length,
                cached: true,
                query_normalized: resolvedQuery.queryNorm,
                search_time_ms: Date.now() - startTime,
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
        results: this.enrichResults(cached.results, request.include_content),
        meta: {
          total_results: cached.results.length,
          cached: true,
          query_normalized: cached.queryNorm,
          search_time_ms: Date.now() - startTime,
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

    const providerResults = await this.router.search(normalized, {
      intent: request.intent,
      freshness: request.freshness,
      max_results: request.max_results * 2,
    });

    let queryEmbedding: number[] | undefined;

    if (this.embeddingService && config.SEMANTIC_ENABLED) {
      try {
        queryEmbedding = await this.embeddingService.embed(request.query);
      } catch (err) {
        logger.debug({ err }, 'Failed to compute query embedding for reranking');
      }
    }

    const scoredResults = rerankResults(providerResults, request.intent, queryEmbedding);
    const topResults = scoredResults.slice(0, request.max_results);

    const searchResults: SearchResult[] = topResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      published_date: r.published_date,
      source: r.provider,
      relevance_score: r.relevance_score,
    }));

    const ttl = calculateTTL(request.intent, request.freshness);
    this.cache.setQuery(cacheKey, request.query, normalized, request.intent, request.freshness, searchResults, ttl);

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

    if (request.include_content) {
      await this.fetchContentForResults(searchResults);
    }

    return {
      results: searchResults,
      meta: {
        total_results: searchResults.length,
        cached: false,
        query_normalized: normalized,
        search_time_ms: Date.now() - startTime,
      },
    };
  }

  private async fetchContentForResults(results: SearchResult[]): Promise<void> {
    const fetchPromises = results.map(async (result) => {
      const cachedPage = this.cache.getPage(result.url);
      if (cachedPage) {
        result.content = cachedPage.content;
        return;
      }

      const budgetCheck = this.budgetManager.checkBudget('fetch');
      if (!budgetCheck.allowed) {
        logger.warn({ url: result.url }, 'Fetch budget exceeded, skipping content fetch');
        return;
      }

      try {
        this.budgetManager.recordUsage('fetch');
        const fetched = await this.fetcher.fetch(result.url);

        if (fetched.statusCode === 200 && fetched.content) {
          const extracted = extractContent(fetched.content, result.url);

          if (extracted) {
            const content = truncateContent(extracted.content);

            const ttl = getPageTTL(result.url);
            this.cache.setPage(result.url, content, extracted.title, fetched.fetchTimeMs, fetched.statusCode, ttl);

            result.content = content;
          }
        }
      } catch (err) {
        logger.error({ err, url: result.url }, 'Failed to fetch content');
      }
    });

    await Promise.allSettled(fetchPromises);
  }

  private enrichResults(results: SearchResult[], includeContent: boolean): SearchResult[] {
    if (!includeContent) return results;

    return results.map((r) => {
      if (!r.content) {
        const cachedPage = this.cache.getPage(r.url);
        if (cachedPage) {
          return { ...r, content: cachedPage.content };
        }
      }
      return r;
    });
  }
}
