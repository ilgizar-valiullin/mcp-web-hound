import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderRouter } from '../../src/search/provider-router.js';
import { BaseProvider } from '../../src/search/providers/base-provider.js';
import { ProviderOptions, ProviderResult } from '../../src/utils/types.js';

class MockProvider extends BaseProvider {
  readonly name: string;
  readonly tier: 1 | 2 | 3;
  doSearchFn = vi.fn<(query: string, options: ProviderOptions) => Promise<ProviderResult[]>>();

  constructor(name: string, tier: 1 | 2 | 3) {
    super();
    this.name = name;
    this.tier = tier;
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    return this.doSearchFn(query, options);
  }

  forceUnhealthy(): void {
    this.health.consecutive_errors = 3;
    this.health.is_healthy = false;
  }
}

describe('ProviderRouter', () => {
  const dummyOptions: ProviderOptions = { intent: 'web', freshness: 'any', max_results: 10 };
  const dummyResults: ProviderResult[] = [
    { title: 'Test', url: 'https://test.com', snippet: 'Test', raw_position: 1, provider: 'mock' },
  ];

  it('should merge results from first 2 healthy providers (parallel)', async () => {
    const p1 = new MockProvider('Provider1', 1);
    const p2 = new MockProvider('Provider2', 1);
    const p3 = new MockProvider('Provider3', 1);

    p1.doSearchFn.mockResolvedValueOnce(dummyResults);
    p2.doSearchFn.mockResolvedValueOnce(dummyResults);

    const router = new (class extends ProviderRouter {
      constructor() {
        super();
        (this as any).providers = [p1, p2, p3];
      }
    })();

    const results = await router.search('test', dummyOptions);
    expect(results).toEqual([...dummyResults, ...dummyResults]);
    expect(p1.doSearchFn).toHaveBeenCalledOnce();
    expect(p2.doSearchFn).toHaveBeenCalledOnce();
    expect(p3.doSearchFn).not.toHaveBeenCalled();
  });

  it('should return results from second provider when first fails', async () => {
    const p1 = new MockProvider('Provider1', 1);
    const p2 = new MockProvider('Provider2', 1);

    p1.doSearchFn.mockRejectedValueOnce(new Error('API down'));
    p2.doSearchFn.mockResolvedValueOnce(dummyResults);

    const router = new (class extends ProviderRouter {
      constructor() {
        super();
        (this as any).providers = [p1, p2];
      }
    })();

    const results = await router.search('test', dummyOptions);
    expect(results).toEqual(dummyResults);
    expect(p2.doSearchFn).toHaveBeenCalledOnce();
  });

  it('should throw if all providers fail', async () => {
    const p1 = new MockProvider('Provider1', 1);
    p1.doSearchFn.mockRejectedValue(new Error('API down'));

    const router = new (class extends ProviderRouter {
      constructor() {
        super();
        (this as any).providers = [p1];
      }
    })();

    await expect(router.search('test', dummyOptions)).rejects.toThrow('All providers failed');
  });

  it('should skip unhealthy providers', async () => {
    const p1 = new MockProvider('Provider1', 1);
    const p2 = new MockProvider('Provider2', 1);

    p1.forceUnhealthy();
    p2.doSearchFn.mockResolvedValueOnce(dummyResults);

    const router = new (class extends ProviderRouter {
      constructor() {
        super();
        (this as any).providers = [p1, p2];
      }
    })();

    const results = await router.search('test', dummyOptions);
    expect(results).toEqual(dummyResults);
    expect(p1.doSearchFn).not.toHaveBeenCalled();
    expect(p2.doSearchFn).toHaveBeenCalledOnce();
  });
});
