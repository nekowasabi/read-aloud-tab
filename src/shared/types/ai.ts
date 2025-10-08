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
