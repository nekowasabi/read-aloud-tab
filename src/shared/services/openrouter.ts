import type {
  ConnectionTestResult,
  OpenRouterRequest,
  OpenRouterResponse,
} from '../types/ai';
import { OPENROUTER_ERROR_MESSAGES } from '../constants';

/**
 * OpenRouter API クライアント
 * OpenRouter APIとの通信を管理するクラス
 * 接続テスト、テキスト要約機能を提供
 */
export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly provider?: string;
  private readonly endpoint = 'https://openrouter.ai/api/v1/chat/completions';

  /**
   * コンストラクタ
   * @param apiKey OpenRouter APIキー
   * @param model 使用するモデル名
   * @param provider プロバイダ名（オプション）
   */
  constructor(apiKey: string, model: string, provider?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.provider = provider;
  }

  /**
   * OpenRouter APIへの接続をテストする
   * @returns 接続テストの結果
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const request: OpenRouterRequest = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: 'Say "OK" if you can read this.',
          },
        ],
        max_tokens: 10,
        ...(this.provider ? { provider: { order: [this.provider] } } : {}),
      };

      const response = await this._makeRequest(request);

      if (response.ok) {
        return {
          success: true,
          message: '接続に成功しました',
        };
      }

      return this._handleErrorResponse(response);
    } catch (error) {
      return {
        success: false,
        error: `${OPENROUTER_ERROR_MESSAGES.NETWORK_ERROR}: ${error instanceof Error ? error.message : '不明なエラー'}`,
      };
    }
  }

  /**
   * テキストを要約する
   * @param content 要約するテキスト
   * @param maxTokens 最大トークン数
   * @returns 要約されたテキスト
   */
  async summarize(content: string, maxTokens: number, systemPrompt?: string): Promise<string> {
    try {
      const request: OpenRouterRequest = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: (systemPrompt && systemPrompt.trim().length > 0)
              ? systemPrompt.trim()
              : 'Summarize the following content concisely.',
          },
          {
            role: 'user',
            content,
          },
        ],
        max_tokens: maxTokens,
        ...(this.provider ? { provider: { order: [this.provider] } } : {}),
      };

      const response = await this._makeRequest(request);

      if (!response.ok) {
        const errorResult = this._handleErrorResponse(response);
        throw new Error(errorResult.error || 'リクエストに失敗しました');
      }

      const data: OpenRouterResponse = await response.json();
      return data.choices[0]?.message?.content || '';
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('要約リクエストに失敗しました');
    }
  }

  /**
   * テキストを指定した言語に翻訳する
   * @param content 翻訳するテキスト
   * @param targetLanguage 翻訳先言語（例: 'ja', 'en-US'）
   * @param maxTokens 最大トークン数
   * @returns 翻訳されたテキスト
   */
  async translate(content: string, targetLanguage: string, maxTokens: number, systemPrompt?: string): Promise<string> {
    try {
      const request: OpenRouterRequest = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: (() => {
              const fallback = `Translate the following content into ${targetLanguage}. Preserve meaning and important nuances. Respond using only the translated text.`;
              if (!systemPrompt || systemPrompt.trim().length === 0) {
                return fallback;
              }
              return systemPrompt.replace(/\{\{\s*targetLanguage\s*\}\}/gi, targetLanguage).trim() || fallback;
            })(),
          },
          {
            role: 'user',
            content,
          },
        ],
        max_tokens: maxTokens,
        ...(this.provider ? { provider: { order: [this.provider] } } : {}),
      };

      const response = await this._makeRequest(request);

      if (!response.ok) {
        const errorResult = this._handleErrorResponse(response);
        throw new Error(errorResult.error || '翻訳リクエストに失敗しました');
      }

      const data: OpenRouterResponse = await response.json();
      return data.choices[0]?.message?.content || '';
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('翻訳リクエストに失敗しました');
    }
  }

  /**
   * OpenRouter APIへリクエストを送信する（プライベートメソッド）
   * @param request リクエストボディ
   * @returns レスポンス
   */
  private async _makeRequest(request: OpenRouterRequest): Promise<Response> {
    return fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  }

  /**
   * エラーレスポンスをハンドリングする
   * @param response レスポンス
   * @returns エラー結果
   */
  private _handleErrorResponse(response: Response): ConnectionTestResult {
    const { status } = response;

    switch (status) {
      case 401:
        return {
          success: false,
          error: OPENROUTER_ERROR_MESSAGES.INVALID_API_KEY,
        };
      case 429:
        return {
          success: false,
          error: OPENROUTER_ERROR_MESSAGES.RATE_LIMIT,
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          success: false,
          error: OPENROUTER_ERROR_MESSAGES.SERVER_ERROR,
        };
      default:
        return {
          success: false,
          error: `${OPENROUTER_ERROR_MESSAGES.UNKNOWN_ERROR} (ステータスコード: ${status})`,
        };
    }
  }
}
