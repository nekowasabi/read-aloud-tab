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

describe('TabManager auto-resume behavior', () => {
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
    progressByTab: { 1: 0 },
    persistedAt: Date.now() - 1000,
  };

  const createTabManager = (overrides: { queueOverrides?: Partial<typeof baseQueue> } = {}) => {
    const playback = {
      start: jest.fn(async (_tab, _settings, _hooks) => undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };

    const mergedQueue = { ...baseQueue, ...overrides.queueOverrides };

    const storage = {
      load: jest.fn().mockResolvedValue({ ...mergedQueue }),
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

  describe('user pause behavior', () => {
    it('should NOT auto-resume when user manually paused and tab content is updated', async () => {
      const { tabManager, playback } = createTabManager();

      await tabManager.initialize();

      // ユーザーがpause
      tabManager.pause();
      expect(tabManager.getSnapshot().status).toBe('paused');

      // playback.start のモックをクリア（initialize時の呼び出しをリセット）
      playback.start.mockClear();

      // タブ切り替えによりコンテンツ更新
      await tabManager.onTabUpdated(1, { content: 'New content from tab switch' });

      // 再開していないことを確認
      expect(tabManager.getSnapshot().status).toBe('paused');
      // processNextが呼ばれていないことを確認（auto-resumeが発生していない）
      expect(playback.start).not.toHaveBeenCalled();
    });

    it('should resume normally when user calls resume() after manual pause', async () => {
      const { tabManager, playback } = createTabManager();

      await tabManager.initialize();

      // ユーザーがpause
      tabManager.pause();
      expect(tabManager.getSnapshot().status).toBe('paused');

      // ユーザーがresume
      tabManager.resume();
      expect(tabManager.getSnapshot().status).toBe('reading');
      expect(playback.resume).toHaveBeenCalled();
    });
  });

  describe('content extraction wait behavior', () => {
    it('should auto-resume when paused due to content extraction wait', async () => {
      // このテストは現状のauto-resume動作を確認する
      // paused状態でコンテンツが更新されると自動的に再開する

      const playback = {
        start: jest.fn(async (_tab, _settings, _hooks) => undefined),
        pause: jest.fn(),
        resume: jest.fn(),
        stop: jest.fn(),
        updateSettings: jest.fn(),
      };

      // paused状態で開始（コンテンツ抽出待ちを模倣）
      const storage = {
        load: jest.fn().mockResolvedValue({
          ...baseQueue,
          status: 'paused',  // コンテンツ抽出待ちでpausedになった状態
          currentIndex: 0,
        }),
        save: jest.fn().mockResolvedValue(undefined),
      };

      const tabManager = new TabManager({
        playback: playback as any,
        storage: storage as any,
        getIgnoredDomains: async () => [],
        resolveContent: async () => ({ content: 'Resolved content' }),
        logger: console,
        now: () => Date.now(),
      });

      await tabManager.initialize();
      expect(tabManager.getSnapshot().status).toBe('paused');

      // playback.start のモックをクリア
      playback.start.mockClear();

      // コンテンツ到着（onTabUpdatedで新しいコンテンツが送られる）
      await tabManager.onTabUpdated(1, { content: 'Extracted content from page' });

      // 自動再開していることを確認
      // 現状のコードではshouldAutoResumeがtrueになり、processNextが呼ばれる
      expect(playback.start).toHaveBeenCalled();
    });
  });

  describe('reading state behavior', () => {
    it('should continue playback when tab content is updated during reading', async () => {
      const { tabManager, playback } = createTabManager();

      await tabManager.initialize();
      expect(tabManager.getSnapshot().status).toBe('reading');

      // playback.start のモックをクリア
      playback.start.mockClear();

      // 再生中にコンテンツ更新
      await tabManager.onTabUpdated(1, { content: 'Updated content' });

      // 状態は reading のまま（変化なし）
      expect(tabManager.getSnapshot().status).toBe('reading');
      // 再起動されていないことを確認
      expect(playback.start).not.toHaveBeenCalled();
    });

    it('should not trigger auto-resume when status is reading', async () => {
      const { tabManager, playback } = createTabManager();

      await tabManager.initialize();

      const statusUpdates: QueueStatusPayload[] = [];
      tabManager.addStatusListener((payload) => statusUpdates.push(payload));

      // 再生中にコンテンツ更新
      await tabManager.onTabUpdated(1, { content: 'Updated content during reading' });

      // ステータスは reading のまま
      const lastStatus = statusUpdates[statusUpdates.length - 1];
      expect(lastStatus?.status).toBe('reading');
    });
  });
});
