/**
 * API関連の共通型定義
 */

/**
 * API接続テストの結果
 */
export interface ConnectionTestResult {
  /** 接続成功フラグ */
  success: boolean;
  /** 成功時のメッセージ */
  message?: string;
  /** エラー時のメッセージ */
  error?: string;
}
