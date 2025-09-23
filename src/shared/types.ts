export interface TabContent {
  tabId: number;
  url: string;
  title: string;
  text: string;
  extractedAt: number;
}

export interface TTSSettings {
  rate: number;      // 0.5 - 2.0
  pitch: number;     // 0 - 2
  volume: number;    // 0 - 1
  voice: string | null;     // Voice name
}

export interface TTSState {
  isReading: boolean;
  isPaused: boolean;
  currentTabId: number | null;
  progress: number;  // 0-100
}

// メッセージング用の型
export type MessageType =
  | { type: 'EXTRACT_TEXT'; tabId: number }
  | { type: 'TEXT_EXTRACTED'; content: TabContent }
  | { type: 'START_READING'; tabId: number; settings?: TTSSettings }
  | { type: 'PAUSE_READING' }
  | { type: 'RESUME_READING' }
  | { type: 'STOP_READING' }
  | { type: 'GET_STATUS' }
  | { type: 'STATUS_UPDATE'; state: TTSState };

// ブラウザAPI抽象化用の型
export interface BrowserAPI {
  tabs: {
    query: (queryInfo: any) => Promise<any[]>;
    sendMessage: (tabId: number, message: any) => Promise<any>;
  };
  storage: {
    sync: {
      get: (keys?: string | string[] | null) => Promise<any>;
      set: (items: any) => Promise<void>;
    };
  };
  runtime: {
    sendMessage: (message: any) => Promise<any>;
    onMessage: {
      addListener: (callback: (message: any, sender: any, sendResponse: any) => void) => void;
      removeListener: (callback: (message: any, sender: any, sendResponse: any) => void) => void;
    };
  };
}

// Queue management types for Phase 2

/**
 * Status of the reading queue
 * - idle: No active reading
 * - reading: Currently reading a tab
 * - paused: Reading paused by user
 * - error: Error occurred during reading
 */
export type QueueStatus = 'idle' | 'reading' | 'paused' | 'error';

/**
 * Information about a tab in the reading queue
 */
export interface TabInfo {
  /** Unique browser tab ID */
  tabId: number;
  /** Full URL of the tab */
  url: string;
  /** Title of the tab/page */
  title: string;
  /** Extracted text content (optional) */
  content?: string;
  /** AI-generated summary (optional) */
  summary?: string;
  /** Whether this tab is in the ignored domains list */
  isIgnored: boolean;
  /** When the content was extracted */
  extractedAt: Date;
}

/**
 * The reading queue containing tabs to be read aloud
 */
export interface ReadingQueue {
  /** Array of tabs in the queue */
  tabs: TabInfo[];
  /** Index of currently reading tab */
  currentIndex: number;
  /** Current status of the queue */
  status: QueueStatus;
  /** TTS settings to use for reading */
  settings: TTSSettings;
}

/**
 * Message types for queue operations between components
 */
export type QueueMessage =
  | {
      type: 'QUEUE_ADD';
      payload: {
        tabInfo: TabInfo;
        position: 'start' | 'end' | number;
      };
    }
  | {
      type: 'QUEUE_REMOVE';
      payload: {
        tabId: number;
      };
    }
  | {
      type: 'QUEUE_REORDER';
      payload: {
        fromIndex: number;
        toIndex: number;
      };
    }
  | {
      type: 'QUEUE_SKIP';
      payload: {
        direction: 'next' | 'previous';
      };
    };

// エラーハンドリング用の型
export interface ExtensionError {
  code: string;
  message: string;
  details?: any;
}

// 設定保存用のキー
export const STORAGE_KEYS = {
  TTS_SETTINGS: 'tts_settings',
  LAST_TAB_CONTENT: 'last_tab_content',
  READING_QUEUE: 'readingQueue',
  IGNORED_DOMAINS: 'ignoredDomains',
  SCHEMA_VERSION: 'schemaVersion',
} as const;