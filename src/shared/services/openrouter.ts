/**
 * OpenRouter API クライアント
 *
 * OpenRouter APIとの通信を管理するクラス
 * 接続テスト、テキスト要約機能を提供
 */
import type { ConnectionTestResult, OpenRouterRequest, OpenRouterResponse } from '../types/ai';

/**
 * OpenRouter APIエンドポイント
 */
const OPENROUTER_API_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * エラーメッセージ定数
 */
const ERROR_MESSAGES = {
  UNAUTHORIZED: 'APIキーが無効です',
  RATE_LIMIT: 'リクエスト制限に達しました。しばらく待ってから再試行してください',
  SERVER_ERROR: 'サーバーエラーが発生しました',
  NETWORK_ERROR: 'ネットワーク接続を確認してください',
  INVALID_RESPONSE: 'APIから無効なレスポンスが返されました',
} as const;

/**
 * OpenRouter API クライアント
 */
export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly model: string;

  /**
   * コンストラクタ
   * @param apiKey - OpenRouter APIキー
   * @param model - 使用するモデル名
   */
  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
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

      const response = await this._makeRequest(request);

      if (response.choices && response.choices.length > 0) {
        return {
          success: true,
          message: '接続に成功しました',
        };
      }

      return {
        success: false,
        error: ERROR_MESSAGES.INVALID_RESPONSE,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : ERROR_MESSAGES.NETWORK_ERROR,
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

    const response = await this._makeRequest(request);

    if (!response.choices || response.choices.length === 0) {
      throw new Error(ERROR_MESSAGES.INVALID_RESPONSE);
    }

    return response.choices[0].message.content;
  }

  /**
   * OpenRouter APIへリクエストを送信（内部メソッド）
   * @param request - リクエストボディ
   * @returns APIレスポンス
   * @throws エラーが発生した場合
   * @private
   */
  private async _makeRequest(request: OpenRouterRequest): Promise<OpenRouterResponse> {
    try {
      const response = await fetch(OPENROUTER_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/takets/read-aloud-tab',
          'X-Title': 'Read Aloud Tab',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(this._getErrorMessage(response.status));
      }

      const data = await response.json() as OpenRouterResponse;
      return data;
    } catch (error) {
      if (error instanceof Error && error.message.includes('APIキー')) {
        throw error;
      }
      if (error instanceof Error && error.message.includes('リクエスト制限')) {
        throw error;
      }
      if (error instanceof Error && error.message.includes('サーバーエラー')) {
        throw error;
      }
      if (error instanceof TypeError) {
        throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
      }
      throw new Error(ERROR_MESSAGES.NETWORK_ERROR);
    }
  }

  /**
   * HTTPステータスコードからエラーメッセージを取得
   * @param status - HTTPステータスコード
   * @returns エラーメッセージ
   * @private
   */
  private _getErrorMessage(status: number): string {
    switch (status) {
      case 401:
        return ERROR_MESSAGES.UNAUTHORIZED;
      case 429:
        return ERROR_MESSAGES.RATE_LIMIT;
      case 500:
      case 502:
      case 503:
      case 504:
        return ERROR_MESSAGES.SERVER_ERROR;
      default:
        return ERROR_MESSAGES.SERVER_ERROR;
    }
  }
}
