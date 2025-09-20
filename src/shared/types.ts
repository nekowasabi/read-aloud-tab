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
  voice: string;     // Voice name
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
} as const;