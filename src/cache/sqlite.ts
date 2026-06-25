import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { CacheStats, SearchResult } from '../utils/types.js';

interface QueryRow {
  id: number;
  cache_key: string;
  query_raw: string;
  query_norm: string;
  intent: string;
  freshness: string;
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

interface PageRow {
  id: number;
  url: string;
  url_hash: string;
  title: string | null;
  content_md: string;
  content_length: number;
  fetched_at: number;
  expires_at: number;
  fetch_time_ms: number;
  status_code: number;
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
        freshness     TEXT NOT NULL DEFAULT 'any',
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

      CREATE TABLE IF NOT EXISTS pages (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        url           TEXT NOT NULL UNIQUE,
        url_hash      TEXT NOT NULL,
        title         TEXT,
        content_md    TEXT NOT NULL,
        content_length INTEGER NOT NULL,
        fetched_at    INTEGER NOT NULL,
        expires_at    INTEGER NOT NULL,
        fetch_time_ms INTEGER NOT NULL,
        status_code   INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pages_url_hash ON pages(url_hash);
      CREATE INDEX IF NOT EXISTS idx_pages_expires ON pages(expires_at);

      CREATE TABLE IF NOT EXISTS provider_stats (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        provider      TEXT NOT NULL,
        date          TEXT NOT NULL,
        requests      INTEGER NOT NULL DEFAULT 0,
        errors        INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms REAL NOT NULL DEFAULT 0,
        UNIQUE(provider, date)
      );
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

  setQuery(cacheKey: string, queryRaw: string, queryNorm: string, intent: string, freshness: string, results: SearchResult[], ttlSeconds: number): void {
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(`
      INSERT INTO queries (cache_key, query_raw, query_norm, intent, freshness, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        query_raw = excluded.query_raw,
        expires_at = excluded.expires_at
    `).run(cacheKey, queryRaw, queryNorm, intent, freshness, now, now + ttlSeconds);

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

  getPage(url: string): { content: string; title: string | null } | null {
    const page = this.db.prepare('SELECT * FROM pages WHERE url_hash = ? AND expires_at > ?').get(this.hashUrl(url), Math.floor(Date.now() / 1000)) as PageRow | undefined;

    if (!page) return null;
    return { content: page.content_md, title: page.title };
  }

  setPage(url: string, content: string, title: string | null, fetchTimeMs: number, statusCode: number, ttlSeconds: number): void {
    const now = Math.floor(Date.now() / 1000);
    const urlHash = this.hashUrl(url);

    this.db.prepare(`
      INSERT INTO pages (url, url_hash, title, content_md, content_length, fetched_at, expires_at, fetch_time_ms, status_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        title = excluded.title,
        content_md = excluded.content_md,
        content_length = excluded.content_length,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at,
        fetch_time_ms = excluded.fetch_time_ms,
        status_code = excluded.status_code
    `).run(url, urlHash, title, content, content.length, now, now + ttlSeconds, fetchTimeMs, statusCode);
  }

  evictExpired(): { queriesRemoved: number; pagesRemoved: number } {
    const now = Math.floor(Date.now() / 1000);

    const pagesResult = this.db.prepare('DELETE FROM pages WHERE expires_at < ?').run(now);
    const queriesResult = this.db.prepare('DELETE FROM queries WHERE expires_at < ?').run(now);

    this.db.pragma('wal_checkpoint(TRUNCATE)');

    return {
      queriesRemoved: queriesResult.changes,
      pagesRemoved: pagesResult.changes,
    };
  }

  getStats(): CacheStats {
    const queries = this.db.prepare('SELECT COUNT(*) as count FROM queries').get() as { count: number };
    const results = this.db.prepare('SELECT COUNT(*) as count FROM results').get() as { count: number };
    const pages = this.db.prepare('SELECT COUNT(*) as count FROM pages').get() as { count: number };
    const dbSize = this.db.prepare('SELECT page_count * page_size as size FROM pragma_page_count, pragma_page_size').get() as { size: number } | undefined;

    return {
      total_queries: queries.count,
      total_results: results.count,
      total_pages: pages.count,
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

  close(): void {
    this.db.close();
  }

  private hashUrl(url: string): string {
    return createHash('sha256').update(url).digest('hex');
  }
}
