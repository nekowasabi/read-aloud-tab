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

describe('TabManager.clearQueue', () => {
  let manager: TabManager;
  let playback: jest.Mocked<PlaybackController>;
  const mockedLoadQueue = loadQueue as jest.MockedFunction<typeof loadQueue>;
  const mockedSaveQueue = saveQueue as jest.MockedFunction<typeof saveQueue>;

  const initialSettings: TTSSettings = {
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: null,
  };

  const initialQueue: ReadingQueue = {
    tabs: [
      {
        tabId: 101,
        url: 'https://example.com/101',
        title: 'Tab 101',
        isIgnored: false,
        extractedAt: new Date(),
      } as TabInfo,
      {
        tabId: 202,
        url: 'https://example.com/202',
        title: 'Tab 202',
        isIgnored: false,
        extractedAt: new Date(),
      } as TabInfo,
    ],
    currentIndex: 1,
    status: 'reading',
    settings: initialSettings,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockedLoadQueue.mockResolvedValue({ ...initialQueue });
    mockedSaveQueue.mockResolvedValue(undefined);

    playback = {
      start: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };

    manager = new TabManager({ playback });
  });

  test('キュー全体をリセットし、再生を停止して永続化する', async () => {
    await manager.initialize();
    mockedSaveQueue.mockClear();

    const statusListener = jest.fn();
    manager.addStatusListener(statusListener);

    await manager.clearQueue();
    await manager.flushPersistence();

    expect(playback.stop).toHaveBeenCalled();
    expect(mockedSaveQueue).toHaveBeenCalled();

    const snapshot = manager.getSnapshot();
    expect(snapshot.tabs).toHaveLength(0);
    expect(snapshot.status).toBe('idle');
    expect(snapshot.currentIndex).toBe(0);

    expect(statusListener).toHaveBeenCalled();
    const payload = statusListener.mock.calls.at(-1)?.[0];
    expect(payload.totalCount).toBe(0);
  });

  test('空のキューでは追加処理を行わない', async () => {
    mockedLoadQueue.mockResolvedValue({
      tabs: [],
      currentIndex: 0,
      status: 'idle',
      settings: initialSettings,
    });

    await manager.initialize();
    mockedSaveQueue.mockClear();
    playback.stop.mockClear();

    await manager.clearQueue();

    expect(playback.stop).not.toHaveBeenCalled();
    expect(mockedSaveQueue).not.toHaveBeenCalled();
  });
});
