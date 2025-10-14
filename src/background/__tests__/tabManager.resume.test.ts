import { TabManager } from '../tabManager';
import { QueueStatusPayload } from '../../shared/messages';
import { StorageManager } from '../../shared/utils/storage';

jest.mock('../../shared/utils/storage', () => {
  const original = jest.requireActual('../../shared/utils/storage');
  return {
    ...original,
    StorageManager: {
      ...original.StorageManager,
      getAiSettings: jest.fn().mockResolvedValue({
        openRouterApiKey: '',
        openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
        enableAiSummary: false,
        enableAiTranslation: false,
      }),
    },
  };
});

describe('TabManager resume capability', () => {
  const baseQueue = {
    tabs: [
      {
        tabId: 1,
        url: 'https://example.com',
        title: 'Example',
        content: 'Hello world',
        isIgnored: false,
      },
    ],
    currentIndex: 0,
    status: 'reading' as QueueStatusPayload['status'],
    settings: {
      rate: 1,
      pitch: 1,
      volume: 1,
      voice: null,
    },
    progressByTab: { 1: 35 },
    persistedAt: Date.now() - 1000,
  };

  const createTabManager = () => {
    const playback = {
      start: jest.fn(async (_tab, _settings, _hooks) => undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };

    const storage = {
      load: jest.fn().mockResolvedValue({ ...baseQueue }),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const tabManager = new TabManager({
      playback: playback as any,
      storage: storage as any,
      getIgnoredDomains: async () => [],
      resolveContent: async () => ({ content: 'Hello world' }),
      logger: console,
      now: () => Date.now(),
    });

    return { tabManager, playback, storage };
  };

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('resumes playback for reading status after initialization', async () => {
    const { tabManager, playback } = createTabManager();

    const statusUpdates: QueueStatusPayload[] = [];
    tabManager.addStatusListener((payload) => statusUpdates.push(payload));

    await tabManager.initialize();
    expect(playback.start).not.toHaveBeenCalled();

    await tabManager.resumePlaybackIfNeeded();

    expect(playback.start).toHaveBeenCalledTimes(1);
    expect(statusUpdates[statusUpdates.length - 1]?.status).toBe('reading');
  });

  it('persists progress updates after resume', async () => {
    jest.useFakeTimers();
    const { tabManager, playback, storage } = createTabManager();

    await tabManager.initialize();
    await tabManager.resumePlaybackIfNeeded();

    const hooks = playback.start.mock.calls[0][2];
    hooks.onProgress?.(42);

    jest.advanceTimersByTime(100);
    await tabManager.flushPersistence();

    const savedQueue = storage.save.mock.calls[storage.save.mock.calls.length - 1]?.[0];
    expect(savedQueue.progressByTab).toEqual({ 1: 42 });
    expect(typeof savedQueue.persistedAt).toBe('number');
  });
});
