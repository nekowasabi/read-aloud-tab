import { AiPrefetcher, PrefetchStatusBroadcast } from '../aiPrefetcher';
import { TabManager } from '../tabManager';
import { QueueStatusPayload } from '../../shared/messages';
import { STORAGE_KEYS } from '../../shared/types';

const baseStatus = (): QueueStatusPayload => ({
  status: 'reading',
  currentIndex: 0,
  totalCount: 0,
  activeTabId: null,
  tabs: [],
  settings: { rate: 1, pitch: 1, volume: 1, voice: null },
  updatedAt: Date.now(),
});

describe('AiPrefetcher (prefetch coordinator)', () => {
  let tabManagerMock: Partial<TabManager>;
  let statusListener: ((payload: QueueStatusPayload) => void) | null = null;
  let broadcastMock: jest.Mock;
  let storageLocalSet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    broadcastMock = jest.fn();
    storageLocalSet = jest.fn().mockResolvedValue(undefined);
    tabManagerMock = {
      addStatusListener: jest.fn((listener: (payload: QueueStatusPayload) => void) => {
        statusListener = listener;
        return () => {
          statusListener = null;
        };
      }),
      requestContentForPrefetch: jest.fn().mockResolvedValue(undefined),
      getTabById: jest.fn().mockResolvedValue({
        tabId: 1,
        url: 'https://example.com',
        title: 'Example',
        isIgnored: false,
        content: 'content',
        extractedAt: new Date(),
      }),
      onTabUpdated: jest.fn().mockResolvedValue(undefined),
    } as unknown as TabManager;
  });

  it('registers status listener on initialize', () => {
    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      broadcast: broadcastMock,
      storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
    });

    prefetcher.initialize();

    expect(tabManagerMock.addStatusListener).toHaveBeenCalled();
    expect(statusListener).not.toBeNull();
  });

  it('broadcasts status updates when worker emits state changes', async () => {
    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      broadcast: broadcastMock,
      storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
    });

    prefetcher.initialize();

    // Simulate worker status updates via direct method access (private via cast)
    (prefetcher as any).handleStatusUpdate({ tabId: 1, state: 'processing' });
    (prefetcher as any).handleStatusUpdate({ tabId: 1, state: 'completed' });

    const messages = broadcastMock.mock.calls.map((call) => call[0] as PrefetchStatusBroadcast);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      type: 'PREFETCH_STATUS_SYNC',
    });
    expect(storageLocalSet).toHaveBeenCalled();
  });

  it('retry delegates to scheduler', () => {
    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      broadcast: broadcastMock,
      storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
    });

    prefetcher.initialize();
    const scheduler = (prefetcher as any).scheduler;
    jest.spyOn(scheduler, 'retry');

    prefetcher.retry(99);

    expect(scheduler.retry).toHaveBeenCalledWith(99);
  });

  it('broadcasts snapshot when keep-alive diagnostics update', () => {
    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      broadcast: broadcastMock,
      storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
    });

    prefetcher.initialize();

    const diagnostics = {
      state: 'running' as const,
      lastHeartbeatAt: Date.now(),
      lastAlarmAt: null,
      lastFallbackAt: null,
      fallbackCount: 0,
    };

    prefetcher.updateKeepAliveDiagnostics(diagnostics);

    expect(storageLocalSet).toHaveBeenCalled();
    expect(broadcastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PREFETCH_STATUS_SYNC' })
    );
  });

  it('invalidates cached settings when AI settings change in storage', () => {
    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      broadcast: broadcastMock,
      storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
    });

    prefetcher.initialize();

    // Simulate cached values
    (prefetcher as any).cachedSettings = { enableAiSummary: false };
    (prefetcher as any).clientInstance = {};
    (prefetcher as any).clientCacheKey = 'old';

    const listener = (chrome.storage.onChanged.addListener as jest.Mock).mock.calls[0][0];
    listener({ [STORAGE_KEYS.AI_SETTINGS]: { newValue: {} } }, 'sync');

    expect((prefetcher as any).cachedSettings).toBeNull();
    expect((prefetcher as any).clientInstance).toBeNull();
    expect((prefetcher as any).clientCacheKey).toBeNull();
  });

  it('uses default token counts of 4500 for summary and 6000 for translation', () => {
    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      broadcast: broadcastMock,
      storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
    });

    // Check private fields directly
    expect((prefetcher as any).summaryMaxTokens).toBe(4500);
    expect((prefetcher as any).translationMaxTokens).toBe(6000);
  });

  it('allows custom token counts to override defaults', () => {
    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      broadcast: broadcastMock,
      storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
      summaryMaxTokens: 999,
      translationMaxTokens: 888,
    });

    expect((prefetcher as any).summaryMaxTokens).toBe(999);
    expect((prefetcher as any).translationMaxTokens).toBe(888);
  });

  describe('waitForPrefetch with scheduler check', () => {
    it('should continue polling when scheduler.isScheduled returns true even if statusMap is empty', async () => {
      const prefetcher = new AiPrefetcher({
        tabManager: tabManagerMock as TabManager,
        broadcast: broadcastMock,
        storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
      });

      prefetcher.initialize();

      // Override scheduler with mock that reports tabId as scheduled
      const mockScheduler = { isScheduled: jest.fn().mockReturnValue(true) };
      (prefetcher as any).scheduler = mockScheduler;

      // statusMap is empty initially, but scheduler says it's scheduled
      // After 200ms, statusMap gets populated with completed state
      setTimeout(() => {
        (prefetcher as any).statusMap.set(42, { tabId: 42, state: 'completed', updatedAt: Date.now() });
        mockScheduler.isScheduled.mockReturnValue(false);
      }, 200);

      const result = await prefetcher.waitForPrefetch(42, 2000);
      expect(result).toBe(true);
      expect(mockScheduler.isScheduled).toHaveBeenCalledWith(42);
    });

    it('should return false immediately when neither scheduled nor in statusMap', async () => {
      const prefetcher = new AiPrefetcher({
        tabManager: tabManagerMock as TabManager,
        broadcast: broadcastMock,
        storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
      });

      prefetcher.initialize();

      const mockScheduler = { isScheduled: jest.fn().mockReturnValue(false) };
      (prefetcher as any).scheduler = mockScheduler;

      // statusMap is empty, scheduler says not scheduled → should return false (not scheduled, not completed)
      const start = Date.now();
      const result = await prefetcher.waitForPrefetch(42, 2000);
      const elapsed = Date.now() - start;

      expect(result).toBe(false);
      // Should return quickly, not wait for timeout
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('pruneStatusMap skip condition', () => {
    it('should NOT clear statusMap when payload.tabs is empty', () => {
      const prefetcher = new AiPrefetcher({
        tabManager: tabManagerMock as TabManager,
        broadcast: broadcastMock,
        storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
      });

      prefetcher.initialize();

      // Pre-populate statusMap with entries
      (prefetcher as any).statusMap.set(1, { tabId: 1, state: 'completed', updatedAt: Date.now() });
      (prefetcher as any).statusMap.set(2, { tabId: 2, state: 'processing', updatedAt: Date.now() });

      // Simulate queue status update with empty tabs
      (prefetcher as any).pruneStatusMap({ ...baseStatus(), tabs: [] });

      // Entries should be preserved
      expect((prefetcher as any).statusMap.size).toBe(2);
      expect((prefetcher as any).statusMap.has(1)).toBe(true);
      expect((prefetcher as any).statusMap.has(2)).toBe(true);
    });

    it('should prune entries not in queue when tabs is non-empty', () => {
      const prefetcher = new AiPrefetcher({
        tabManager: tabManagerMock as TabManager,
        broadcast: broadcastMock,
        storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
      });

      prefetcher.initialize();

      (prefetcher as any).statusMap.set(1, { tabId: 1, state: 'completed', updatedAt: Date.now() });
      (prefetcher as any).statusMap.set(2, { tabId: 2, state: 'processing', updatedAt: Date.now() });
      (prefetcher as any).statusMap.set(3, { tabId: 3, state: 'scheduled', updatedAt: Date.now() });

      const tabs = [
        { tabId: 1, url: 'https://a.com', title: 'A', isIgnored: false },
        { tabId: 3, url: 'https://c.com', title: 'C', isIgnored: false },
      ];

      (prefetcher as any).pruneStatusMap({ ...baseStatus(), tabs });

      // tabId 2 should be pruned, 1 and 3 remain
      expect((prefetcher as any).statusMap.size).toBe(2);
      expect((prefetcher as any).statusMap.has(1)).toBe(true);
      expect((prefetcher as any).statusMap.has(2)).toBe(false);
      expect((prefetcher as any).statusMap.has(3)).toBe(true);
    });
  });

  describe('getResultFromStore', () => {
    it('should return cached result when available', async () => {
      const prefetcher = new AiPrefetcher({
        tabManager: tabManagerMock as TabManager,
        broadcast: broadcastMock,
        storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
      });

      prefetcher.initialize();

      // Mock the resultStore.get to return a cached entry
      const mockResult = { summary: 'cached summary', translation: 'cached translation' };
      (prefetcher as any).resultStore = {
        get: jest.fn().mockResolvedValue(mockResult),
      };

      const result = await prefetcher.getResultFromStore(42);

      expect(result).toEqual({ summary: 'cached summary', translation: 'cached translation' });
    });

    it('should return null when resultStore is not initialized', async () => {
      const prefetcher = new AiPrefetcher({
        tabManager: tabManagerMock as TabManager,
        broadcast: broadcastMock,
        storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
      });

      // Do NOT call initialize() — resultStore remains null
      (prefetcher as any).resultStore = null;

      const result = await prefetcher.getResultFromStore(42);

      expect(result).toBeNull();
    });

    it('should return null when no entry exists in store', async () => {
      const prefetcher = new AiPrefetcher({
        tabManager: tabManagerMock as TabManager,
        broadcast: broadcastMock,
        storage: { local: { set: storageLocalSet } } as unknown as typeof chrome.storage,
      });

      prefetcher.initialize();

      (prefetcher as any).resultStore = {
        get: jest.fn().mockResolvedValue(null),
      };

      const result = await prefetcher.getResultFromStore(42);

      expect(result).toBeNull();
    });
  });

});
