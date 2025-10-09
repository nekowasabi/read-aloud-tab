/**
 * OpenRouterClient の統合テスト（実API疎通）
 *
 * 環境変数 OPENROUTER_API_KEY が設定されている場合のみ実行されます。
 * 設定されていない場合はテストがスキップされます。
 *
 * 実行方法:
 *   OPENROUTER_API_KEY=your-api-key npm run test openrouter.integration.test.ts
 *
 * 注意: このテストはNode.js環境でfetchが利用可能な場合のみ実行されます。
 */
import { OpenRouterClient } from '../openrouter';

const API_KEY = process.env.OPENROUTER_API_KEY;
const TEST_MODEL = 'meta-llama/llama-3.2-1b-instruct';

// 環境変数が設定されている場合のみテストを実行
// 注: 実際のテストはブラウザ拡張機能としてfetchが利用可能な環境で手動確認を推奨
const describeIfApiKey = API_KEY ? describe : describe.skip;

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
      const invalidApiKey = 'sk-or-invalid-key-12345';
      const client = new OpenRouterClient(invalidApiKey, TEST_MODEL);
      const result = await client.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('APIキーが無効です');
    });
  });

  describe('summarize - 実API疎通', () => {
    test('短いテキストを要約できる', async () => {
      const client = new OpenRouterClient(API_KEY!, TEST_MODEL);
      const testContent = 'The quick brown fox jumps over the lazy dog. This is a simple test sentence.';

      const summary = await client.summarize(testContent, 50);

      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
      expect(summary.length).toBeLessThanOrEqual(testContent.length);
    });

    test('日本語テキストを要約できる', async () => {
      const client = new OpenRouterClient(API_KEY!, TEST_MODEL);
      const testContent = '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。';

      const summary = await client.summarize(testContent, 100);

      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
    });

    test('無効なAPIキーで要約リクエストが失敗する', async () => {
      const invalidApiKey = 'sk-or-invalid-key-12345';
      const client = new OpenRouterClient(invalidApiKey, TEST_MODEL);
      const testContent = 'Test content';

      await expect(client.summarize(testContent, 50)).rejects.toThrow('APIキーが無効です');
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
