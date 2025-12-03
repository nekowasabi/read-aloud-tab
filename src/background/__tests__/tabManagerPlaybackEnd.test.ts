import { TabManager } from '../tabManager';
import type { PlaybackController } from '../tabManager';
import type { TabInfo, ReadingQueue, TTSSettings } from '../../shared/types';
import { loadQueue, saveQueue } from '../../shared/utils/storage';

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
      validateSettings: jest.fn((settings) => settings),
      saveSettings: jest.fn(),
    },
    loadQueue,
    saveQueue,
    getIgnoredDomains: jest.fn().mockResolvedValue([]),
  };
});

describe('TabManager.handlePlaybackEnd - タブ自動除去', () => {
  let manager: TabManager;
  let playback: jest.Mocked<PlaybackController>;
  let onEndCallback: (() => void) | null = null;
  let mockResolveContent: jest.Mock;
  const mockedLoadQueue = loadQueue as jest.MockedFunction<typeof loadQueue>;
  const mockedSaveQueue = saveQueue as jest.MockedFunction<typeof saveQueue>;

  const initialSettings: TTSSettings = {
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: null,
  };

  const createTab = (tabId: number, isIgnored = false): TabInfo => ({
    tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    content: `Content for tab ${tabId}`,
    isIgnored,
    extractedAt: new Date(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    onEndCallback = null;

    mockedSaveQueue.mockResolvedValue(undefined);

    playback = {
      start: jest.fn().mockImplementation((_tab, _settings, hooks) => {
        onEndCallback = hooks?.onEnd || null;
        return Promise.resolve();
      }),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };

    // resolveContentモックを作成
    mockResolveContent = jest.fn().mockImplementation((tab: TabInfo) => {
      return Promise.resolve({
        content: tab.content || `Content for tab ${tab.tabId}`,
        extractedAt: tab.extractedAt,
      });
    });

    manager = new TabManager({
      playback,
      resolveContent: mockResolveContent,
    });
  });

  // processNextで読み上げ開始する共通ヘルパー
  const startPlayback = async () => {
    await manager.processNext(0);
  };

  test('読み上げ完了時に完了したタブがキューから除去される', async () => {
    const initialQueue: ReadingQueue = {
      tabs: [createTab(101), createTab(202), createTab(303)],
      currentIndex: 0,
      status: 'reading',
      settings: initialSettings,
    };
    mockedLoadQueue.mockResolvedValue({ ...initialQueue, tabs: [...initialQueue.tabs] });

    await manager.initialize();

    // 読み上げ開始
    await startPlayback();

    // 初期状態の確認
    let snapshot = manager.getSnapshot();
    expect(snapshot.tabs).toHaveLength(3);
    expect(snapshot.currentIndex).toBe(0);

    // 読み上げ完了をトリガー
    if (onEndCallback) {
      onEndCallback();
    }

    // 少し待機してから確認
    await new Promise((resolve) => setTimeout(resolve, 50));

    snapshot = manager.getSnapshot();
    // タブ101が除去され、残り2つ
    expect(snapshot.tabs).toHaveLength(2);
    expect(snapshot.tabs.map((t) => t.tabId)).toEqual([202, 303]);
  });

  test('最後のタブ完了後、キューが空になり停止する', async () => {
    const initialQueue: ReadingQueue = {
      tabs: [createTab(101)],
      currentIndex: 0,
      status: 'reading',
      settings: initialSettings,
    };
    mockedLoadQueue.mockResolvedValue({ ...initialQueue, tabs: [...initialQueue.tabs] });

    await manager.initialize();
    await startPlayback();

    // 読み上げ完了をトリガー
    if (onEndCallback) {
      onEndCallback();
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    const snapshot = manager.getSnapshot();
    expect(snapshot.tabs).toHaveLength(0);
    expect(snapshot.status).toBe('idle');
    expect(snapshot.currentIndex).toBe(0);
  });

  test('複数タブがある場合、完了後に次のタブが再生される', async () => {
    const initialQueue: ReadingQueue = {
      tabs: [createTab(101), createTab(202)],
      currentIndex: 0,
      status: 'reading',
      settings: initialSettings,
    };
    mockedLoadQueue.mockResolvedValue({ ...initialQueue, tabs: [...initialQueue.tabs] });

    await manager.initialize();
    await startPlayback();

    // 最初のplayback.start呼び出しを確認
    expect(playback.start).toHaveBeenCalledTimes(1);
    expect(playback.start.mock.calls[0][0].tabId).toBe(101);

    // 読み上げ完了をトリガー
    if (onEndCallback) {
      onEndCallback();
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    // 次のタブで再生が開始される
    expect(playback.start).toHaveBeenCalledTimes(2);
    expect(playback.start.mock.calls[1][0].tabId).toBe(202);
  });

  test('キューの永続化が行われる', async () => {
    const initialQueue: ReadingQueue = {
      tabs: [createTab(101), createTab(202)],
      currentIndex: 0,
      status: 'reading',
      settings: initialSettings,
    };
    mockedLoadQueue.mockResolvedValue({ ...initialQueue, tabs: [...initialQueue.tabs] });

    await manager.initialize();
    mockedSaveQueue.mockClear();
    await startPlayback();

    // 読み上げ完了をトリガー
    if (onEndCallback) {
      onEndCallback();
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    // 永続化確認のためflushを呼び出し
    await manager.flushPersistence();

    // 保存が呼ばれている
    expect(mockedSaveQueue).toHaveBeenCalled();
  });
});
