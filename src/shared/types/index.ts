export * from './tab';
export * from './tts';
export * from './queue';
export * from './helpers';
export * from './ai';
export * from './diagnostics';

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

export const STORAGE_KEYS = {
  TTS_SETTINGS: 'tts_settings',
  LAST_TAB_CONTENT: 'last_tab_content',
  READING_QUEUE: 'readingQueue',
  IGNORED_DOMAINS: 'ignoredDomains',
  SCHEMA_VERSION: 'schemaVersion',
  AI_SETTINGS: 'ai_settings',
  DEVELOPER_MODE: 'developerMode',
} as const;

import type { TabContent } from './tab';
import type { TTSSettings, TTSState } from './tts';
import type { TabInfo } from './tab';

export type MessageType =
  | { type: 'EXTRACT_TEXT'; tabId: number }
  | { type: 'TEXT_EXTRACTED'; content: TabContent }
  | { type: 'START_READING'; tabId: number; settings?: TTSSettings }
  | { type: 'PAUSE_READING' }
  | { type: 'RESUME_READING' }
  | { type: 'STOP_READING' }
  | { type: 'GET_STATUS' }
  | { type: 'STATUS_UPDATE'; state: TTSState };

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
      payload: { tabId: number };
    }
  | {
      type: 'QUEUE_REORDER';
      payload: { fromIndex: number; toIndex: number };
    }
  | {
      type: 'QUEUE_SKIP';
      payload: { direction: 'next' | 'previous' };
    };
