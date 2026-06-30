import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteCache } from '../src/cache/sqlite.js';
import { rerankResults } from '../src/search/reranker.js';
import type { ProviderResult, SearchLogEntry, CandidateLogEntry } from '../src/utils/types.js';

describe('search log types', () => {
  it('should match SearchLogEntry shape', () => {
    const entry: SearchLogEntry = {
      type: 'search',
      data_role: 'production_log',
      search_id: 'test-id',
      query: 'test query',
      normalized_query: 'test query',
      intent: 'web',
      providers_used: ['startpage'],
      candidates: [
        {
          doc_id: 'abc123def456',
          title: 'Test Doc',
          snippet: 'A test snippet',
          url: 'https://example.com/test',
          provider_rankings: [{ source: 'startpage', engine_rank: 1 }],
        },
      ],
      scoring: {
        'abc123def456': {
          baseline_score: 0.85,
          signals: { nli: 0.9, domain: 0.8, freshness: 1.0, position_bias: 0.82 },
        },
      },
      stats: {
        total_from_providers: 5,
        unique_after_dedup: 3,
        returned_to_agent: 3,
      },
      final_order: ['abc123def456'],
      agent_usage: null,
    system_version: {
      mcp: '1.0.0',
      ranker: 'v1',
      signals: 'v1',
      nli_model: 'Xenova/nli-deberta-v3-xsmall',
    },
    meta: {
      timestamp: '2026-01-01T00:00:00Z',
        latency_ms: 100,
        cache_hit: false,
      },
    };

    expect(entry.type).toBe('search');
    expect(entry.data_role).toBe('production_log');
    expect(entry.candidates).toHaveLength(1);
    expect(entry.scoring).toBeDefined();
    expect(entry.scoring['abc123def456'].signals.nli).toBe(0.9);
  });
});

describe('ScoredResult component scores', () => {
  it('should include nli_score, domain_score, freshness_score, position_score', () => {
    const results: ProviderResult[] = [
      { title: 'A', url: 'https://developer.mozilla.org/docs/a', snippet: 's', raw_position: 1, provider: 'p1' },
    ];

    const scored = rerankResults(results, false, [0.9], false);

    expect(scored[0]).toBeDefined();
    expect(scored[0].nli_score).toBe(0.9);
    expect(scored[0].domain_score).toBeGreaterThan(0);
    expect(scored[0].freshness_score).toBe(1.0);
    expect(scored[0].position_score).toBeGreaterThan(0);
  });

  it('should provide component scores for multiple results', () => {
    const results: ProviderResult[] = [
      { title: 'A', url: 'https://example.com/a', snippet: 's', raw_position: 1, provider: 'p1' },
      { title: 'B', url: 'https://example.com/b', snippet: 't', raw_position: 3, provider: 'p2' },
      { title: 'C', url: 'https://example.com/c', snippet: 'u', raw_position: 5, provider: 'p3' },
    ];

    const scored = rerankResults(results, false, [0.8, 0.6, 0.4], false);

    expect(scored).toHaveLength(3);
    for (const s of scored) {
      expect(s.nli_score).toBeGreaterThan(0);
      expect(s.domain_score).toBeGreaterThan(0);
      expect(s.freshness_score).toBeGreaterThan(0);
      expect(s.position_score).toBeGreaterThan(0);
    }
  });
});

describe('SqliteCache search logging', () => {
  let cache: SqliteCache;
  const testIds = ['test-1', 'test-2', 'test-3', 'export-test-1', 'export-test-2'];

  beforeAll(() => {
    cache = new SqliteCache();
    const del = cache.getDb().prepare('DELETE FROM search_logs WHERE search_id = ?');
    for (const id of testIds) {
      del.run(id);
    }
  });

  afterAll(() => {
    const del = cache.getDb().prepare('DELETE FROM search_logs WHERE search_id = ?');
    for (const id of testIds) {
      del.run(id);
    }
    cache.close();
  });

  const makeEntry = (searchId: string): SearchLogEntry => ({
    type: 'search',
    data_role: 'production_log',
    search_id: searchId,
    query: 'test',
    normalized_query: 'test',
    intent: 'web',
    providers_used: ['startpage'],
    candidates: [
      {
        doc_id: 'abc123',
        title: 'Test',
        snippet: 'snippet',
        url: 'https://example.com/test',
        provider_rankings: [{ source: 'startpage', engine_rank: 1 }],
      },
    ],
    scoring: {
      abc123: {
        baseline_score: 0.85,
        signals: { nli: 0.9, domain: 0.8, freshness: 1.0, position_bias: 0.82 },
      },
    },
    stats: {
      total_from_providers: 1,
      unique_after_dedup: 1,
      returned_to_agent: 1,
    },
    final_order: ['abc123'],
    agent_usage: null,
    system_version: {
      mcp: '1.0.0',
      ranker: 'v1',
      signals: 'v1',
      nli_model: 'Xenova/nli-deberta-v3-xsmall',
    },
    meta: {
      timestamp: new Date().toISOString(),
      latency_ms: 100,
      cache_hit: false,
    },
  });

  it('should insert a search log entry', () => {
    const entry = makeEntry('test-1');
    expect(() => cache.insertSearchLog(entry)).not.toThrow();
  });

  it('should update agent_usage for existing entry', () => {
    const entry = makeEntry('test-2');
    cache.insertSearchLog(entry);

    const updated = cache.updateSearchLogUsage('test-2', ['abc123']);
    expect(updated).toBe(true);

    const exported = cache.exportSearchLogs();
    const updatedEntry = exported.find((e) => e.search_id === 'test-2');
    expect(updatedEntry).toBeDefined();
  });

  it('should return false for non-existent search_id', () => {
    const updated = cache.updateSearchLogUsage('nonexistent', ['abc123']);
    expect(updated).toBe(false);
  });

  it('should export only entries with agent_usage', () => {
    const withUsage = makeEntry('export-test-1');
    cache.insertSearchLog(withUsage);
    cache.updateSearchLogUsage('export-test-1', ['abc123']);

    const noUsage = makeEntry('export-test-2');
    cache.insertSearchLog(noUsage);

    const exported = cache.exportSearchLogs();
    expect(exported.length).toBeGreaterThanOrEqual(1);

    const hasExportId = exported.some((e) => e.search_id === 'export-test-1');
    const noExportId = exported.every((e) => e.search_id !== 'export-test-2');

    expect(hasExportId).toBe(true);
    expect(noExportId).toBe(true);
  });
});
