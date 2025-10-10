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
  /** カスタム要約プロンプト（未設定時はデフォルトプロンプトを使用） */
  customSummaryPrompt?: string;
  /** カスタム翻訳プロンプト（未設定時はデフォルトプロンプトを使用） */
  customTranslationPrompt?: string;
}

/**
 * OpenRouter APIリクエストボディ
 */
export interface OpenRouterRequest {
  /** 使用するモデル名 */
  model: string;
  /** メッセージの配列 */
  messages: Array<OpenRouterMessage>;
  /** 最大トークン数（オプション） */
  max_tokens?: number;
  /** 温度パラメータ（オプション） */
  temperature?: number;
}

/**
 * OpenRouter APIメッセージ
 */
export interface OpenRouterMessage {
  /** メッセージの役割（system, user, assistant） */
  role: 'system' | 'user' | 'assistant';
  /** メッセージの内容 */
  content: string;
}

/**
 * OpenRouter APIレスポンスボディ
 */
export interface OpenRouterResponse {
  /** 生成されたレスポンスの配列 */
  choices: Array<OpenRouterChoice>;
  /** 使用したモデル名 */
  model: string;
  /** 使用トークン数の統計 */
  usage?: OpenRouterUsage;
}

/**
 * OpenRouter APIレスポンスのChoice
 */
export interface OpenRouterChoice {
  /** メッセージオブジェクト */
  message: OpenRouterMessage;
  /** 終了理由 */
  finish_reason: string;
}

/**
 * OpenRouter APIの使用トークン数統計
 */
export interface OpenRouterUsage {
  /** プロンプトのトークン数 */
  prompt_tokens: number;
  /** 生成されたコンテンツのトークン数 */
  completion_tokens: number;
  /** 合計トークン数 */
  total_tokens: number;
}
