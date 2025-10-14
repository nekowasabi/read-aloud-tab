import { TabInfo, KeepAliveDiagnostics } from '../shared/types';
import {
  QueueCommandMessage,
  QueueBroadcastMessage,
  QueueStatusPayload,
  QueueProgressPayload,
  QueueErrorPayload,
  QueueAddPayload,
  isQueueCommandMessage,
  OffscreenCommandMessage,
  OffscreenBroadcastMessage,
  isOffscreenBroadcastMessage,
  PrefetchCommandMessage,
  PrefetchBroadcastMessage,
  PrefetchStatusSnapshot,
  isPrefetchCommandMessage,
  KeepAliveDiagnosticsMessage,
  isKeepAliveDiagnosticsMessage,
} from '../shared/messages';
import { AiPrefetcher } from './aiPrefetcher';
import { TabManager, LoggerLike } from './tabManager';
import { BrowserAdapter } from '../shared/utils/browser';

interface ChromeRuntimePort {
  name: string;
  postMessage: (message: QueueBroadcastMessage | PrefetchBroadcastMessage | Record<string, unknown>) => void;
  onMessage: { addListener: (listener: (message: QueueCommandMessage | unknown) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
}

interface ChromeRuntimeLike {
  onMessage: { addListener: (listener: RuntimeMessageListener) => void };
  onConnect: { addListener: (listener: (port: ChromeRuntimePort) => void) => void };
  sendMessage: (message: QueueBroadcastMessage | OffscreenCommandMessage) => Promise<unknown> | void;
  lastError?: chrome.runtime.LastError | null;
}

interface ChromeTabsLike {
  sendMessage: (tabId: number, message: any) => Promise<unknown> | void;
}

interface ChromeLike {
  runtime: ChromeRuntimeLike;
  tabs: ChromeTabsLike;
  commands?: {
    onCommand: {
      addListener: (listener: (command: string) => void) => void;
    };
  };
}

type RuntimeMessageListener = (
  message: QueueCommandMessage | unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void,
) => void;

interface BackgroundOrchestratorOptions {
  tabManager: TabManager;
  chrome?: ChromeLike;
  logger?: LoggerLike;
  prefetcher?: AiPrefetcher | null;
}

export class BackgroundOrchestrator {
  private readonly tabManager: TabManager;
  private readonly chrome: ChromeLike;
  private readonly logger: LoggerLike;
  private readonly prefetcher: AiPrefetcher | null;
  private initialized = false;

  private readonly ports = new Set<ChromeRuntimePort>();
  private unsubscribeFns: Array<() => void> = [];

  constructor(options: BackgroundOrchestratorOptions) {
    this.tabManager = options.tabManager;
    const browserAPI = BrowserAdapter.getInstance();
    this.chrome = options.chrome || (browserAPI as unknown as ChromeLike);
    this.logger = options.logger || console;
    this.prefetcher = options.prefetcher ?? null;

    if (!this.chrome?.runtime) {
      throw new Error('Chrome runtime APIs are not available');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.tabManager.initialize();
    await this.setupOffscreenDocument();
    this.registerTabManagerListeners();
    this.registerRuntimeListeners();
    this.registerCommandListeners();

    this.initialized = true;
  }

  /**
   * Setup Offscreen Document for Chrome Manifest V3
   * Offscreen Document provides persistent context for Web Speech API
   */
  private async setupOffscreenDocument(): Promise<void> {
    if (BrowserAdapter.getBrowserType() !== 'chrome' || !BrowserAdapter.isFeatureSupported('offscreen')) {
      this.logger.info('[BackgroundOrchestrator] Offscreen API not available, skipping setup');
      return;
    }

    try {
      const hasOffscreen = await BrowserAdapter.hasOffscreenDocument();
      if (hasOffscreen) {
        this.logger.info('[BackgroundOrchestrator] Offscreen document already exists');
        return;
      }

      await BrowserAdapter.createOffscreenDocument(
        'offscreen.html',
        ['AUDIO_PLAYBACK' as any],
        'Text-to-speech audio playback'
      );
      this.logger.info('[BackgroundOrchestrator] Offscreen document created successfully');
    } catch (error) {
      this.logger.error('[BackgroundOrchestrator] Failed to setup offscreen document', error);
      // Don't throw - allow initialization to continue without offscreen support
      this.logger.warn('[BackgroundOrchestrator] Continuing without offscreen document support');
    }
  }

  private registerTabManagerListeners(): void {
    this.unsubscribeFns.push(this.tabManager.addStatusListener((payload) => this.broadcastStatus(payload)));
    this.unsubscribeFns.push(this.tabManager.addProgressListener((payload) => this.broadcastProgress(payload)));
    this.unsubscribeFns.push(this.tabManager.addErrorListener((payload) => this.broadcastError(payload)));
    this.unsubscribeFns.push(this.tabManager.addCommandListener((event) => this.handleCommandEvent(event)));
  }

  private registerRuntimeListeners(): void {
    this.chrome.runtime.onMessage.addListener(this.handleRuntimeMessage);
    this.chrome.runtime.onConnect.addListener((port) => this.handleRuntimePort(port));
  }

  private registerCommandListeners(): void {
    if (!this.chrome.commands?.onCommand) {
      return;
    }

    this.chrome.commands.onCommand.addListener((command) => {
      this.handleShortcutCommand(command).catch((error) => {
        this.logger.error('BackgroundOrchestrator: shortcut command failed', error);
      });
    });
  }

  private handleRuntimeMessage: RuntimeMessageListener = (message, _sender, sendResponse) => {
    // Handle TEXT_EXTRACTED message
    if (message && typeof message === 'object' && 'type' in message) {
      if (message.type === 'TEXT_EXTRACTED') {
        this.handleTextExtracted(message as any)
          .then(() => sendResponse({ success: true }))
          .catch((error: Error) => {
            this.logger.error('BackgroundOrchestrator: text extraction handling failed', error);
            sendResponse({ success: false, error: error.message });
          });
        return true as unknown as void;
      }
    }

    // Handle Offscreen Document broadcast messages
    if (isOffscreenBroadcastMessage(message)) {
      this.handleOffscreenBroadcast(message)
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) => {
          this.logger.error('BackgroundOrchestrator: offscreen broadcast handling failed', error);
          sendResponse({ success: false, error: error.message });
        });
      return true as unknown as void;
    }

    if (isKeepAliveDiagnosticsMessage(message)) {
      const { payload } = message as KeepAliveDiagnosticsMessage;
      this.handleKeepAliveDiagnostics(payload);
      sendResponse({ success: true });
      return true as unknown as void;
    }

    if (isPrefetchCommandMessage(message)) {
      this.handlePrefetchCommand(message, sendResponse);
      return true as unknown as void;
    }

    if (!isQueueCommandMessage(message)) {
      return;
    }

    this.processCommand(message)
      .then((result) => sendResponse(result))
      .catch((error: Error) => {
        this.logger.error('BackgroundOrchestrator: command processing failed', error);
        sendResponse({ success: false, error: error.message });
      });

    return true as unknown as void;
  };

  private handleRuntimePort(port: ChromeRuntimePort): void {
    this.ports.add(port);

    const handlePortMessage = async (message: QueueCommandMessage | PrefetchCommandMessage | unknown) => {
      if (isPrefetchCommandMessage(message)) {
        this.handlePrefetchCommand(message, () => undefined);
        return;
      }

      if (!isQueueCommandMessage(message)) {
        return;
      }
      try {
        const result = await this.processCommand(message);
        port.postMessage({ type: 'QUEUE_COMMAND_RESULT', payload: { command: message.type, result } });
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Unknown command error');
        port.postMessage({
          type: 'QUEUE_COMMAND_RESULT',
          payload: { command: message.type, error: err.message },
        });
      }
    };

    port.onMessage.addListener(handlePortMessage as any);
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
    });

