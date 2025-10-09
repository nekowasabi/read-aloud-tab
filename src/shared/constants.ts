export const QUEUE_PERSIST_DEBOUNCE_MS = 50;

// 総コンテンツ文字数の上限（約120KB）。超過分は古いタブから削除する。
export const QUEUE_CONTENT_CHAR_BUDGET = 90_000;

// タブコンテンツの保持優先度: 現在読み上げ中のタブのコンテンツは必ず維持する。
export const QUEUE_CONTENT_RESERVE_ACTIVE = true;

/**
 * API関連のエラーメッセージ定数
 */
export const API_ERROR_MESSAGES = {
  /** 認証エラー（401） */
  UNAUTHORIZED: 'APIキーが無効です',
  /** レート制限エラー（429） */
  RATE_LIMIT: 'リクエスト制限に達しました。しばらく待ってから再試行してください',
  /** サーバーエラー（500系） */
  SERVER_ERROR: 'サーバーエラーが発生しました',
  /** ネットワークエラー */
  NETWORK_ERROR: 'ネットワーク接続を確認してください',
  /** 無効なレスポンス */
  INVALID_RESPONSE: 'APIから無効なレスポンスが返されました',
} as const;
