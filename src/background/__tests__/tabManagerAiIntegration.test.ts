/**
 * TabManager AI統合のユニットテスト
 */
import { TabManager } from '../tabManager';
import type { TabInfo, AiSettings, ReadingQueue, TTSSettings } from '../../shared/types';
import type { PlaybackController } from '../tabManager';
import { StorageManager } from '../../shared/utils/storage';

// AiProcessorをモック化
jest.mock('../aiProcessor');
import { AiProcessor } from '../aiProcessor';

const MockedAiProcessor = AiProcessor as jest.MockedClass<typeof AiProcessor>;

// StorageManagerをモック化
jest.mock('../../shared/utils/storage', () => ({
  StorageManager: {
    validateSettings: jest.fn((settings) => settings),
    saveSettings: jest.fn(),
    getAiSettings: jest.fn(),
  },
  loadQueue: jest.fn(),
  saveQueue: jest.fn(),
  getIgnoredDomains: jest.fn(),
}));

describe('TabManager AI統合', () => {
  let manager: TabManager;
  let mockPlayback: jest.Mocked<PlaybackController>;
  let mockAiProcessor: jest.Mocked<AiProcessor>;

  const mockTab: TabInfo = {
    tabId: 1,
    url: 'https://example.com',
    title: 'Test Page',
    content: 'Original content',
    isIgnored: false,
    extractedAt: new Date(),
  };

  const mockTTSSettings: TTSSettings = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // PlaybackControllerのモック
    mockPlayback = {
      start: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };

    // AiProcessorのモックインスタンスを作成
    mockAiProcessor = {
      updateSettings: jest.fn(),
      isEnabled: jest.fn(),
      processContent: jest.fn(),
    } as any;

    MockedAiProcessor.mockImplementation(() => mockAiProcessor);

    // StorageManagerのモック設定
    (StorageManager.getAiSettings as jest.Mock).mockResolvedValue({
      openRouterApiKey: 'test-key',
      openRouterModel: 'test-model',
      enableAiSummary: false,
      enableAiTranslation: false,
      summaryPrompt: '',
      translationPrompt: '',
    });

    const { loadQueue, saveQueue } = require('../../shared/utils/storage');
    (loadQueue as jest.Mock).mockResolvedValue({
      tabs: [],
      currentIndex: 0,
      status: 'idle',
      settings: mockTTSSettings,
    });
    (saveQueue as jest.Mock).mockResolvedValue(undefined);

    // resolveContentモックを追加してensureTabReadyがAI処理まで到達できるようにする
    const mockResolveContent = jest.fn().mockResolvedValue({
      content: mockTab.content,
      extractedAt: mockTab.extractedAt,
    });

    manager = new TabManager({
      playback: mockPlayback,
      resolveContent: mockResolveContent,
    });
  });

  describe('initialize', () => {
    test('正常に初期化される', async () => {
      // Act
      await manager.initialize();

      // Assert
      // 初期化が成功した
      expect(manager.getSnapshot().status).toBe('idle');
      expect(manager.getSnapshot().tabs).toEqual([]);
    });
  });

  describe('ensureTabReady with AI processing', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('AI要約有効時、プリフェッチ結果が使用される', async () => {
      // プリフェッチからsummaryが取得される
      const prefetchedSummary = 'Summarized content';
      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        summary: prefetchedSummary,
        extractedAt: mockTab.extractedAt,
      });

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });

      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      };
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);

      await newManager.initialize();
      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      // resolveContentが呼ばれている
      expect(mockResolveContent).toHaveBeenCalled();
      // AiProcessorは呼ばれていない
      expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
      const snapshot = newManager.getSnapshot();
      const processedTab = snapshot.tabs[0];
      expect(processedTab.summary).toBe(prefetchedSummary);
    });

    test('AI翻訳有効時、プリフェッチ結果が使用される', async () => {
      // プリフェッチからtranslationが取得される
      const prefetchedTranslation = '翻訳されたコンテンツ';
      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        translation: prefetchedTranslation,
        extractedAt: mockTab.extractedAt,
      });

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });

      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: true,
        summaryPrompt: '',
        translationPrompt: '',
      };
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);

      await newManager.initialize();
      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      // resolveContentが呼ばれている
      expect(mockResolveContent).toHaveBeenCalled();
      // AiProcessorは呼ばれていない
      expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
      const snapshot = newManager.getSnapshot();
      const processedTab = snapshot.tabs[0];
      expect(processedTab.translation).toBe(prefetchedTranslation);
    });

    test('両方有効時、プリフェッチ結果が使用される', async () => {
      // プリフェッチからtranslationが取得される（translationは優先度が高い）
      const prefetchedTranslation = '要約されて翻訳されたコンテンツ';
      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        summary: 'summary',
        translation: prefetchedTranslation,
        extractedAt: mockTab.extractedAt,
      });

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });

      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: true,
        summaryPrompt: '',
        translationPrompt: '',
      };
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);

      await newManager.initialize();
      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      // resolveContentが呼ばれている
      expect(mockResolveContent).toHaveBeenCalled();
      // AiProcessorは呼ばれていない
      expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
      const snapshot = newManager.getSnapshot();
      const processedTab = snapshot.tabs[0];
      // translationの優先度が高いため、translationが使用される
      expect(processedTab.translation).toBe(prefetchedTranslation);
    });

    test('AI無効時、processedContentが設定されない', async () => {
      // Arrange
      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      };
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);
      mockAiProcessor.isEnabled.mockReturnValue(false);

      await manager.addTab(mockTab);

      // Act
      await manager.processNext(0);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Assert
      expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      const processedTab = snapshot.tabs[0];
      expect(processedTab.processedContent).toBeUndefined();
    });

    test('API失敗時、processedContentが設定されず元のcontentで動作する', async () => {
      // Arrange
      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      };
      // Set up mocks before adding tab
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);
      mockAiProcessor.isEnabled.mockReturnValue(true);
      mockAiProcessor.processContent.mockRejectedValue(new Error('API Error'));

      // Reinitialize to pick up new settings
      await manager.initialize();

      await manager.addTab(mockTab);

      // Act
      await manager.processNext(0);

      // Wait for async operations (AI processing takes time)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert - エラーが発生してもplaybackが開始される
      expect(mockPlayback.start).toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      const processedTab = snapshot.tabs[0];
      // processedContentは設定されていない
      expect(processedTab.processedContent).toBeUndefined();
    });

    test('プリフェッチから取得したsummaryが使用される', async () => {
      // Arrange
      const prefetchedSummary = 'This is a prefetched summary';
      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        summary: prefetchedSummary,
        extractedAt: mockTab.extractedAt,
      });

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });
      await newManager.initialize();

      // AI設定は無効にしてAiProcessorが呼ばれないことを確認する
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue({
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      });

      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      // resolveContentが呼ばれてsummaryを取得している
      expect(mockResolveContent).toHaveBeenCalled();
      // AiProcessorは呼ばれていない（プリフェッチからの結果を使用している）
      expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
      // TabにsummaryがセットされていることをselectPlaybackContentで確認
      const snapshot = newManager.getSnapshot();
      const tab = snapshot.tabs[0];
      expect(tab.summary).toBe(prefetchedSummary);
    });

    test('プリフェッチから取得したtranslationが使用される', async () => {
      // Arrange
      const prefetchedTranslation = 'This is a prefetched translation';
      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        translation: prefetchedTranslation,
        extractedAt: mockTab.extractedAt,
      });

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });
      await newManager.initialize();

      // AI設定は無効にしてAiProcessorが呼ばれないことを確認する
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue({
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      });

      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      // resolveContentが呼ばれてtranslationを取得している
      expect(mockResolveContent).toHaveBeenCalled();
      // AiProcessorは呼ばれていない
      expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
      // Tabにtranslationがセットされていることを確認
      const snapshot = newManager.getSnapshot();
      const tab = snapshot.tabs[0];
      expect(tab.translation).toBe(prefetchedTranslation);
    });

    test('resolveContentがAiProcessorを置き換える（2重処理を防ぐ）', async () => {
      // Arrange
      const prefetchedSummary = 'Prefetched summary (should be used)';
      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        summary: prefetchedSummary,
        extractedAt: mockTab.extractedAt,
      });

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });

      // AI設定を有効にして、通常ならばAiProcessorが呼ばれる状況
      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      };
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);
      mockAiProcessor.isEnabled.mockReturnValue(true);
      mockAiProcessor.processContent.mockResolvedValue('AI-processed content');

      await newManager.initialize();
      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      // resolveContentが呼ばれている
      expect(mockResolveContent).toHaveBeenCalled();
      // AiProcessorが呼ばれていない（プリフェッチ結果があるので2重処理を回避）
      expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
      // Tabにはプリフェッチされたsummaryが設定されている
      const snapshot = newManager.getSnapshot();
      const tab = snapshot.tabs[0];
      expect(tab.summary).toBe(prefetchedSummary);
    });
  });

  describe('updateSettings', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('設定変更時、既存タブのプリフェッチ結果がクリアされる', async () => {
      // Arrange
      const prefetchedSummary = 'Summarized content';
      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        summary: prefetchedSummary,
        extractedAt: mockTab.extractedAt,
      });

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });

      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      };
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);

      await newManager.initialize();

      // タブを追加してsummaryを設定
      await newManager.addTab(mockTab);
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      let snapshot = newManager.getSnapshot();
      expect(snapshot.tabs[0].summary).toBe(prefetchedSummary);

      // Act - 設定を変更
      const newSettings: Partial<TTSSettings> = {
        rate: 1.5,
      };
      await newManager.updateSettings(newSettings);

      // Assert - summaryと translationがクリアされる
      snapshot = newManager.getSnapshot();
      expect(snapshot.tabs[0].summary).toBeUndefined();
      expect(snapshot.tabs[0].translation).toBeUndefined();
      expect(snapshot.tabs[0].processedContent).toBeUndefined();
    });
  });

  describe('Edge cases for prefetch (process50)', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('resolveContentがnullを返す場合、コンテンツリクエストが発行される', async () => {
      // Arrange
      const mockResolveContent = jest.fn().mockResolvedValue(null);
      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });

      const commandListener = jest.fn();
      newManager.addCommandListener(commandListener);

      await newManager.initialize();
      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      // resolveContentが呼ばれている
      expect(mockResolveContent).toHaveBeenCalled();
      // コンテンツリクエストが発行されている
      expect(commandListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'QUEUE_CONTENT_REQUEST',
          payload: expect.objectContaining({
            tabId: mockTab.tabId,
            reason: 'missing',
          }),
        })
      );
    });

    test('resolveContentがエラーをthrowする場合、コンテンツリクエストが発行される', async () => {
      // Arrange
      const mockResolveContent = jest.fn().mockRejectedValue(new Error('Resolver failed'));
      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });

      const commandListener = jest.fn();
      newManager.addCommandListener(commandListener);

      await newManager.initialize();
      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      expect(mockResolveContent).toHaveBeenCalled();
      expect(commandListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'QUEUE_CONTENT_REQUEST',
        })
      );
    });

    test('resolveContentが存在しない場合、コンテンツリクエストが発行される', async () => {
      // Arrange
      const newManager = new TabManager({
        playback: mockPlayback,
        // resolveContentなし
      });

      const commandListener = jest.fn();
      newManager.addCommandListener(commandListener);

      await newManager.initialize();
      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Assert
      expect(commandListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'QUEUE_CONTENT_REQUEST',
        })
      );
    });

    test('ignored tabはスキップされる', async () => {
      // Arrange
      const ignoredTab: TabInfo = {
        ...mockTab,
        url: 'https://ignored-domain.example.com',
        isIgnored: true,
      };

      const mockResolveContent = jest.fn().mockResolvedValue({
        content: ignoredTab.content,
        extractedAt: ignoredTab.extractedAt,
      });

      // モックgetIgnoredDomainsを設定
      const { getIgnoredDomains } = require('../../shared/utils/storage');
      (getIgnoredDomains as jest.Mock).mockResolvedValue(['ignored-domain.example.com']);

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
        getIgnoredDomains: async () => ['ignored-domain.example.com'],
      });

      await newManager.initialize();
      await newManager.addTab(ignoredTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Assert
      // resolveContentは呼ばれない
      expect(mockResolveContent).not.toHaveBeenCalled();
      // playbackは開始されない
      expect(mockPlayback.start).not.toHaveBeenCalled();
    });

    test('setContentResolverで後から設定可能', async () => {
      // Arrange
      const newManager = new TabManager({
        playback: mockPlayback,
        // 初期状態ではresolveContentなし
      });

      await newManager.initialize();
      await newManager.addTab(mockTab);

      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        summary: 'Late-bound summary',
        extractedAt: mockTab.extractedAt,
      });

      // Act
      // 後からsetContentResolverで設定
      newManager.setContentResolver(mockResolveContent);
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      expect(mockResolveContent).toHaveBeenCalled();
      const snapshot = newManager.getSnapshot();
      expect(snapshot.tabs[0].summary).toBe('Late-bound summary');
    });

    test('resolveContentから返されたsummaryが優先的に使用される', async () => {
      // Arrange
      const prefetchedSummary = 'Prefetched summary';
      const mockResolveContent = jest.fn().mockResolvedValue({
        content: mockTab.content,
        summary: prefetchedSummary,
        translation: 'Prefetched translation',
        extractedAt: mockTab.extractedAt,
      });

      const newManager = new TabManager({
        playback: mockPlayback,
        resolveContent: mockResolveContent,
      });

      await newManager.initialize();
      await newManager.addTab(mockTab);

      // Act
      await newManager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      const snapshot = newManager.getSnapshot();
      const tab = snapshot.tabs[0];
      // translationの優先度が高いので、translationが使用される
      expect(tab.translation).toBe('Prefetched translation');
      expect(tab.summary).toBe(prefetchedSummary);
    });
  });
});
