/**
 * OpenRouter API クライアント
 *
 * OpenRouter APIとの通信を管理するクラス
 * 接続テスト、テキスト要約機能を提供
 */
import type { OpenRouterRequest, OpenRouterResponse } from '../types/ai';
import type { ConnectionTestResult } from '../types/api';
import { API_ERROR_MESSAGES } from '../constants';
import { BaseApiClient } from './baseApiClient';

/**
 * OpenRouter APIエンドポイント
 */
const OPENROUTER_API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenRouter API クライアント
 */
export class OpenRouterClient extends BaseApiClient {
  private readonly apiKey: string;
  private readonly model: string;

  /**
   * コンストラクタ
   * @param apiKey - OpenRouter APIキー
   * @param model - 使用するモデル名
   */
  constructor(apiKey: string, model: string) {
    super();
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * APIエンドポイントを取得
   * @protected
   */
  protected getEndpoint(): string {
    return OPENROUTER_API_ENDPOINT;
  }

  /**
   * デフォルトヘッダーを取得
   * @protected
   */
  protected getDefaultHeaders(): Record<string, string> {
    return {
      ...super.getDefaultHeaders(),
      'Authorization': `Bearer ${this.apiKey}`,
      'HTTP-Referer': 'https://github.com/takets/read-aloud-tab',
      'X-Title': 'Read Aloud Tab',
    };
  }

  /**
   * 接続テストを実行
   * 最小限のリクエストでAPIキーの有効性と疎通を確認
   * @returns 接続テスト結果
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const request: OpenRouterRequest = {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: 'Test',
          },
        ],
        max_tokens: 5,
      };

      const response = await this.makeRequest<OpenRouterResponse>(
        this.getEndpoint(),
        {
          method: 'POST',
          headers: this.getDefaultHeaders(),
          body: JSON.stringify(request),
        }
      );

      if (response.choices && response.choices.length > 0) {
        return {
          success: true,
          message: '接続に成功しました',
        };
      }

      return {
        success: false,
        error: API_ERROR_MESSAGES.INVALID_RESPONSE,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : API_ERROR_MESSAGES.NETWORK_ERROR,
      };
    }
  }

  /**
   * テキストを要約
   * @param content - 要約対象のコンテンツ
   * @param maxTokens - 要約の最大トークン数
   * @returns 要約されたテキスト
   * @throws エラーが発生した場合
   */
  async summarize(content: string, maxTokens: number): Promise<string> {
    const request: OpenRouterRequest = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'Summarize the following content concisely.',
        },
        {
          role: 'user',
          content: content,
        },
      ],
      max_tokens: maxTokens,
    };

    const response = await this.makeRequest<OpenRouterResponse>(
      this.getEndpoint(),
      {
        method: 'POST',
        headers: this.getDefaultHeaders(),
        body: JSON.stringify(request),
      }
    );

    if (!response.choices || response.choices.length === 0) {
      throw new Error(API_ERROR_MESSAGES.INVALID_RESPONSE);
    }

    return response.choices[0].message.content;
  }
}
