import { describe, it, expect } from 'vitest';
import { EmbeddingService } from '../src/embeddings/embedding-service.js';
import { IntentClassifier } from '../src/search/intent-classifier.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function fakeLoadedEmbedding(svc: EmbeddingService): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anySvc = svc as any;
  anySvc.pipeline = async () => ({ data: new Float32Array([0.5, 0.5]), dims: [1, 2], size: 2 });
  anySvc.modelLoaded = true;
}

describe('Model idle unload (variant A)', () => {
  it('embedding dispose() unloads fake-loaded model', async () => {
    const svc = new EmbeddingService(25_000);
    fakeLoadedEmbedding(svc);
    await svc.ensureLoaded();
    expect(svc.isLoaded).toBe(true);
    svc.dispose();
    expect(svc.isLoaded).toBe(false);
    svc.dispose();
  });

  it('embedding auto-unloads after short idle timeout', async () => {
    const svc = new EmbeddingService(30);
    fakeLoadedEmbedding(svc);
    await svc.ensureLoaded();
    expect(svc.isLoaded).toBe(true);
    await sleep(80);
    expect(svc.isLoaded).toBe(false);
    svc.dispose();
  });

  it('embedding with idleTimeout 0 never auto-unloads', async () => {
    const svc = new EmbeddingService(0);
    fakeLoadedEmbedding(svc);
    await svc.ensureLoaded();
    expect(svc.isLoaded).toBe(true);
    await sleep(60);
    expect(svc.isLoaded).toBe(true);
    svc.dispose();
    expect(svc.isLoaded).toBe(false);
  });

  it('embedding dispose() defers while request in flight', async () => {
    const svc = new EmbeddingService(30);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anySvc = svc as any;
    anySvc.pipeline = async () => {
      await sleep(80);
      return { data: new Float32Array([1, 0]), dims: [1, 2], size: 2 };
    };
    anySvc.modelLoaded = true;

    const p = svc.embed('hello');
    svc.dispose();
    // Still loaded — request in flight defers unload.
    expect(svc.isLoaded).toBe(true);
    await p;
    // After request finishes, idle timer re-armed → unloads shortly.
    await sleep(80);
    expect(svc.isLoaded).toBe(false);
  });

  it('classifier dispose() clears mock pipeline', async () => {
    const mock = async () => ({ labels: ['a'], scores: [1] });
    const c = new IntentClassifier('mock', 0.45, mock, 25_000);
    expect(c.isLoaded).toBe(true);
    c.dispose();
    expect(c.isLoaded).toBe(false);
    c.dispose();
  });

  it('classifier auto-unloads after short idle timeout', async () => {
    const mock = async () => ({ labels: ['a'], scores: [1] });
    const c = new IntentClassifier('mock', 0.45, mock, 30);
    expect(c.isLoaded).toBe(true);
    await sleep(80);
    expect(c.isLoaded).toBe(false);
  });

  it('classifier classify() touches timer (stays hot under load)', async () => {
    const mock = async () => ({ labels: ['code repositories'], scores: [0.9] });
    const c = new IntentClassifier('mock', 0.45, mock, 80);
    await c.classify('test query');
    expect(c.isLoaded).toBe(true);
    await sleep(40);
    await c.classify('test query again');
    await sleep(40);
    // Touched mid-way → still loaded.
    expect(c.isLoaded).toBe(true);
    await sleep(120);
    expect(c.isLoaded).toBe(false);
  });
});
