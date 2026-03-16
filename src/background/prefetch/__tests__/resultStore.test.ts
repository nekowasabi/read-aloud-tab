import { PrefetchResultStoreImpl } from '../resultStore';

const now = () => Date.now();

const mockStorage = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('PrefetchResultStoreImpl', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    mockStorage.get.mockReset();
    mockStorage.set.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createStore = (initial: any = undefined) => {
    mockStorage.get.mockImplementation(async () => ({ prefetch_results: initial }));
    mockStorage.set.mockResolvedValue(undefined);
    return new PrefetchResultStoreImpl({
      storage: mockStorage as unknown as typeof chrome.storage.local,
      maxEntries: 3,
      ttlMs: 600_000,
      now,
    });
  };

  it('saves and retrieves results', async () => {
    const store = createStore();
    await store.save({
      tabId: 1,
      url: 'https://example.com/1',
      summary: 's',
      translation: 't',
      generatedAt: now(),
    });
    const saved = mockStorage.set.mock.calls[0][0].prefetch_results.results[0];
    expect(saved.tabId).toBe(1);
  });

  it('prunes entries beyond limit', async () => {
    const store = createStore({
      results: [
        { tabId: 1, url: 'https://example.com/1', summary: 'old', generatedAt: now() - 10 },
        { tabId: 2, url: 'https://example.com/2', summary: 'older', generatedAt: now() - 20 },
        { tabId: 3, url: 'https://example.com/3', summary: 'oldest', generatedAt: now() - 30 },
      ],
    });

    await store.save({
      tabId: 4,
      url: 'https://example.com/4',
      summary: 'new',
      generatedAt: now(),
    });
    const calls = mockStorage.set.mock.calls;
    const saved = calls[calls.length - 1]?.[0].prefetch_results.results;
    expect(saved).toHaveLength(3);
    expect(saved?.map((item: any) => item.tabId)).toEqual([4, 1, 2]);
  });

  it('drops stale entries during prune', async () => {
    const store = createStore({
      results: [
        { tabId: 1, url: 'https://example.com/1', summary: 'fresh', generatedAt: now() - 5_000 },
        { tabId: 2, url: 'https://example.com/2', summary: 'stale', generatedAt: now() - 900_000 },
      ],
    });
    await store.prune();
    const calls = mockStorage.set.mock.calls;
    const saved = calls[calls.length - 1]?.[0].prefetch_results.results;
    expect(saved).toEqual([
      { tabId: 1, url: 'https://example.com/1', summary: 'fresh', generatedAt: now() - 5_000 },
    ]);
  });

  it('returns null when URL does not match cached entry', async () => {
    const store = createStore({
      results: [
        { tabId: 1, url: 'https://example.com/original', summary: 'cached', generatedAt: now() },
      ],
    });
    const result = await store.get(1, 'https://example.com/different');
    expect(result).toBeNull();
  });

  it('returns entry when URL matches cached entry', async () => {
    const store = createStore({
      results: [
        { tabId: 1, url: 'https://example.com/page', summary: 'cached', generatedAt: now() },
      ],
    });
    const result = await store.get(1, 'https://example.com/page');
    expect(result).not.toBeNull();
    expect(result?.summary).toBe('cached');
  });

  it('returns entry without URL verification when url param is omitted', async () => {
    const store = createStore({
      results: [
        { tabId: 1, url: 'https://example.com/page', summary: 'cached', generatedAt: now() },
      ],
    });
    const result = await store.get(1);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe('cached');
  });

  describe('clearAll()', () => {
    it('clears in-memory cache and persists empty results to storage', async () => {
      const store = createStore({
        results: [
          { tabId: 1, url: 'https://example.com/1', summary: 'cached', generatedAt: now() },
          { tabId: 2, url: 'https://example.com/2', summary: 'cached2', generatedAt: now() },
        ],
      });

      // Warm up cache
      await store.get(1);

      await store.clearAll();

      // In-memory cache should be empty
      expect((store as any).cache).toEqual([]);

      // Storage should be updated with empty results
      const lastSetCall = mockStorage.set.mock.calls[mockStorage.set.mock.calls.length - 1];
      expect(lastSetCall[0]).toEqual({ prefetch_results: { results: [] } });
    });

    it('returns null after clearAll for previously cached entry', async () => {
      const store = createStore({
        results: [
          { tabId: 1, url: 'https://example.com/page', summary: 'cached', generatedAt: now() },
        ],
      });

      // Warm up cache
      await store.get(1);

      await store.clearAll();

      // Subsequent get should return null (cache is empty, storage returns empty)
      mockStorage.get.mockImplementation(async () => ({ prefetch_results: { results: [] } }));
      const result = await store.get(1);
      expect(result).toBeNull();
    });
  });
});
