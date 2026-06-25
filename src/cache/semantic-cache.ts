import Database from 'better-sqlite3';
import * as sqlite_vec from 'sqlite-vec';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export class SemanticCache {
  private db: Database.Database;
  private initialized = false;

  constructor(db: Database.Database) {
    this.db = db;
  }

  init(): void {
    if (this.initialized) return;

    try {
      sqlite_vec.load(this.db);
      logger.info('sqlite-vec extension loaded');
    } catch (err) {
      logger.error({ err }, 'Failed to load sqlite-vec extension');
      throw err;
    }

    const dimension = config.EMBEDDING_DIMENSION;

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS query_embeddings USING vec0(
        query_id INTEGER PRIMARY KEY,
        embedding FLOAT[${dimension}]
      );
    `);

    this.initialized = true;
    logger.info({ dimension }, 'Semantic cache initialized');
  }

  findSimilar(embedding: number[], threshold: number = config.SEMANTIC_THRESHOLD): { queryId: number; distance: number } | null {
    if (!this.initialized) return null;

    const embeddingJson = '[' + embedding.join(',') + ']';

    const rows = this.db
      .prepare(
        `SELECT query_id, distance
         FROM query_embeddings
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT 1`,
      )
      .all(embeddingJson) as Array<{ query_id: number; distance: number }>;

    if (rows.length === 0) return null;

    const { query_id, distance } = rows[0];
    const similarity = 1 - distance;

    if (similarity >= threshold) {
      return { queryId: query_id, distance };
    }

    return null;
  }

  index(queryId: number, embedding: number[]): void {
    if (!this.initialized) return;

    const embeddingJson = '[' + embedding.join(',') + ']';

    this.db
      .prepare(
        `INSERT OR REPLACE INTO query_embeddings (query_id, embedding)
         VALUES (?, ?)`,
      )
      .run(queryId, embeddingJson);
  }

  remove(queryId: number): void {
    if (!this.initialized) return;

    this.db.prepare('DELETE FROM query_embeddings WHERE query_id = ?').run(queryId);
  }

  get isReady(): boolean {
    return this.initialized;
  }
}
