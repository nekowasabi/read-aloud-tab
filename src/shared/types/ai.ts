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
}

/**
 * OpenRouter API接続テストの結果
 */
export interface ConnectionTestResult {
  /** 接続成功フラグ */
  success: boolean;
  /** 成功時のメッセージ */
  message?: string;
  /** エラー時のメッセージ */
  error?: string;
}

/**
 * OpenRouter APIリクエストボディ
 */
export interface OpenRouterRequest {
  /** 使用するモデル名 */
  model: string;
  /** メッセージの配列 */
  messages: Array<{
    /** メッセージの役割（system, user, assistant） */
    role: 'system' | 'user' | 'assistant';
    /** メッセージの内容 */
    content: string;
  }>;
  /** 最大トークン数（オプション） */
  max_tokens?: number;
  /** 温度パラメータ（オプション） */
  temperature?: number;
}

/**
 * OpenRouter APIレスポンスボディ
 */
export interface OpenRouterResponse {
  /** 生成されたレスポンスの配列 */
  choices: Array<{
    /** メッセージオブジェクト */
    message: {
      /** メッセージの役割 */
      role: string;
      /** 生成されたコンテンツ */
      content: string;
    };
    /** 終了理由 */
    finish_reason: string;
  }>;
  /** 使用したモデル名 */
  model: string;
  /** 使用トークン数の統計 */
  usage?: {
    /** プロンプトのトークン数 */
    prompt_tokens: number;
    /** 生成されたコンテンツのトークン数 */
    completion_tokens: number;
    /** 合計トークン数 */
    total_tokens: number;
  };
}
