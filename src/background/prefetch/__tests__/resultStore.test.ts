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
    await store.save({ tabId: 1, summary: 's', translation: 't', generatedAt: now() });
    const saved = mockStorage.set.mock.calls[0][0].prefetch_results.results[0];
    expect(saved.tabId).toBe(1);
  });

  it('prunes entries beyond limit', async () => {
    const store = createStore({
      results: [
        { tabId: 1, summary: 'old', generatedAt: now() - 10 },
        { tabId: 2, summary: 'older', generatedAt: now() - 20 },
        { tabId: 3, summary: 'oldest', generatedAt: now() - 30 },
      ],
    });

    await store.save({ tabId: 4, summary: 'new', generatedAt: now() });
    const calls = mockStorage.set.mock.calls;
    const saved = calls[calls.length - 1]?.[0].prefetch_results.results;
    expect(saved).toHaveLength(3);
    expect(saved?.map((item: any) => item.tabId)).toEqual([4, 1, 2]);
  });

  it('drops stale entries during prune', async () => {
    const store = createStore({
      results: [
        { tabId: 1, summary: 'fresh', generatedAt: now() - 5_000 },
        { tabId: 2, summary: 'stale', generatedAt: now() - 900_000 },
      ],
    });
    await store.prune();
    const calls = mockStorage.set.mock.calls;
    const saved = calls[calls.length - 1]?.[0].prefetch_results.results;
    expect(saved).toEqual([
      { tabId: 1, summary: 'fresh', generatedAt: now() - 5_000 },
    ]);
  });
});
