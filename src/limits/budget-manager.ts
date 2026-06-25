import { config } from '../utils/config.js';
import type { BudgetCheckResult, TaskBudget } from '../utils/types.js';
import { EmbeddingService } from '../embeddings/embedding-service.js';

interface RecentQuery {
  normalized: string;
  embedding: number[];
  timestamp: number;
  cacheKey: string;
  queryId: number;
}

export class BudgetManager {
  private budget: TaskBudget = {
    window_start: Date.now(),
    window_minutes: config.BUDGET_WINDOW_MINUTES,
    max_searches: config.BUDGET_MAX_SEARCHES,
    max_fetches: config.BUDGET_MAX_FETCHES,
    searches_used: 0,
    fetches_used: 0,
  };

  private dedupBuffer: RecentQuery[] = [];
  private dedupMaxSize = 50;
  private dedupTtlMs = 30 * 60 * 1000;
  isDuplicate(embedding: number[]): RecentQuery | null {
    this.evictExpiredDedup();

    for (const recent of this.dedupBuffer) {
      const similarity = EmbeddingService.cosineSimilarity(embedding, recent.embedding);
      if (similarity >= config.SEMANTIC_THRESHOLD) {
        return recent;
      }
    }

    return null;
  }

  addToDedupBuffer(entry: RecentQuery): void {
    this.dedupBuffer.push(entry);

    if (this.dedupBuffer.length > this.dedupMaxSize) {
      this.dedupBuffer.sort((a, b) => b.timestamp - a.timestamp);
      this.dedupBuffer = this.dedupBuffer.slice(0, this.dedupMaxSize);
    }
  }

  checkBudget(type: 'search' | 'fetch'): BudgetCheckResult {
    this.resetIfExpired();

    if (type === 'search') {
      const remaining = this.budget.max_searches - this.budget.searches_used;
      if (remaining <= 0) {
        return {
          allowed: false,
          remaining: 0,
          message: `Search budget exhausted: ${this.budget.searches_used}/${this.budget.max_searches} searches used in current ${this.budget.window_minutes}-minute window`,
        };
      }
      return { allowed: true, remaining };
    }

    const remaining = this.budget.max_fetches - this.budget.fetches_used;
    if (remaining <= 0) {
      return {
        allowed: false,
        remaining: 0,
        message: `Fetch budget exhausted: ${this.budget.fetches_used}/${this.budget.max_fetches} fetches used in current ${this.budget.window_minutes}-minute window`,
      };
    }
    return { allowed: true, remaining };
  }

  recordUsage(type: 'search' | 'fetch'): void {
    this.resetIfExpired();

    if (type === 'search') {
      this.budget.searches_used++;
    } else {
      this.budget.fetches_used++;
    }
  }

  getRemaining(): { searches: number; fetches: number } {
    this.resetIfExpired();
    return {
      searches: this.budget.max_searches - this.budget.searches_used,
      fetches: this.budget.max_fetches - this.budget.fetches_used,
    };
  }

  getWindowInfo(): { windowStart: number; windowMinutes: number; searchesUsed: number; fetchesUsed: number; maxSearches: number; maxFetches: number } {
    return {
      windowStart: this.budget.window_start,
      windowMinutes: this.budget.window_minutes,
      maxSearches: this.budget.max_searches,
      maxFetches: this.budget.max_fetches,
      searchesUsed: this.budget.searches_used,
      fetchesUsed: this.budget.fetches_used,
    };
  }

  resetWindow(): void {
    this.budget.window_start = Date.now();
    this.budget.searches_used = 0;
    this.budget.fetches_used = 0;
  }

  private resetIfExpired(): void {
    const elapsed = Date.now() - this.budget.window_start;
    const windowMs = this.budget.window_minutes * 60 * 1000;

    if (elapsed >= windowMs) {
      this.resetWindow();
    }
  }

  private evictExpiredDedup(): void {
    const now = Date.now();
    this.dedupBuffer = this.dedupBuffer.filter((q) => now - q.timestamp < this.dedupTtlMs);
  }
}
