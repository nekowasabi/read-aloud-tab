import { OpenRouterClient } from '../openrouter';

describe('OpenRouterClient', () => {
  let client: OpenRouterClient;
  const testApiKey = 'test-api-key';
  const testModel = 'meta-llama/llama-3.2-1b-instruct';

  // fetchをモック化
  const mockFetch = jest.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new OpenRouterClient(testApiKey, testModel);
  });

  describe('testConnection', () => {
    test('接続テスト成功: 200レスポンスを返す', async () => {
      const mockResponse = {
        id: 'test-id',
        object: 'chat.completion',
        created: Date.now(),
        model: testModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Test response',
            },
            finish_reason: 'stop',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.testConnection();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': `Bearer ${testApiKey}`,
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    test('接続テスト失敗: 401 Unauthorized エラー', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('APIキーが無効');
    });

    test('接続テスト失敗: 429 Too Many Requests エラー', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('リクエスト制限');
    });

    test('接続テスト失敗: 500系サーバーエラー', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('サーバーエラー');
    });

    test('接続テスト失敗: ネットワークエラー', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('ネットワーク');
    });
  });

  describe('summarize', () => {
    test('要約リクエスト成功: 要約テキストを返す', async () => {
      const testContent = 'This is a test content to summarize.';
      const mockSummary = 'Test summary';
      const mockResponse = {
        id: 'test-id',
        object: 'chat.completion',
        created: Date.now(),
        model: testModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: mockSummary,
            },
            finish_reason: 'stop',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.summarize(testContent, 100);

      expect(result).toBe(mockSummary);

      // リクエストボディの検証
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: testContent }),
        ])
      );
      expect(requestBody.max_tokens).toBe(100);
    });

    test('要約リクエスト失敗: エラーをスロー', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(client.summarize('test', 100)).rejects.toThrow('APIキーが無効');
    });
  });

  describe('translate', () => {
    test('翻訳リクエスト成功: 翻訳テキストを返す', async () => {
      const testContent = 'This is a test content to translate.';
      const mockTranslation = 'これは翻訳されたテキストです。';
      const mockResponse = {
        id: 'test-id',
        object: 'chat.completion',
        created: Date.now(),
        model: testModel,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: mockTranslation,
            },
            finish_reason: 'stop',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await client.translate(testContent, 'ja', 400);

      expect(result).toBe(mockTranslation);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.messages[0]).toEqual(
        expect.objectContaining({
          role: 'system',
        }),
      );
      expect(requestBody.messages[1]).toEqual(
        expect.objectContaining({
          role: 'user',
          content: testContent,
        }),
      );
      expect(requestBody.max_tokens).toBe(400);
    });

    test('翻訳リクエスト失敗: エラーをスロー', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(client.translate('test', 'ja', 400)).rejects.toThrow('APIキーが無効');
    });
  });

  describe('process3: プロバイダルーティング機能', () => {
    describe('sub1: コンストラクタにプロバイダパラメータを追加', () => {
      test('プロバイダなしでクライアントを初期化できる', () => {
        const clientWithoutProvider = new OpenRouterClient(testApiKey, testModel);
        expect(clientWithoutProvider).toBeDefined();
      });

      test('プロバイダありでクライアントを初期化できる', () => {
        const clientWithProvider = new OpenRouterClient(testApiKey, testModel, 'DeepInfra');
        expect(clientWithProvider).toBeDefined();
      });

      test('空文字列のプロバイダでクライアントを初期化できる', () => {
        const clientWithEmptyProvider = new OpenRouterClient(testApiKey, testModel, '');
        expect(clientWithEmptyProvider).toBeDefined();
      });
    });

    describe('sub2-4: リクエスト生成ロジックの更新', () => {
      test('testConnection: プロバイダが指定されている場合、リクエストボディに provider.order を含める', async () => {
        const clientWithProvider = new OpenRouterClient(testApiKey, testModel, 'DeepInfra');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: testModel,
            choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          }),
        });

        await clientWithProvider.testConnection();

        const callArgs = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(callArgs[1].body);
        expect(requestBody.provider).toEqual({ order: ['DeepInfra'] });
      });

      test('testConnection: プロバイダが空の場合、provider フィールドを含めない', async () => {
        const clientWithoutProvider = new OpenRouterClient(testApiKey, testModel, '');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: testModel,
            choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          }),
        });

        await clientWithoutProvider.testConnection();

        const callArgs = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(callArgs[1].body);
        expect(requestBody.provider).toBeUndefined();
      });

      test('testConnection: プロバイダが未指定の場合、provider フィールドを含めない', async () => {
        const clientWithoutProvider = new OpenRouterClient(testApiKey, testModel);

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: testModel,
            choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          }),
        });

        await clientWithoutProvider.testConnection();

        const callArgs = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(callArgs[1].body);
        expect(requestBody.provider).toBeUndefined();
      });

      test('summarize: プロバイダが指定されている場合、リクエストボディに provider.order を含める', async () => {
        const clientWithProvider = new OpenRouterClient(testApiKey, testModel, 'Together');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: testModel,
            choices: [{ index: 0, message: { role: 'assistant', content: 'Summary' }, finish_reason: 'stop' }],
          }),
        });

        await clientWithProvider.summarize('test content', 100);

        const callArgs = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(callArgs[1].body);
        expect(requestBody.provider).toEqual({ order: ['Together'] });
      });

      test('summarize: プロバイダが空の場合、provider フィールドを含めない', async () => {
        const clientWithEmptyProvider = new OpenRouterClient(testApiKey, testModel, '');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: testModel,
            choices: [{ index: 0, message: { role: 'assistant', content: 'Summary' }, finish_reason: 'stop' }],
          }),
        });

        await clientWithEmptyProvider.summarize('test content', 100);

        const callArgs = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(callArgs[1].body);
        expect(requestBody.provider).toBeUndefined();
      });

      test('translate: プロバイダが指定されている場合、リクエストボディに provider.order を含める', async () => {
        const clientWithProvider = new OpenRouterClient(testApiKey, testModel, 'OpenAI');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: testModel,
            choices: [{ index: 0, message: { role: 'assistant', content: '翻訳' }, finish_reason: 'stop' }],
          }),
        });

        await clientWithProvider.translate('test content', 'ja', 400);

        const callArgs = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(callArgs[1].body);
        expect(requestBody.provider).toEqual({ order: ['OpenAI'] });
      });

      test('translate: プロバイダが空の場合、provider フィールドを含めない', async () => {
        const clientWithEmptyProvider = new OpenRouterClient(testApiKey, testModel, '');

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'test-id',
            object: 'chat.completion',
            created: Date.now(),
            model: testModel,
            choices: [{ index: 0, message: { role: 'assistant', content: '翻訳' }, finish_reason: 'stop' }],
          }),
        });

        await clientWithEmptyProvider.translate('test content', 'ja', 400);

        const callArgs = mockFetch.mock.calls[0];
        const requestBody = JSON.parse(callArgs[1].body);
        expect(requestBody.provider).toBeUndefined();
      });
    });
  });
});
