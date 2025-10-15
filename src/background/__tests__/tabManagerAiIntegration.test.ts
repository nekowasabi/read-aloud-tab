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
    test('AI設定を読み込み、AiProcessorを初期化する', async () => {
      // Arrange
      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      };
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);

      // Act
      await manager.initialize();

      // Assert
      expect(StorageManager.getAiSettings).toHaveBeenCalled();
      expect(mockAiProcessor.updateSettings).toHaveBeenCalledWith(aiSettings);
    });
  });

  describe('ensureTabReady with AI processing', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('AI要約有効時、processedContentが設定される', async () => {
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
      mockAiProcessor.processContent.mockResolvedValue('Summarized content');

      // Reinitialize to pick up new settings
      await manager.initialize();

      await manager.addTab(mockTab);

      // Act
      await manager.processNext(0);

      // Wait for async operations (AI processing takes time)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(mockAiProcessor.processContent).toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      const processedTab = snapshot.tabs[0];
      expect(processedTab.processedContent).toBe('Summarized content');
    });

    test('AI翻訳有効時、processedContentが設定される', async () => {
      // Arrange
      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: true,
        summaryPrompt: '',
        translationPrompt: '',
      };
      // Set up mocks before adding tab
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);
      mockAiProcessor.isEnabled.mockReturnValue(true);
      mockAiProcessor.processContent.mockResolvedValue('翻訳されたコンテンツ');

      // Reinitialize to pick up new settings
      await manager.initialize();

      await manager.addTab(mockTab);

      // Act
      await manager.processNext(0);

      // Wait for async operations (AI processing takes time)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(mockAiProcessor.processContent).toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      const processedTab = snapshot.tabs[0];
      expect(processedTab.processedContent).toBe('翻訳されたコンテンツ');
    });

    test('両方有効時、processedContentが設定される', async () => {
      // Arrange
      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: true,
        summaryPrompt: '',
        translationPrompt: '',
      };
      // Set up mocks before adding tab
      (StorageManager.getAiSettings as jest.Mock).mockResolvedValue(aiSettings);
      mockAiProcessor.isEnabled.mockReturnValue(true);
      mockAiProcessor.processContent.mockResolvedValue('要約されて翻訳されたコンテンツ');

      // Reinitialize to pick up new settings
      await manager.initialize();

      await manager.addTab(mockTab);

      // Act
      await manager.processNext(0);

      // Wait for async operations (AI processing takes time)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(mockAiProcessor.processContent).toHaveBeenCalled();
      const snapshot = manager.getSnapshot();
      const processedTab = snapshot.tabs[0];
      expect(processedTab.processedContent).toBe('要約されて翻訳されたコンテンツ');
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
  });

  describe('updateSettings', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('設定変更時、既存タブのprocessedContentがクリアされる', async () => {
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
      mockAiProcessor.processContent.mockResolvedValue('Summarized content');

      // Reinitialize to pick up new settings
      await manager.initialize();

      // タブを追加してprocessedContentを設定
      await manager.addTab(mockTab);
      await manager.processNext(0);
      await new Promise((resolve) => setTimeout(resolve, 100));

      let snapshot = manager.getSnapshot();
      expect(snapshot.tabs[0].processedContent).toBe('Summarized content');

      // Act - 設定を変更
      const newSettings: Partial<TTSSettings> = {
        rate: 1.5,
      };
      await manager.updateSettings(newSettings);

      // Assert - processedContentがクリアされる
      snapshot = manager.getSnapshot();
      expect(snapshot.tabs[0].processedContent).toBeUndefined();
      expect(mockAiProcessor.updateSettings).toHaveBeenCalled();
    });
  });
});
