/**
 * AiProcessor のユニットテスト
 */
import { AiProcessor } from '../aiProcessor';
import type { AiSettings, TabInfo } from '../../shared/types';

// OpenRouterClientをモック化
jest.mock('../../shared/services/openrouter');
import { OpenRouterClient } from '../../shared/services/openrouter';

const MockedOpenRouterClient = OpenRouterClient as jest.MockedClass<typeof OpenRouterClient>;

describe('AiProcessor', () => {
  let processor: AiProcessor;
  let mockClient: jest.Mocked<OpenRouterClient>;

  beforeEach(() => {
    // モックのリセット
    jest.clearAllMocks();

    // OpenRouterClientのモックインスタンスを作成
    mockClient = {
      summarize: jest.fn(),
      translate: jest.fn(),
      testConnection: jest.fn(),
    } as any;

    MockedOpenRouterClient.mockImplementation(() => mockClient);

    processor = new AiProcessor();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('updateSettings', () => {
    test('APIキー設定時にclientが初期化される', () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };

      // Act
      processor.updateSettings(settings);

      // Assert
      expect(MockedOpenRouterClient).toHaveBeenCalledWith('test-key', 'test-model');
    });

    test('APIキー未設定時にclientがnullになる', () => {
      // Arrange
      const settingsWithKey: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };
      processor.updateSettings(settingsWithKey);
      expect(MockedOpenRouterClient).toHaveBeenCalledTimes(1);

      const settingsWithoutKey: AiSettings = {
        openRouterApiKey: '',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };

      // Act
      processor.updateSettings(settingsWithoutKey);

      // Assert
      // clientがnullになったことを確認するため、isEnabledがfalseを返す
      expect(processor.isEnabled(settingsWithoutKey)).toBe(false);
    });
  });

  describe('isEnabled', () => {
    test('要約有効時にtrueを返す', () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };
      processor.updateSettings(settings);

      // Act & Assert
      expect(processor.isEnabled(settings)).toBe(true);
    });

    test('翻訳有効時にtrueを返す', () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: true,
      };
      processor.updateSettings(settings);

      // Act & Assert
      expect(processor.isEnabled(settings)).toBe(true);
    });

    test('両方無効時にfalseを返す', () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
      };
      processor.updateSettings(settings);

      // Act & Assert
      expect(processor.isEnabled(settings)).toBe(false);
    });

    test('client未初期化時にfalseを返す', () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: '',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };
      processor.updateSettings(settings);

      // Act & Assert
      expect(processor.isEnabled(settings)).toBe(false);
    });
  });

  describe('processContent', () => {
    const mockTab: TabInfo = {
      tabId: 1,
      url: 'https://example.com',
      title: 'Test Page',
      content: 'Original content',
      isIgnored: false,
      extractedAt: new Date(),
    };

    test('要約のみ有効な場合、summarize()のみが呼ばれる', async () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };
      processor.updateSettings(settings);

      const summarizedContent = 'Summarized content';
      mockClient.summarize.mockResolvedValue(summarizedContent);

      // Act
      const result = await processor.processContent(mockTab, settings);

      // Assert
      expect(mockClient.summarize).toHaveBeenCalledWith('Original content', 500);
      expect(mockClient.translate).not.toHaveBeenCalled();
      expect(result).toBe(summarizedContent);
    });

    test('翻訳のみ有効な場合、translate()のみが呼ばれる', async () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: true,
      };
      processor.updateSettings(settings);

      const translatedContent = '翻訳されたコンテンツ';
      mockClient.translate.mockResolvedValue(translatedContent);

      // Act
      const result = await processor.processContent(mockTab, settings);

      // Assert
      expect(mockClient.summarize).not.toHaveBeenCalled();
      expect(mockClient.translate).toHaveBeenCalledWith('Original content', 2000);
      expect(result).toBe(translatedContent);
    });

    test('両方有効な場合、summarize() → translate()の順で呼ばれる', async () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: true,
      };
      processor.updateSettings(settings);

      const summarizedContent = 'Summarized content';
      const translatedContent = '要約されて翻訳されたコンテンツ';
      mockClient.summarize.mockResolvedValue(summarizedContent);
      mockClient.translate.mockResolvedValue(translatedContent);

      // Act
      const result = await processor.processContent(mockTab, settings);

      // Assert
      expect(mockClient.summarize).toHaveBeenCalledWith('Original content', 500);
      expect(mockClient.translate).toHaveBeenCalledWith(summarizedContent, 2000);
      expect(result).toBe(translatedContent);
    });

    test('AI処理無効時、元のcontentを返す', async () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
      };
      processor.updateSettings(settings);

      // Act
      const result = await processor.processContent(mockTab, settings);

      // Assert
      expect(mockClient.summarize).not.toHaveBeenCalled();
      expect(mockClient.translate).not.toHaveBeenCalled();
      expect(result).toBe('Original content');
    });

    test('client未初期化時、元のcontentを返す', async () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: '',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };
      processor.updateSettings(settings);

      // Act
      const result = await processor.processContent(mockTab, settings);

      // Assert
      expect(result).toBe('Original content');
    });

    test('content空の場合、nullを返す', async () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };
      processor.updateSettings(settings);

      const emptyTab: TabInfo = {
        ...mockTab,
        content: undefined,
      };

      // Act
      const result = await processor.processContent(emptyTab, settings);

      // Assert
      expect(result).toBeNull();
    });

    test('API失敗時、元のcontentを返す（フォールバック）', async () => {
      // Arrange
      const settings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: true,
        enableAiTranslation: false,
      };
      processor.updateSettings(settings);

      mockClient.summarize.mockRejectedValue(new Error('API Error'));

      // Act
      const result = await processor.processContent(mockTab, settings);

      // Assert
      expect(result).toBe('Original content');
    });
  });
});
