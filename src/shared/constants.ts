export const QUEUE_PERSIST_DEBOUNCE_MS = 50;

// 総コンテンツ文字数の上限（約120KB）。超過分は古いタブから削除する。
export const QUEUE_CONTENT_CHAR_BUDGET = 90_000;

// タブコンテンツの保持優先度: 現在読み上げ中のタブのコンテンツは必ず維持する。
export const QUEUE_CONTENT_RESERVE_ACTIVE = true;

// API共通エラーメッセージ
export const API_ERROR_MESSAGES = {
  UNAUTHORIZED: 'APIキーが無効です',
  RATE_LIMIT: 'リクエスト制限に達しました。しばらく待ってから再試行してください',
  SERVER_ERROR: 'サーバーエラーが発生しました',
  NETWORK_ERROR: 'ネットワーク接続を確認してください',
  UNKNOWN_ERROR: 'リクエストに失敗しました',
} as const;

// OpenRouter API エラーメッセージ (API_ERROR_MESSAGESのエイリアス)
export const OPENROUTER_ERROR_MESSAGES = {
  INVALID_API_KEY: API_ERROR_MESSAGES.UNAUTHORIZED,
  RATE_LIMIT: API_ERROR_MESSAGES.RATE_LIMIT,
  SERVER_ERROR: API_ERROR_MESSAGES.SERVER_ERROR,
  NETWORK_ERROR: API_ERROR_MESSAGES.NETWORK_ERROR,
  UNKNOWN_ERROR: API_ERROR_MESSAGES.UNKNOWN_ERROR,
} as const;
