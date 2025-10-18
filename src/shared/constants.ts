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

/**
 * === TTS（Text-To-Speech）エンジン設定の定数定義 ===
 * process100 sub1: ブラウザ別設定の共通化
 */

/**
 * === VoiceInitialization Constants (process1) ===
 * 音声リスト取得に関する定数
 */

/** 音声リスト取得のタイムアウト（ミリ秒） */
export const VOICES_TIMEOUT_MS = 10000; // 3秒→10秒に延長

/** 音声リスト取得のリトライ最大回数 */
export const MAX_VOICE_RETRIES = 3;

/** 音声リスト取得のリトライ遅延（exponential backoff） */
export const VOICE_RETRY_DELAYS = [500, 1000, 2000]; // ms

/**
 * === ChunkSize Optimization Constants (process2) ===
 * テキストチャンク化に関する定数（Web Speech APIの約15秒タイムアウト制限対応）
 */

/** 安全な読み上げ時間（秒） - 15秒タイムアウトに対する保守的なマージン */
export const SAFE_READING_TIME_SEC = 8;

/**
 * Conservative reading speed for Chrome (characters per second)
 * Chrome向けの保守的な読み上げ速度
 */
export const CHARS_PER_SECOND_CONSERVATIVE = 4;

/**
 * More relaxed reading speed for Firefox (characters per second)
 * Firefox向けのより緩い読み上げ速度（persistent script利用のため）
 */
export const CHARS_PER_SECOND_FIREFOX = 3;

/** 通常速度でのチャンクサイズの最小値 */
export const MIN_CHUNK_SIZE_GENERAL = 40;

/**
 * 注意: 以前は MIN_CHUNK_SIZE_HIGH_SPEED = 150 を設定していましたが、
 * これは Web Speech API の 15秒タイムアウト制限を超える可能性があるため削除しました。
 *
 * 例: Firefox 2.5倍速の場合
 * - 150文字 ÷ (3文字/秒 × 2.5) = 20秒 → 15秒制限を超過
 *
 * チャンクサイズは計算式 (SAFE_READING_TIME_SEC × charsPerSecond × rate) のみに
 * 依存することで、常に15秒以内に収まるようにします。
 */

/** チャンク数が警告ラインを超える閾値 */
export const CHUNK_COUNT_WARNING_THRESHOLD = 50;

/**
 * === Error Handling Constants (process3) ===
 * エラーハンドリングに関する定数
 */

/** チャンク遷移のリトライ最大回数 */
export const MAX_CHUNK_RETRIES = 5; // 2→5に増加

/** チャンク遷移のリトライ待機時間（ミリ秒） */
export const CHUNK_RETRY_WAIT_MS = 100;

/** チャンク間ギャップの警告閾値（ミリ秒） */
export const CHUNK_GAP_WARNING_THRESHOLD_MS = 20000; // 20秒以上のギャップで警告

/**
 * ブラウザ別のTTS設定オプション
 */
export const TTS_CONFIG = {
  chrome: {
    charsPerSecond: CHARS_PER_SECOND_CONSERVATIVE,
    safeReadingTimeSec: SAFE_READING_TIME_SEC,
    minChunkSize: MIN_CHUNK_SIZE_GENERAL,
    maxRetries: MAX_CHUNK_RETRIES,
  },
  firefox: {
    charsPerSecond: CHARS_PER_SECOND_FIREFOX,
    safeReadingTimeSec: SAFE_READING_TIME_SEC,
    minChunkSize: MIN_CHUNK_SIZE_GENERAL,
    maxRetries: MAX_CHUNK_RETRIES,
  },
} as const;

/**
 * === Voice Selection Constants ===
 * 音声選択に関する定数（process5）
 */

/** デフォルトの優先性別 */
export const DEFAULT_PREFERRED_GENDER = 'female' as const;

/** デフォルトの優先言語 */
export const DEFAULT_PREFERRED_LANGUAGE = 'ja' as const;
