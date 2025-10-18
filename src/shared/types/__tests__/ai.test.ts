import type { AiSettings, OpenRouterRequest } from '../ai';

describe('AI型定義のテスト', () => {
  describe('AiSettings インターフェース', () => {
    describe('process1-sub1: openRouterProvider フィールド', () => {
      test('openRouterProvider フィールドが存在する', () => {
        const settings: AiSettings = {
          openRouterApiKey: 'test-key',
          openRouterModel: 'test-model',
          enableAiSummary: false,
          enableAiTranslation: false,
          summaryPrompt: 'test-summary',
          translationPrompt: 'test-translation',
          openRouterProvider: 'DeepInfra',
        };

        expect(settings.openRouterProvider).toBe('DeepInfra');
      });

      test('openRouterProvider は省略可能（オプショナル）である', () => {
        const settings: AiSettings = {
          openRouterApiKey: 'test-key',
          openRouterModel: 'test-model',
          enableAiSummary: false,
          enableAiTranslation: false,
          summaryPrompt: 'test-summary',
          translationPrompt: 'test-translation',
        };

        expect(settings.openRouterProvider).toBeUndefined();
      });

      test('openRouterProvider に空文字列を設定できる', () => {
        const settings: AiSettings = {
          openRouterApiKey: 'test-key',
          openRouterModel: 'test-model',
          enableAiSummary: false,
          enableAiTranslation: false,
          summaryPrompt: 'test-summary',
          translationPrompt: 'test-translation',
          openRouterProvider: '',
        };

        expect(settings.openRouterProvider).toBe('');
      });
    });
  });

  describe('OpenRouterRequest インターフェース', () => {
    describe('process1-sub2: provider フィールド', () => {
      test('provider フィールドが存在し、order配列を含む', () => {
        const request: OpenRouterRequest = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
          provider: {
            order: ['DeepInfra', 'Together'],
          },
        };

        expect(request.provider).toBeDefined();
        expect(request.provider?.order).toEqual(['DeepInfra', 'Together']);
      });

      test('provider は省略可能（オプショナル）である', () => {
        const request: OpenRouterRequest = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
        };

        expect(request.provider).toBeUndefined();
      });

      test('provider.order は文字列配列である', () => {
        const request: OpenRouterRequest = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
          provider: {
            order: ['OpenAI', 'Fireworks'],
          },
        };

        expect(Array.isArray(request.provider?.order)).toBe(true);
        expect(request.provider?.order?.length).toBe(2);
        expect(typeof request.provider?.order?.[0]).toBe('string');
      });

      test('provider.order に単一のプロバイダを指定できる', () => {
        const request: OpenRouterRequest = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'test' }],
          provider: {
            order: ['DeepInfra'],
          },
        };

        expect(request.provider?.order).toEqual(['DeepInfra']);
      });
    });
  });
});
