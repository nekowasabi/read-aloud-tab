import { TabManager } from '../tabManager';
import type { PlaybackController, PlaybackHooks, ContentResolverResult } from '../tabManager';
import type { TabInfo, ReadingQueue, TTSSettings } from '../../shared/types';
import { loadQueue, saveQueue, getIgnoredDomains } from '../../shared/utils/storage';

jest.mock('../aiProcessor', () => ({
  AiProcessor: jest.fn().mockImplementation(() => ({
    updateSettings: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(false),
    processContent: jest.fn(),
  })),
}));

jest.mock('../../shared/utils/storage', () => {
  const loadQueue = jest.fn();
  const saveQueue = jest.fn();
  return {
    StorageManager: {
      getAiSettings: jest.fn().mockResolvedValue({
        openRouterApiKey: null,
        openRouterModel: null,
        enableAiSummary: false,
        enableAiTranslation: false,
      }),
      validateSettings: jest.fn((settings: unknown) => settings),
      saveSettings: jest.fn(),
    },
    loadQueue,
    saveQueue,
    getIgnoredDomains: jest.fn().mockResolvedValue([]),
  };
});

describe('TabManager stale processNext', () => {
  let manager: TabManager;
  let playback: jest.Mocked<PlaybackController>;
  let onEndCallbacks: Array<() => void>;
  const mockedLoadQueue = loadQueue as jest.MockedFunction<typeof loadQueue>;
  const mockedSaveQueue = saveQueue as jest.MockedFunction<typeof saveQueue>;
  const mockedGetIgnoredDomains = getIgnoredDomains as jest.MockedFunction<typeof getIgnoredDomains>;

  const initialSettings: TTSSettings = {
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: null,
  };

  const createTab = (tabId: number): TabInfo => ({
    tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    content: `Content for tab ${tabId}`,
    isIgnored: false,
    extractedAt: new Date(),
  });

  interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
  }

  const createDeferred = <T>(): Deferred<T> => {
    let resolveFn: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
      resolveFn = resolve;
    });
    return { promise, resolve: resolveFn };
  };

  const waitForCalls = async (getCount: () => number, expected: number): Promise<void> => {
    const deadline = Date.now() + 2000;
    while (getCount() < expected) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${expected} calls, got ${getCount()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // Allow the awaiting processNext to actually suspend on the deferred.
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  const flush = async (ms = 30): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    onEndCallbacks = [];
    mockedSaveQueue.mockResolvedValue(undefined);
    mockedGetIgnoredDomains.mockResolvedValue([]);
  });

  test('removeTab during deferred resolve stops stale playback and starts tab1 once', async () => {
    // Rebuild with deferred resolveContent so we can capture per-call deferreds.
    const deferreds: Array<Deferred<ContentResolverResult | null>> = [];
    const resolvers: Array<{ tabId: number }> = [];
    const deferredResolve = jest.fn((tab: TabInfo): Promise<ContentResolverResult | null> => {
      const deferred = createDeferred<ContentResolverResult | null>();
      deferreds.push(deferred);
      resolvers.push({ tabId: tab.tabId });
      return deferred.promise;
    });

    playback = {
      start: jest.fn().mockImplementation(
        (_tab: TabInfo, _settings: TTSSettings, hooks?: PlaybackHooks): Promise<void> => {
          if (hooks?.onEnd) {
            onEndCallbacks.push(hooks.onEnd);
          }
          return Promise.resolve();
        }
      ),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    } as jest.Mocked<PlaybackController>;

    manager = new TabManager({
      playback,
      resolveContent: deferredResolve,
    });
    const initialQueue: ReadingQueue = {
      tabs: [createTab(101), createTab(202)],
      currentIndex: 0,
      status: 'idle',
      settings: initialSettings,
    };
    mockedLoadQueue.mockResolvedValue({ ...initialQueue, tabs: [...initialQueue.tabs] });
    await manager.initialize();

    const stalePromise = manager.processNext(0);
    await waitForCalls(() => deferredResolve.mock.calls.length, 1);

    const removePromise = manager.removeTab(101);
    await waitForCalls(() => deferredResolve.mock.calls.length, 2);

    if (onEndCallbacks.length > 0 && onEndCallbacks[0]) {
      const firstOnEnd = onEndCallbacks[0] as () => void;
      firstOnEnd();
    }
    await flush(20);

    // Resolve the stale tab0 content first, then the current tab1 content.
    deferreds[0]?.resolve({ content: 'Content for tab 101' });
    deferreds[1]?.resolve({ content: 'Content for tab 202' });

    await stalePromise;
    await removePromise;
    await flush(50);

    const startMock = playback.start as jest.Mock;
    expect(startMock).toHaveBeenCalledTimes(1);
    const firstStartTab = startMock.mock.calls[0][0] as TabInfo;
    expect(firstStartTab.tabId).toBe(202);

    const tabIdsStarted = startMock.mock.calls.map((call) => (call[0] as TabInfo).tabId);
    expect(tabIdsStarted).not.toContain(101);

    const snapshot = manager.getSnapshot();
    expect(snapshot.tabs.map((t) => t.tabId)).toContain(202);
    expect(snapshot.tabs).toHaveLength(1);
    expect(playback.stop).toHaveBeenCalled();
  });

  test('skipTab next during deferred resolve never starts the skipped tab', async () => {
    const deferreds: Array<Deferred<ContentResolverResult | null>> = [];
    const deferredResolve = jest.fn((tab: TabInfo): Promise<ContentResolverResult | null> => {
      const deferred = createDeferred<ContentResolverResult | null>();
      deferreds.push(deferred);
      void tab;
      return deferred.promise;
    });

    playback = {
      start: jest.fn().mockImplementation(
        (_tab: TabInfo, _settings: TTSSettings, hooks?: PlaybackHooks): Promise<void> => {
          if (hooks?.onEnd) {
            onEndCallbacks.push(hooks.onEnd);
          }
          return Promise.resolve();
        }
      ),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    } as jest.Mocked<PlaybackController>;

    manager = new TabManager({
      playback,
      resolveContent: deferredResolve,
    });
    const initialQueue: ReadingQueue = {
      tabs: [createTab(101), createTab(202)],
      currentIndex: 0,
      status: 'idle',
      settings: initialSettings,
    };
    mockedLoadQueue.mockResolvedValue({ ...initialQueue, tabs: [...initialQueue.tabs] });
    await manager.initialize();

    const stalePromise = manager.processNext(0);
    await waitForCalls(() => deferredResolve.mock.calls.length, 1);

    const skipPromise = manager.skipTab('next');
    await waitForCalls(() => deferredResolve.mock.calls.length, 2);

    deferreds[0]?.resolve({ content: 'Content for tab 101' });
    deferreds[1]?.resolve({ content: 'Content for tab 202' });

    await stalePromise;
    await skipPromise;
    await flush(50);

    const startMock = playback.start as jest.Mock;
    const startedIds = startMock.mock.calls.map((call) => (call[0] as TabInfo).tabId);
    expect(startedIds).not.toContain(101);
    if (startMock.mock.calls.length > 0) {
      expect(startedIds).toContain(202);
    }
  });
});
