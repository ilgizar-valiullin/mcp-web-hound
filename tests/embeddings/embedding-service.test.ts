import { describe, it, expect } from 'vitest';
import { EmbeddingService } from '../../src/embeddings/embedding-service.js';

describe('EmbeddingService', () => {
  it('should compute cosine similarity', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    expect(EmbeddingService.cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(EmbeddingService.cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('should return 0 for zero vectors', () => {
    const a = [0, 0, 0];
    const b = [1, 0, 0];
    expect(EmbeddingService.cosineSimilarity(a, b)).toBe(0);
  });

  it('should throw on dimension mismatch', () => {
    expect(() => EmbeddingService.cosineSimilarity([1], [1, 2])).toThrow();
  });

  it('should handle negative vectors', () => {
    const a = [1, -1, 0];
    const b = [-1, 1, 0];
    const similarity = EmbeddingService.cosineSimilarity(a, b);
    expect(similarity).toBeLessThan(0);
  });
});
