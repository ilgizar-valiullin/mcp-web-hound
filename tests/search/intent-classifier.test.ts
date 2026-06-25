import { describe, it, expect, beforeEach } from 'vitest';
import { IntentClassifier } from '../../src/search/intent-classifier.js';
import { EmbeddingService } from '../../src/embeddings/embedding-service.js';

const ANCHOR_PASSAGES: Record<string, string> = {
  github: 'source code, git repository, github issue, pull request, scripts, code implementation, programming library, source files',
  docs: 'official documentation, api reference, technical manual, user guide, configuration parameters, function signature, developer docs',
  news: 'latest tech news, product announcement, recent release, updates, industry events, what is new today, tech blog posts',
  web: 'general web search, internet articles, wikipedia, discussion forums, public knowledge, general information, overview',
};

describe('IntentClassifier — without embedding (falls back to web)', () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    classifier = new IntentClassifier();
  });

  it('defaults to web for any query when no embedding service', async () => {
    expect(await classifier.classify('github.com/facebook/react')).toBe('web');
    expect(await classifier.classify('python documentation')).toBe('web');
    expect(await classifier.classify('tech news today')).toBe('web');
    expect(await classifier.classify('best restaurants in tokyo')).toBe('web');
    expect(await classifier.classify('')).toBe('web');
  });
});

describe('IntentClassifier — with mock embedding service', () => {
  function makeMockEmbedding(anchorVecs: Record<string, number[]>, queryVecMap: Map<string, number[]>): EmbeddingService {
    const anchorByPassage = new Map(Object.entries(ANCHOR_PASSAGES).map(([k, v]) => [v, anchorVecs[k]]));

    return new (class extends EmbeddingService {
      constructor() {
        super();
      }
      override get isLoaded() {
        return true;
      }
      override async embed(text: string, _prefix?: string) {
        return queryVecMap.get(text) ?? new Array(5).fill(0);
      }
      override async embedBatch(texts: string[], _prefix?: string) {
        return texts.map((t) => anchorByPassage.get(t) ?? new Array(5).fill(0));
      }
    })();
  }

  it('falls back to web when all scores are below confidence threshold', async () => {
    const anchorVecs = {
      docs: [1, 0, 0, 0, 0],
      github: [0, 1, 0, 0, 0],
      news: [0, 0, 1, 0, 0],
      web: [0, 0, 0, 1, 0],
    };
    const qMap = new Map<string, number[]>();
    qMap.set('buy cheap sneakers online', [0, 0, 0, 0, 1]);

    const svc = makeMockEmbedding(anchorVecs, qMap);
    const classifier = new IntentClassifier(svc, 0.73, 0.04);

    expect(await classifier.classify('buy cheap sneakers online')).toBe('web');
  });

  it('returns docs when confident and well above ambiguity margin', async () => {
    const anchorVecs = {
      docs: [1, 0, 0, 0, 0],
      github: [0.2, 1, 0, 0, 0],
      news: [0.2, 0, 1, 0, 0],
      web: [0.2, 0, 0, 1, 0],
    };
    const qMap = new Map<string, number[]>();
    qMap.set('python api documentation', [1, 0, 0, 0, 0]);

    const svc = makeMockEmbedding(anchorVecs, qMap);
    const classifier = new IntentClassifier(svc, 0.73, 0.04);

    expect(await classifier.classify('python api documentation')).toBe('docs');
  });

  it('falls back to web when best and second scores are too close', async () => {
    const anchorVecs = {
      docs: [1, 0, 0, 0, 0],
      github: [0.98, 0, 0, 0, 0],
      news: [0, 1, 0, 0, 0],
      web: [0, 0, 1, 0, 0],
    };
    const qMap = new Map<string, number[]>();
    qMap.set('vague query', [1, 0, 0, 0, 0]);

    const svc = makeMockEmbedding(anchorVecs, qMap);
    const classifier = new IntentClassifier(svc, 0.73, 0.04);

    expect(await classifier.classify('vague query')).toBe('web');
  });
});
