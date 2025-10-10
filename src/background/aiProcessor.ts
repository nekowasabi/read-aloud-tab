/**
 * AI処理統合管理サービス
 *
 * OpenRouterClientを使用したAI要約・翻訳処理を統合管理
 */
import { OpenRouterClient } from '../shared/services/openrouter';
import type { AiSettings, TabInfo } from '../shared/types';

/**
 * AiProcessorのオプション設定
 */
export interface AiProcessorOptions {
  /** 要約の最大トークン数 */
  maxSummaryTokens?: number;
  /** 翻訳の最大トークン数 */
  maxTranslationTokens?: number;
  /** API呼び出しのタイムアウト（ミリ秒） */
  timeoutMs?: number;
  /** コンテンツの最大文字数（トリミング用） */
  maxContentLength?: number;
}

/**
 * AI処理統合管理クラス
 */
export class AiProcessor {
  private client: OpenRouterClient | null = null;
  private readonly options: Required<AiProcessorOptions>;

  /**
   * コンストラクタ
   * @param options - オプション設定
   */
  constructor(options: AiProcessorOptions = {}) {
    this.options = {
      maxSummaryTokens: options.maxSummaryTokens ?? 500,
      maxTranslationTokens: options.maxTranslationTokens ?? 2000,
      timeoutMs: options.timeoutMs ?? 30000, // デフォルト30秒
      maxContentLength: options.maxContentLength ?? 5000, // デフォルト5000文字
    };
  }

  /**
   * AI設定を更新
   * APIキーとモデルが存在する場合、OpenRouterClientを初期化
   * @param settings - AI設定
   */
  updateSettings(settings: AiSettings): void {
    if (settings.openRouterApiKey && settings.openRouterModel) {
      this.client = new OpenRouterClient(settings.openRouterApiKey, settings.openRouterModel);
    } else {
      this.client = null;
    }
  }

  /**
   * AI処理が有効かどうかを判定
   * @param settings - AI設定
   * @returns AI処理が有効な場合true
   */
  isEnabled(settings: AiSettings): boolean {
    return (
      this.client !== null &&
      (settings.enableAiSummary || settings.enableAiTranslation)
    );
  }

  /**
   * タブコンテンツにAI処理を適用
   * @param tab - タブ情報
   * @param settings - AI設定
   * @returns 処理済みコンテンツ、または処理不要の場合は元のコンテンツ、エラー時はnull
   */
  async processContent(tab: TabInfo, settings: AiSettings): Promise<string | null> {
    // AI処理が不要な場合、元のcontentを返す
    if (!this.isEnabled(settings)) {
      return tab.content || null;
    }

    // clientが未初期化の場合、警告ログを出力して元のcontentを返す
    if (!this.client) {
      console.warn('[AiProcessor] Client not initialized, returning original content');
      return tab.content || null;
    }

    // contentが空の場合、nullを返す
    if (!tab.content) {
      return null;
    }

    try {
      // 長文コンテンツの事前トリミング（5000文字制限）
      let processedContent = this.trimContent(tab.content);

      // 要約処理（タイムアウト付き、カスタムプロンプト対応）
      if (settings.enableAiSummary) {
        processedContent = await this.withTimeout(
          this.client.summarize(
            processedContent,
            this.options.maxSummaryTokens,
            settings.customSummaryPrompt
          ),
          this.options.timeoutMs
        );
      }

      // 翻訳処理（タイムアウト付き、カスタムプロンプト対応）
      if (settings.enableAiTranslation) {
        processedContent = await this.withTimeout(
          this.client.translate(
            processedContent,
            this.options.maxTranslationTokens,
            settings.customTranslationPrompt
          ),
          this.options.timeoutMs
        );
      }

      return processedContent;
    } catch (error) {
      // エラー時は元のcontentを返す（フォールバック）
      console.error('[AiProcessor] Error processing content:', error);
      return tab.content || null;
    }
  }

  /**
   * コンテンツをトリミング
   * 最大文字数を超える場合は切り詰める
   * @param content - トリミング対象のコンテンツ
   * @returns トリミング後のコンテンツ
   * @private
   */
  private trimContent(content: string): string {
    if (content.length <= this.options.maxContentLength) {
      return content;
    }
    return content.substring(0, this.options.maxContentLength);
  }

  /**
   * Promiseにタイムアウトを適用
   * @param promise - 実行するPromise
   * @param timeoutMs - タイムアウト時間（ミリ秒）
   * @returns Promiseの結果
   * @throws タイムアウト時にエラーをスロー
   * @private
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }
}
