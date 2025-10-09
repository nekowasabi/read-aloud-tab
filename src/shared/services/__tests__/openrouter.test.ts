/**
 * OpenRouterClient のユニットテスト（モック使用）
 */
import { OpenRouterClient } from '../openrouter';
import type { OpenRouterResponse } from '../../types/ai';

// fetch APIをモック化
global.fetch = jest.fn();

describe('OpenRouterClient', () => {
  const mockApiKey = 'sk-or-test-key-12345';
  const mockModel = 'meta-llama/llama-3.2-1b-instruct';

  beforeEach(() => {
    // 各テスト前にモックをリセット
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('testConnection', () => {
    test('接続テストが成功した場合、success: true を返す', async () => {
      // Arrange
      const mockResponse: OpenRouterResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'OK',
            },
            finish_reason: 'stop',
          },
        ],
        model: mockModel,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act
      const result = await client.testConnection();

      // Assert
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${mockApiKey}`,
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    test('401エラーの場合、APIキーが無効というエラーを返す', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Invalid API key' }),
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act
      const result = await client.testConnection();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('APIキーが無効です');
    });

    test('429エラーの場合、リクエスト制限のエラーを返す', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ error: 'Rate limit exceeded' }),
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act
      const result = await client.testConnection();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('リクエスト制限に達しました');
    });

    test('500系エラーの場合、サーバーエラーを返す', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act
      const result = await client.testConnection();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('サーバーエラーが発生しました');
    });

    test('ネットワークエラーの場合、接続エラーを返す', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act
      const result = await client.testConnection();

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('ネットワーク接続を確認してください');
    });
  });

  describe('summarize', () => {
    const mockContent = 'This is a test content to summarize.';
    const mockSummary = 'Test summary.';

    test('要約リクエストが成功した場合、要約テキストを返す', async () => {
      // Arrange
      const mockResponse: OpenRouterResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: mockSummary,
            },
            finish_reason: 'stop',
          },
        ],
        model: mockModel,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act
      const result = await client.summarize(mockContent, 100);

      // Assert
      expect(result).toBe(mockSummary);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // リクエストボディの検証
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.messages).toHaveLength(2);
      expect(requestBody.messages[0].role).toBe('system');
      expect(requestBody.messages[0].content).toContain('Summarize');
      expect(requestBody.messages[1].role).toBe('user');
      expect(requestBody.messages[1].content).toBe(mockContent);
      expect(requestBody.max_tokens).toBe(100);
    });

    test('要約リクエストが失敗した場合、エラーをスローする', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act & Assert
      await expect(client.summarize(mockContent, 100)).rejects.toThrow('サーバーエラーが発生しました');
    });

    test('レスポンスにchoicesが含まれない場合、エラーをスローする', async () => {
      // Arrange
      const invalidResponse = {
        choices: [],
        model: mockModel,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => invalidResponse,
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act & Assert
      await expect(client.summarize(mockContent, 100)).rejects.toThrow();
    });
  });

  describe('translate', () => {
    const mockContent = 'This is a test content to translate.';
    const mockTranslation = 'これはテスト用の翻訳コンテンツです。';

    test('翻訳リクエストが成功した場合、翻訳テキストを返す', async () => {
      // Arrange
      const mockResponse: OpenRouterResponse = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: mockTranslation,
            },
            finish_reason: 'stop',
          },
        ],
        model: mockModel,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act
      const result = await client.translate(mockContent, 2000);

      // Assert
      expect(result).toBe(mockTranslation);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // リクエストボディの検証
      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.messages).toHaveLength(2);
      expect(requestBody.messages[0].role).toBe('system');
      expect(requestBody.messages[0].content).toContain('Translate');
      expect(requestBody.messages[0].content).toContain('Japanese');
      expect(requestBody.messages[1].role).toBe('user');
      expect(requestBody.messages[1].content).toBe(mockContent);
      expect(requestBody.max_tokens).toBe(2000);
    });

    test('翻訳リクエストが失敗した場合、エラーをスローする', async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error' }),
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act & Assert
      await expect(client.translate(mockContent, 2000)).rejects.toThrow('サーバーエラーが発生しました');
    });

    test('レスポンスにchoicesが含まれない場合、エラーをスローする', async () => {
      // Arrange
      const invalidResponse = {
        choices: [],
        model: mockModel,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => invalidResponse,
      });

      const client = new OpenRouterClient(mockApiKey, mockModel);

      // Act & Assert
      await expect(client.translate(mockContent, 2000)).rejects.toThrow();
    });
  });
});