    // Send initial snapshot immediately
    const snapshot = this.tabManager.getSnapshot();
    port.postMessage({ type: 'QUEUE_STATUS_UPDATE', payload: snapshot });

    this.sendPrefetchSnapshotToPort(port);
  }

  private async processCommand(message: QueueCommandMessage): Promise<{ success: boolean; payload?: unknown }> {
    switch (message.type) {
      case 'QUEUE_ADD':
        await this.handleAddCommand(message.payload);
        return { success: true };
      case 'QUEUE_REMOVE':
        await this.tabManager.removeTab(message.payload.tabId);
        return { success: true };
      case 'QUEUE_REORDER':
        await this.tabManager.reorderTabs(message.payload.fromIndex, message.payload.toIndex);
        return { success: true };
      case 'QUEUE_SKIP':
        await this.tabManager.skipTab(message.payload.direction);
        return { success: true };
      case 'QUEUE_CONTROL':
        await this.handleControlCommand(message.payload.action);
        return { success: true };
      case 'QUEUE_UPDATE_SETTINGS':
        await this.handleUpdateSettings(message.payload.settings);
        return { success: true };
      case 'REQUEST_QUEUE_STATE':
        return { success: true, payload: this.tabManager.getSnapshot() };
      default:
        return { success: false, error: 'Unknown command' } as any;
    }
  }

  private handlePrefetchCommand(message: PrefetchCommandMessage, sendResponse: (response: unknown) => void): void {
    if (!this.prefetcher) {
      sendResponse({ success: false, error: 'Prefetch not available' });
      return;
    }

    switch (message.type) {
      case 'PREFETCH_RETRY':
        this.prefetcher.retry(message.payload.tabId);
        this.broadcastPrefetchSnapshot();
        sendResponse({ success: true });
        return;
      case 'PREFETCH_STATUS_SNAPSHOT_REQUEST':
        sendResponse({ success: true, snapshot: this.prefetcher.getStatusSnapshot() });
        return;
      default:
        sendResponse({ success: false, error: 'Unknown prefetch command' });
    }
  }

  private handleKeepAliveDiagnostics(diagnostics: KeepAliveDiagnostics): void {
    if (!this.prefetcher) {
      return;
    }
    this.prefetcher.updateKeepAliveDiagnostics(diagnostics);
    this.broadcastPrefetchSnapshot();
  }

  private sendPrefetchSnapshotToPort(port: ChromeRuntimePort): void {
    if (!this.prefetcher) {
      return;
    }
    try {
      port.postMessage({
        type: 'PREFETCH_STATUS_SYNC',
        payload: this.prefetcher.getStatusSnapshot(),
      } satisfies PrefetchBroadcastMessage);
    } catch (error) {
      this.logger.warn('[BackgroundOrchestrator] Failed to send prefetch snapshot to port', error);
    }
  }

  private broadcastPrefetchSnapshot(): void {
    if (!this.prefetcher) {
      return;
    }
    this.ports.forEach((port) => this.sendPrefetchSnapshotToPort(port));
  }

  private async handleAddCommand(payload: QueueAddPayload): Promise<void> {
    const tab: TabInfo = {
      tabId: payload.tab.tabId,
      url: payload.tab.url,
      title: payload.tab.title,
      content: payload.tab.content,
      summary: payload.tab.summary,
      translation: payload.tab.translation,
      isIgnored: false,
      extractedAt: payload.tab.extractedAt ? new Date(payload.tab.extractedAt) : new Date(),
    };

    await this.tabManager.addTab(tab, {
      position: payload.position,
      autoStart: payload.autoStart,
    });
  }

  private async ensureActiveTabInQueue(): Promise<boolean> {
    // キューに読み上げ可能なタブがあるかチェック
    const snapshot = this.tabManager.getSnapshot();

    // 読み上げ可能なタブが存在する場合は何もしない
    const hasReadableTabs = snapshot.tabs.some((tab) => !tab.isIgnored);
    if (hasReadableTabs) {
      return false;
    }

    try {
      // アクティブタブを取得
      const tabs = await (this.chrome.tabs as any).query({ active: true, currentWindow: true });
      const activeTab = tabs[0];

      if (!activeTab || !activeTab.id || !activeTab.url) {
        this.logger.warn('BackgroundOrchestrator: no active tab found');
        return false;
      }

      // タブ情報を作成（コンテンツは後で取得）
      const tab: TabInfo = {
        tabId: activeTab.id,
        url: activeTab.url,
        title: activeTab.title || '',
        isIgnored: false,
        extractedAt: new Date(),
      };

      // キューに追加（コンテンツ抽出は後で行われる）
      await this.tabManager.addTab(tab, {
        position: 'end',
        autoStart: false, // processNext()で手動で開始する
      });

      this.logger.info('BackgroundOrchestrator: added active tab to queue', { tabId: activeTab.id, url: activeTab.url });
      return true;
    } catch (error) {
      this.logger.error('BackgroundOrchestrator: failed to add active tab to queue', error);
      return false;
    }
  }

  private async handleControlCommand(action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> {
    // For Chrome with Offscreen API, delegate TTS control to offscreen document
    if (BrowserAdapter.getBrowserType() === 'chrome' && BrowserAdapter.isFeatureSupported('offscreen')) {
      await this.forwardToOffscreen(action);
      return;
    }

    // For Firefox or Chrome without offscreen, use direct TTS control
    switch (action) {
      case 'start':
        await this.ensureActiveTabInQueue();
        await this.tabManager.processNext();
        break;
      case 'pause':
        this.tabManager.pause();
        break;
      case 'resume':
        this.tabManager.resume();
        break;
      case 'stop':
        await this.tabManager.stop();
        break;
      default:
        throw new Error(`Unsupported control action: ${action}`);
    }
  }

  /**
   * Forward TTS control commands to Offscreen Document
   */
  private async forwardToOffscreen(action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> {
    let message: OffscreenCommandMessage;

    switch (action) {
      case 'start': {
        const snapshot = this.tabManager.getSnapshot();
        const currentTab = snapshot.tabs[snapshot.currentIndex];
        if (!currentTab) {
          throw new Error('No tab available to start playback');
        }
        message = {
          type: 'OFFSCREEN_TTS_START',
          payload: {
            tab: currentTab as any,
            settings: snapshot.settings,
          },
        };
        break;
      }
      case 'pause':
        message = { type: 'OFFSCREEN_TTS_PAUSE' };
        break;
      case 'resume':
        message = { type: 'OFFSCREEN_TTS_RESUME' };
        break;
      case 'stop':
        message = { type: 'OFFSCREEN_TTS_STOP' };
        break;
      default:
        throw new Error(`Unsupported offscreen action: ${action}`);
    }

    try {
      await this.chrome.runtime.sendMessage(message);
      this.logger.info(`[BackgroundOrchestrator] Forwarded ${action} command to offscreen`);
    } catch (error) {
      this.logger.error(`[BackgroundOrchestrator] Failed to forward ${action} to offscreen`, error);
      // Don't throw - log error and continue
    }
  }

  /**
   * Handle settings update - forward to both TabManager and Offscreen Document
   */
  private async handleUpdateSettings(settings: any): Promise<void> {
    // Update TabManager settings
    await this.tabManager.updateSettings(settings);

    // For Chrome with Offscreen API, also forward to offscreen document
    if (BrowserAdapter.getBrowserType() === 'chrome' && BrowserAdapter.isFeatureSupported('offscreen')) {
      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_UPDATE_SETTINGS',
        payload: { settings },
      };

      try {
        await this.chrome.runtime.sendMessage(message);
        this.logger.info('[BackgroundOrchestrator] Forwarded settings update to offscreen');
      } catch (error) {
        this.logger.error('[BackgroundOrchestrator] Failed to forward settings to offscreen', error);
        // Don't throw - log error and continue
      }
    }
  }

  /**
   * Handle broadcast messages from Offscreen Document
   */
  private async handleOffscreenBroadcast(message: OffscreenBroadcastMessage): Promise<void> {
    this.logger.info('[BackgroundOrchestrator] Received offscreen broadcast', message.type);

    switch (message.type) {
      case 'OFFSCREEN_TTS_STATUS':
        // Map offscreen status to queue status and broadcast
        const status = message.payload.status;
        // Broadcast to popup/options pages
        break;
      case 'OFFSCREEN_TTS_PROGRESS':
        // Forward progress updates
        break;
      case 'OFFSCREEN_TTS_ERROR':
        this.logger.error('[BackgroundOrchestrator] Offscreen TTS error', message.payload);
        break;
      case 'OFFSCREEN_TTS_END':
        // Handle playback end - move to next tab
        await this.tabManager.skipTab('next');
        break;
      default:
        this.logger.warn('[BackgroundOrchestrator] Unknown offscreen message type', message);
    }
  }

  private async handleTextExtracted(message: { type: 'TEXT_EXTRACTED'; content: any }): Promise<void> {
    const { content } = message;
    if (!content || typeof content.tabId !== 'number') {
      this.logger.warn('BackgroundOrchestrator: invalid TEXT_EXTRACTED message', message);
      return;
    }

    const { tabId, text, url, title, extractedAt } = content;

    try {
      await this.tabManager.onTabUpdated(tabId, {
        url,
        title,
        content: text,
        extractedAt: extractedAt || Date.now(),
      });
      this.logger.info(`BackgroundOrchestrator: content extracted for tab ${tabId}, length: ${text?.length || 0}`);
    } catch (error) {
      this.logger.error('BackgroundOrchestrator: failed to update tab with extracted content', error);
    }
  }

  private async handleCommandEvent(event: QueueBroadcastMessage): Promise<void> {
    if (event.type !== 'QUEUE_CONTENT_REQUEST') {
      return;
    }

    const { tabId } = event.payload;
    try {
      await this.chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_TEXT', tabId });
    } catch (error) {
      this.logger.error('BackgroundOrchestrator: failed to request content extraction', error);
    }
  }

  private async handleShortcutCommand(command: string): Promise<void> {
    // デバッグ用: アラート表示（本番環境では削除可能）
    if (typeof globalThis !== 'undefined') {
      console.log(`[Read Aloud Tab] Shortcut command received: ${command}`);
    }

    this.logger.info(`Shortcut command received: ${command}`);

    switch (command) {
      case 'read-aloud-toggle': {
        const status = this.tabManager.getSnapshot().status;
        if (status === 'reading') {
          this.logger.info('Toggling: Pausing read aloud...');
          this.tabManager.pause();
        } else if (status === 'paused') {
          this.logger.info('Toggling: Resuming read aloud...');
          this.tabManager.resume();
        } else {
          this.logger.info('Toggling: Starting read aloud...');
          await this.ensureActiveTabInQueue();
          await this.tabManager.processNext();
        }
        break;
      }
      case 'read-aloud-start':
        this.logger.info('Starting read aloud...');
        await this.ensureActiveTabInQueue();
        await this.tabManager.processNext();
        break;
      case 'read-aloud-stop':
        this.logger.info('Stopping read aloud...');
        await this.tabManager.stop();
        break;
      case 'read-aloud-next':
        this.logger.info('Skipping to next tab...');
        await this.tabManager.skipTab('next');
        break;
      case 'read-aloud-prev':
        this.logger.info('Skipping to previous tab...');
        await this.tabManager.skipTab('previous');
        break;
      case 'read-aloud-pause':
        this.logger.info('Pausing read aloud...');
        this.tabManager.pause();
        break;
      case 'read-aloud-resume':
        this.logger.info('Resuming read aloud...');
        this.tabManager.resume();
        break;
      default:
        this.logger.debug('BackgroundOrchestrator: unknown command', command);
    }
  }

  private broadcastStatus(payload: QueueStatusPayload): void {
    this.broadcast({ type: 'QUEUE_STATUS_UPDATE', payload });
  }

  private broadcastProgress(payload: QueueProgressPayload): void {
    this.broadcast({ type: 'QUEUE_PROGRESS_UPDATE', payload });
  }

  private broadcastError(payload: QueueErrorPayload): void {
    this.broadcast({ type: 'QUEUE_ERROR', payload });
  }

  private broadcast(message: QueueBroadcastMessage): void {
    // Port通信のみを使用（接続されたクライアントにのみ配信）
    // runtime.sendMessageはbackground script自身への送信となり、
    // 受信側が存在しないためFirefoxでエラーログが発生する問題を回避
    for (const port of this.ports) {
      try {
        port.postMessage(message);
      } catch (error) {
        this.logger.debug('BackgroundOrchestrator: port postMessage failed', error);
      }
    }
  }
}
