/**
 * 基底APIクライアント
 *
 * 各種AIサービス（OpenRouter, Google Gemini等）との通信で共通利用する
 * HTTPリクエスト処理とエラーハンドリングを提供
 */
import { API_ERROR_MESSAGES } from '../constants';

/**
 * APIリクエストのオプション
 */
export interface ApiRequestOptions {
  /** リクエストメソッド */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** リクエストヘッダー */
  headers: Record<string, string>;
  /** リクエストボディ（オプション） */
  body?: string;
}

/**
 * 基底APIクライアント抽象クラス
 * 各種AIサービスクライアントはこのクラスを継承して実装する
 */
export abstract class BaseApiClient {
  /**
   * APIエンドポイントを取得（サブクラスで実装）
   * @protected
   */
  protected abstract getEndpoint(): string;

  /**
   * デフォルトヘッダーを取得（サブクラスでオーバーライド可能）
   * @protected
   */
  protected getDefaultHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  /**
   * HTTPリクエストを送信
   * @param endpoint - APIエンドポイント（フルURLまたは相対パス）
   * @param options - リクエストオプション
   * @returns レスポンスのJSONデータ
   * @throws エラーが発生した場合
   * @protected
   */
  protected async makeRequest<T>(
    endpoint: string,
    options: Partial<ApiRequestOptions> = {}
  ): Promise<T> {
    try {
      const url = endpoint.startsWith('http') ? endpoint : this.getEndpoint();
      const headers = {
        ...this.getDefaultHeaders(),
        ...(options.headers || {}),
      };

      const response = await fetch(url, {
        method: options.method || 'POST',
        headers,
        body: options.body,
      });

      if (!response.ok) {
        throw new Error(this.getErrorMessage(response.status));
      }

      const data = await response.json() as T;
      return data;
    } catch (error) {
      if (error instanceof Error && this.isApiError(error)) {
        throw error;
      }
      if (error instanceof TypeError) {
        throw new Error(API_ERROR_MESSAGES.NETWORK_ERROR);
      }
      throw new Error(API_ERROR_MESSAGES.NETWORK_ERROR);
    }
  }

  /**
   * HTTPステータスコードからエラーメッセージを取得
   * サブクラスでオーバーライド可能
   * @param status - HTTPステータスコード
   * @returns エラーメッセージ
   * @protected
   */
  protected getErrorMessage(status: number): string {
    switch (status) {
      case 401:
        return API_ERROR_MESSAGES.UNAUTHORIZED;
      case 429:
        return API_ERROR_MESSAGES.RATE_LIMIT;
      case 500:
      case 502:
      case 503:
      case 504:
        return API_ERROR_MESSAGES.SERVER_ERROR;
      default:
        return API_ERROR_MESSAGES.SERVER_ERROR;
    }
  }

  /**
   * エラーがAPI関連のエラーかどうかを判定
   * @param error - エラーオブジェクト
   * @returns API関連のエラーの場合true
   * @private
   */
  private isApiError(error: Error): boolean {
    const apiErrorMessages = Object.values(API_ERROR_MESSAGES);
    return apiErrorMessages.some(msg => error.message.includes(msg));
  }
}
