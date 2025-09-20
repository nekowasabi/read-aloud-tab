import { TTSEngine } from './ttsEngine';
import { StorageManager } from '../shared/utils/storage';
import { MessageType, TabContent, TTSState, TTSSettings } from '../shared/types';

class BackgroundService {
  private ttsEngine: TTSEngine;
  private currentState: TTSState = {
    isReading: false,
    isPaused: false,
    currentTabId: null,
    progress: 0,
  };
  private extractedContent: Map<number, TabContent> = new Map();
  private currentSettings: TTSSettings | null = null;

  constructor() {
    this.ttsEngine = new TTSEngine(this.handleStateChange.bind(this));
    this.init();
  }

  private async init(): Promise<void> {
    this.setupMessageListeners();
    this.setupInstallListener();

    // 設定を初期化
    try {
      this.currentSettings = await StorageManager.getSettings();
      console.log('Background service initialized with settings:', this.currentSettings);
    } catch (error) {
      console.error('Failed to load initial settings:', error);
    }
  }

  private setupMessageListeners(): void {
    chrome.runtime.onMessage.addListener((message: MessageType, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
          console.error('Background script error:', error);
          sendResponse({ error: error.message });
        });

      // 非同期レスポンスのためにtrueを返す
      return true;
    });
  }

  private setupInstallListener(): void {
    chrome.runtime.onInstalled.addListener((details) => {
      console.log('Extension installed:', details.reason);

      if (details.reason === 'install') {
        // 初回インストール時の処理
        this.initializeDefaultSettings();
      }
    });
  }

  private async initializeDefaultSettings(): Promise<void> {
    try {
      const defaultSettings = await StorageManager.getSettings();
      await StorageManager.saveSettings(defaultSettings);
      console.log('Default settings initialized');
    } catch (error) {
      console.error('Failed to initialize default settings:', error);
    }
  }

  private handleStateChange(state: TTSState): void {
    this.currentState = { ...state };

    // アクティブなポップアップに状態更新を送信
    this.broadcastStateUpdate(state);
  }

  private broadcastStateUpdate(state: TTSState): void {
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      state: state,
    }).catch(() => {
      // ポップアップが開いていない場合のエラーは無視
    });
  }

  private async handleMessage(message: MessageType, sender: chrome.runtime.MessageSender): Promise<any> {
    console.log('Received message:', message.type, message);

    switch (message.type) {
      case 'TEXT_EXTRACTED':
        return this.handleTextExtracted(message);

      case 'START_READING':
        return this.handleStartReading(message);

      case 'PAUSE_READING':
        return this.handlePauseReading();

      case 'RESUME_READING':
        return this.handleResumeReading();

      case 'STOP_READING':
        return this.handleStopReading();

      case 'GET_STATUS':
        return this.handleGetStatus();

      default:
        console.warn('Unknown message type:', message);
        return { success: false, error: 'Unknown message type' };
    }
  }

  private async handleTextExtracted(message: { content: TabContent }): Promise<any> {
    try {
      const { content } = message;
      this.extractedContent.set(content.tabId, content);
      console.log(`Text extracted for tab ${content.tabId}:`, content.text.substring(0, 100) + '...');
      return { success: true };
    } catch (error) {
      console.error('Failed to handle extracted text:', error);
      return { success: false, error: 'Failed to store extracted content' };
    }
  }

  private async handleStartReading(message: { tabId: number; settings?: TTSSettings }): Promise<any> {
    try {
      const { tabId, settings } = message;

      // 設定を更新（提供された場合）
      if (settings) {
        this.currentSettings = StorageManager.validateSettings(settings);
        await StorageManager.saveSettings(this.currentSettings);
      } else {
        this.currentSettings = await StorageManager.getSettings();
      }

      // 既に抽出されたコンテンツがあるかチェック
      let tabContent = this.extractedContent.get(tabId);

      if (!tabContent) {
        // コンテンツが未抽出の場合、Content Scriptに抽出を要求
        console.log(`Requesting text extraction for tab ${tabId}`);

        try {
          await chrome.tabs.sendMessage(tabId, {
            type: 'EXTRACT_TEXT',
            tabId: tabId,
          });

          // 少し待ってから再チェック
          await new Promise(resolve => setTimeout(resolve, 1000));
          tabContent = this.extractedContent.get(tabId);
        } catch (error) {
          console.error('Failed to extract text from tab:', error);
          return { success: false, error: 'Failed to extract text from page' };
        }
      }

      if (!tabContent) {
        return { success: false, error: 'No content available for reading' };
      }

      // TTS開始
      this.currentState.currentTabId = tabId;
      await this.ttsEngine.speak(tabContent.text, this.currentSettings);

      return { success: true, tabContent };

    } catch (error) {
      console.error('Failed to start reading:', error);
      return { success: false, error: 'Failed to start text-to-speech' };
    }
  }

  private async handlePauseReading(): Promise<any> {
    try {
      this.ttsEngine.pause();
      return { success: true };
    } catch (error) {
      console.error('Failed to pause reading:', error);
      return { success: false, error: 'Failed to pause reading' };
    }
  }

  private async handleResumeReading(): Promise<any> {
    try {
      this.ttsEngine.resume();
      return { success: true };
    } catch (error) {
      console.error('Failed to resume reading:', error);
      return { success: false, error: 'Failed to resume reading' };
    }
  }

  private async handleStopReading(): Promise<any> {
    try {
      this.ttsEngine.stop();
      this.currentState.currentTabId = null;
      return { success: true };
    } catch (error) {
      console.error('Failed to stop reading:', error);
      return { success: false, error: 'Failed to stop reading' };
    }
  }

  private async handleGetStatus(): Promise<TTSState> {
    // 最新の状態を取得してマージ
    const engineState = this.ttsEngine.getCurrentState();
    return {
      ...engineState,
      currentTabId: this.currentState.currentTabId,
    };
  }

  // デバッグ用メソッド
  getDebugInfo(): object {
    return {
      currentState: this.currentState,
      extractedContentCount: this.extractedContent.size,
      currentSettings: this.currentSettings,
      ttsDebugInfo: this.ttsEngine.getDebugInfo(),
    };
  }

  // 定期クリーンアップ（古い抽出コンテンツを削除）
  private cleanupOldContent(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30分

    for (const [tabId, content] of this.extractedContent.entries()) {
      if (now - content.extractedAt > maxAge) {
        this.extractedContent.delete(tabId);
        console.log(`Cleaned up old content for tab ${tabId}`);
      }
    }
  }
}

// Service Worker/Background Script の初期化
console.log('Initializing Read Aloud Tab background service...');
const backgroundService = new BackgroundService();

// 定期クリーンアップの設定（5分ごと）
setInterval(() => {
  (backgroundService as any).cleanupOldContent();
}, 5 * 60 * 1000);

// グローバルエラーハンドラー
self.addEventListener('error', (event) => {
  console.error('Background script error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});