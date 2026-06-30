import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { CacheStats, SearchLogEntry, SearchResult } from '../utils/types.js';

interface QueryRow {
  id: number;
  cache_key: string;
  query_raw: string;
  query_norm: string;
  intent: string;
  created_at: number;
  expires_at: number;
  hit_count: number;
  last_hit_at: number | null;
}

interface ResultRow {
  id: number;
  query_id: number;
  title: string;
  url: string;
  snippet: string;
  source_domain: string;
  published_date: string | null;
  relevance_score: number;
  position: number;
  provider: string;
  created_at: number;
}

export class SqliteCache {
  private db: Database.Database;

  constructor() {
    const dbPath = resolve(config.DATA_DIR, config.DB_FILENAME);
    logger.info({ dbPath }, 'Initializing SQLite cache');

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queries (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key     TEXT NOT NULL UNIQUE,
        query_raw     TEXT NOT NULL,
        query_norm    TEXT NOT NULL,
        intent        TEXT NOT NULL DEFAULT 'web',
        created_at    INTEGER NOT NULL,
        expires_at    INTEGER NOT NULL,
        hit_count     INTEGER NOT NULL DEFAULT 0,
        last_hit_at   INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_queries_cache_key ON queries(cache_key);
      CREATE INDEX IF NOT EXISTS idx_queries_expires ON queries(expires_at);

      CREATE TABLE IF NOT EXISTS results (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id      INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        url           TEXT NOT NULL,
        snippet       TEXT NOT NULL,
        source_domain TEXT NOT NULL,
        published_date TEXT,
        relevance_score REAL NOT NULL DEFAULT 0.0,
        position      INTEGER NOT NULL,
        provider      TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_results_query_id ON results(query_id);
      CREATE INDEX IF NOT EXISTS idx_results_url ON results(url);

      CREATE TABLE IF NOT EXISTS provider_stats (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        provider      TEXT NOT NULL,
        date          TEXT NOT NULL,
        requests      INTEGER NOT NULL DEFAULT 0,
        errors        INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms REAL NOT NULL DEFAULT 0,
        UNIQUE(provider, date)
      );

      CREATE TABLE IF NOT EXISTS search_logs (
        search_id     TEXT PRIMARY KEY,
        data_json     TEXT NOT NULL,
        agent_usage   TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_search_logs_usage ON search_logs(agent_usage);
    `);
  }

  getQueryById(id: number): { id: number; results: SearchResult[]; queryNorm: string } | null {
    const query = this.db.prepare('SELECT * FROM queries WHERE id = ? AND expires_at > ?').get(id, Date.now() / 1000) as QueryRow | undefined;
    if (!query) return null;

    const rows = this.db.prepare('SELECT * FROM results WHERE query_id = ? ORDER BY position ASC').all(query.id) as ResultRow[];

    const results: SearchResult[] = rows.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source_domain,
      published_date: r.published_date ?? undefined,
      relevance_score: r.relevance_score,
    }));

    return { id: query.id, results, queryNorm: query.query_norm };
  }

  getQuery(cacheKey: string): { id: number; results: SearchResult[]; queryNorm: string } | null {
    const query = this.db.prepare('SELECT * FROM queries WHERE cache_key = ? AND expires_at > ?').get(cacheKey, Date.now() / 1000) as QueryRow | undefined;

    if (!query) return null;

    this.db.prepare('UPDATE queries SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), query.id);

    const rows = this.db.prepare('SELECT * FROM results WHERE query_id = ? ORDER BY position ASC').all(query.id) as ResultRow[];

    const results: SearchResult[] = rows.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source_domain,
      published_date: r.published_date ?? undefined,
      relevance_score: r.relevance_score,
    }));

    return { id: query.id, results, queryNorm: query.query_norm };
  }

  setQuery(cacheKey: string, queryRaw: string, queryNorm: string, intent: string, results: SearchResult[], ttlSeconds: number): void {
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(`
      INSERT INTO queries (cache_key, query_raw, query_norm, intent, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        query_raw = excluded.query_raw,
        expires_at = excluded.expires_at
    `).run(cacheKey, queryRaw, queryNorm, intent, now, now + ttlSeconds);

    const query = this.db.prepare('SELECT id FROM queries WHERE cache_key = ?').get(cacheKey) as { id: number } | undefined;
    if (!query) return;

    const insertResult = this.db.prepare(`
      INSERT INTO results (query_id, title, url, snippet, source_domain, published_date, relevance_score, position, provider, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteOld = this.db.prepare('DELETE FROM results WHERE query_id = ?');
    const tx = this.db.transaction(() => {
      deleteOld.run(query.id);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        insertResult.run(query.id, r.title, r.url, r.snippet, r.source, r.published_date ?? null, r.relevance_score, i, 'cache', now);
      }
    });
    tx();
  }

  evictExpired(): { queriesRemoved: number } {
    const now = Math.floor(Date.now() / 1000);

    const queriesResult = this.db.prepare('DELETE FROM queries WHERE expires_at < ?').run(now);

    this.db.pragma('wal_checkpoint(TRUNCATE)');

    return {
      queriesRemoved: queriesResult.changes,
    };
  }

  getStats(): CacheStats {
    const queries = this.db.prepare('SELECT COUNT(*) as count FROM queries').get() as { count: number };
    const results = this.db.prepare('SELECT COUNT(*) as count FROM results').get() as { count: number };
    const dbSize = this.db.prepare('SELECT page_count * page_size as size FROM pragma_page_count, pragma_page_size').get() as { size: number } | undefined;

    return {
      total_queries: queries.count,
      total_results: results.count,
      total_pages: 0,
      db_size_mb: Math.round(((dbSize?.size ?? 0) / (1024 * 1024)) * 100) / 100,
    };
  }

  recordProviderStat(provider: string, latencyMs: number, isError: boolean): void {
    const today = new Date().toISOString().slice(0, 10);

    this.db.prepare(`
      INSERT INTO provider_stats (provider, date, requests, errors, avg_latency_ms)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(provider, date) DO UPDATE SET
        requests = requests + 1,
        errors = errors + CASE WHEN ? THEN 1 ELSE 0 END,
        avg_latency_ms = (avg_latency_ms + ?) / 2
    `).run(provider, today, isError ? 1 : 0, latencyMs, isError ? 1 : 0, latencyMs);
  }

  getDb(): Database.Database {
    return this.db;
  }

  insertSearchLog(entry: SearchLogEntry): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO search_logs (search_id, data_json, agent_usage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(entry.search_id, JSON.stringify(entry), null, now, now);
  }

  updateSearchLogUsage(searchId: string, usedDocIds: string[]): boolean {
    const row = this.db.prepare('SELECT search_id FROM search_logs WHERE search_id = ?').get(searchId);
    if (!row) return false;

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE search_logs SET agent_usage = ?, updated_at = ?
      WHERE search_id = ?
    `).run(JSON.stringify(usedDocIds), now, searchId);
    return true;
  }

  exportSearchLogs(): SearchLogEntry[] {
    const rows = this.db.prepare(
      'SELECT data_json FROM search_logs WHERE agent_usage IS NOT NULL ORDER BY created_at',
    ).all() as { data_json: string }[];

    return rows.map((r) => JSON.parse(r.data_json));
  }

  close(): void {
    this.db.close();
  }
}
