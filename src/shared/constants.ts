export const QUEUE_PERSIST_DEBOUNCE_MS = 50;

// 総コンテンツ文字数の上限（約120KB）。超過分は古いタブから削除する。
export const QUEUE_CONTENT_CHAR_BUDGET = 90_000;

// タブコンテンツの保持優先度: 現在読み上げ中のタブのコンテンツは必ず維持する。
export const QUEUE_CONTENT_RESERVE_ACTIVE = true;
