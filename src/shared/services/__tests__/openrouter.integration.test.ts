/**
 * OpenRouterClient の統合テスト（実API疎通）
 *
 * 環境変数 OPENROUTER_API_KEY が設定されている場合のみ実行されます。
 * 設定されていない場合はテストがスキップされます。
 *
 * 実行方法:
 *   OPENROUTER_API_KEY=your-api-key npm run test openrouter.integration.test.ts
 *
 * プロバイダを指定する場合:
 *   OPENROUTER_API_KEY=your-api-key OPENROUTER_PROVIDER=DeepInfra npm run test openrouter.integration.test.ts
 *
 * 注意: このテストはNode.js環境でfetchが利用可能な場合のみ実行されます。
 */
import { OpenRouterClient } from '../openrouter';

const API_KEY = process.env.OPENROUTER_API_KEY;
const TEST_MODEL = 'meta-llama/llama-3.2-1b-instruct';
const TEST_PROVIDER = process.env.OPENROUTER_PROVIDER || 'DeepInfra';
const INVALID_API_KEY = 'sk-or-invalid-key-12345';

// テスト用の定数
const TEST_CONTENT = {
  SHORT_ENGLISH: 'The quick brown fox jumps over the lazy dog. This is a simple test sentence.',
  JAPANESE: '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。',
  SIMPLE: 'Test content',
};

// 環境変数が設定されている場合のみテストを実行
// 注: 実際のテストはブラウザ拡張機能としてfetchが利用可能な環境で手動確認を推奨
const describeIfApiKey = API_KEY ? describe : describe.skip;

/**
 * 要約結果が有効な文字列であることを検証するヘルパー
 */
function expectValidSummary(summary: string): void {
  expect(typeof summary).toBe('string');
  expect(summary.length).toBeGreaterThan(0);
}

describeIfApiKey('OpenRouterClient Integration Tests', () => {
  // タイムアウトを長めに設定（実APIへの通信があるため）
  jest.setTimeout(15000);

  describe('testConnection - 実API疎通', () => {
    test('有効なAPIキーで接続テストが成功する', async () => {
      const client = new OpenRouterClient(API_KEY!, TEST_MODEL);
      const result = await client.testConnection();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.message).toBeDefined();
    });

    test('無効なAPIキーで接続テストが失敗する', async () => {
      const client = new OpenRouterClient(INVALID_API_KEY, TEST_MODEL);
      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('APIキーが無効です');
    });
  });

  describe('summarize - 実API疎通', () => {
    test('短いテキストを要約できる', async () => {
      const client = new OpenRouterClient(API_KEY!, TEST_MODEL);

      const summary = await client.summarize(TEST_CONTENT.SHORT_ENGLISH, 50);

      expectValidSummary(summary);
    });

    test('日本語テキストを要約できる', async () => {
      const client = new OpenRouterClient(API_KEY!, TEST_MODEL);

      const summary = await client.summarize(TEST_CONTENT.JAPANESE, 100);

      expectValidSummary(summary);
    });

    test('無効なAPIキーで要約リクエストが失敗する', async () => {
      const client = new OpenRouterClient(INVALID_API_KEY, TEST_MODEL);

      await expect(client.summarize(TEST_CONTENT.SIMPLE, 50)).rejects.toThrow('APIキーが無効です');
    });
  });

  describe('プロバイダ指定での動作確認', () => {
    test('プロバイダ指定で接続テストが成功する', async () => {
      const client = new OpenRouterClient(API_KEY!, TEST_MODEL, TEST_PROVIDER);
      const result = await client.testConnection();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.message).toBeDefined();
    });

    test('プロバイダ指定で要約リクエストが成功する', async () => {
      const client = new OpenRouterClient(API_KEY!, TEST_MODEL, TEST_PROVIDER);

      const summary = await client.summarize(TEST_CONTENT.SHORT_ENGLISH, 50);

      expectValidSummary(summary);
    });

    test('空文字列のプロバイダは無視される（プロバイダなしと同じ動作）', async () => {
      const clientWithProvider = new OpenRouterClient(API_KEY!, TEST_MODEL, '');
      const clientWithoutProvider = new OpenRouterClient(API_KEY!, TEST_MODEL);

      const summaryWithProvider = await clientWithProvider.summarize(TEST_CONTENT.SIMPLE, 50);
      const summaryWithoutProvider = await clientWithoutProvider.summarize(TEST_CONTENT.SIMPLE, 50);

      // 両方とも正常に実行される
      expectValidSummary(summaryWithProvider);
      expectValidSummary(summaryWithoutProvider);
    });

    test('プロバイダなしでも引き続き正常に動作する', async () => {
      const client = new OpenRouterClient(API_KEY!, TEST_MODEL);

      const summary = await client.summarize(TEST_CONTENT.SHORT_ENGLISH, 50);

      expectValidSummary(summary);
    });
  });
});

// テストがスキップされた場合の説明
if (!API_KEY) {
  console.info(`
==============================================================================
統合テストをスキップしました。

OpenRouter API の実疎通テストは、実際のブラウザ拡張機能環境で
手動確認することを推奨します。

自動テストを実行する場合は、環境変数を設定してください：
  OPENROUTER_API_KEY=your-api-key npm run test openrouter.integration.test.ts

APIキーの取得方法:
  1. https://openrouter.ai/ でアカウント作成
  2. API Keys ページでキーを生成
  3. 環境変数に設定して再実行

注意: Node.js環境ではfetchが利用できない場合があります。
      その場合はブラウザ拡張機能として実際に動作確認してください。
==============================================================================
  `);
}
