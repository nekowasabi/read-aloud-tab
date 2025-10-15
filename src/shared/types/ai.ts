/**
 * AI要約機能の設定
 */
export interface AiSettings {
  /** OpenRouter APIキー */
  openRouterApiKey: string;
  /** OpenRouterモデル名 */
  openRouterModel: string;
  /** AI要約機能の有効化フラグ */
  enableAiSummary: boolean;
  /** AI翻訳機能の有効化フラグ */
  enableAiTranslation: boolean;
  /** 要約用システムプロンプト */
  summaryPrompt: string;
  /** 翻訳用システムプロンプト */
  translationPrompt: string;
}

/**
 * OpenRouter API 接続テストの結果
 */
export interface ConnectionTestResult {
  /** 接続が成功したかどうか */
  success: boolean;
  /** 成功時のメッセージ（オプション） */
  message?: string;
  /** エラーメッセージ（失敗時） */
  error?: string;
}

/**
 * OpenRouter API リクエストボディ
 */
export interface OpenRouterRequest {
  /** 使用するモデル名 */
  model: string;
  /** メッセージの配列 */
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  /** 最大トークン数（オプション） */
  max_tokens?: number;
}

/**
 * OpenRouter API レスポンスボディ
 */
export interface OpenRouterResponse {
  /** レスポンスID */
  id: string;
  /** オブジェクトタイプ */
  object: string;
  /** 作成日時（Unixタイムスタンプ） */
  created: number;
  /** モデル名 */
  model: string;
  /** 生成された選択肢 */
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  /** トークン使用量 */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
