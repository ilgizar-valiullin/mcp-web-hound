import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseProvider } from '../../src/search/providers/base-provider.js';
import { ProviderOptions, ProviderResult } from '../../src/utils/types.js';

class DummyProvider extends BaseProvider {
  readonly name = 'Dummy';
  readonly tier = 1;

  doSearchFn = vi.fn<(query: string, options: ProviderOptions) => Promise<ProviderResult[]>>();

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    return this.doSearchFn(query, options);
  }
}

describe('BaseProvider', () => {
  let provider: DummyProvider;

  beforeEach(() => {
    provider = new DummyProvider();
  });

  const dummyOptions: ProviderOptions = {
    intent: 'web',
    freshness: 'any',
    max_results: 10,
  };

  const dummyResults: ProviderResult[] = [
    {
      title: 'Test',
      url: 'https://test.com',
      snippet: 'Test snippet',
      raw_position: 1,
      provider: 'Dummy',
    },
  ];

  it('should start healthy', async () => {
    expect(await provider.healthCheck()).toBe(true);
    const stats = provider.getStats();
    expect(stats.healthy).toBe(true);
    expect(stats.requests_today).toBe(0);
  });

  it('should record success and update latency', async () => {
    provider.doSearchFn.mockResolvedValueOnce(dummyResults);

    const results = await provider.search('test query', dummyOptions);
    expect(results).toEqual(dummyResults);

    const stats = provider.getStats();
    expect(stats.requests_today).toBe(1);
    expect(stats.healthy).toBe(true);
    expect(stats.avg_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('should record error and become unhealthy after 3 consecutive errors', async () => {
    const error = new Error('API down');
    provider.doSearchFn.mockRejectedValue(error);

    await expect(provider.search('test', dummyOptions)).rejects.toThrow('API down');
    expect(await provider.healthCheck()).toBe(true);

    await expect(provider.search('test', dummyOptions)).rejects.toThrow('API down');
    expect(await provider.healthCheck()).toBe(true);

    await expect(provider.search('test', dummyOptions)).rejects.toThrow('API down');
    expect(await provider.healthCheck()).toBe(false);

    provider.doSearchFn.mockClear();
    await expect(provider.search('test', dummyOptions)).rejects.toThrow('Provider Dummy is currently unhealthy');
    expect(provider.doSearchFn).not.toHaveBeenCalled();
  });

  it('should recover if resetHealth is called', async () => {
    const error = new Error('API down');
    provider.doSearchFn.mockRejectedValue(error);

    for (let i = 0; i < 3; i++) {
      try { await provider.search('test', dummyOptions); } catch (e) { /* expected */ }
    }
    expect(await provider.healthCheck()).toBe(false);

    provider.resetHealth();
    expect(await provider.healthCheck()).toBe(true);

    provider.doSearchFn.mockResolvedValueOnce(dummyResults);
    const results = await provider.search('test', dummyOptions);
    expect(results).toEqual(dummyResults);
  });
});
