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
});
