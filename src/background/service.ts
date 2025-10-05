import { TabInfo } from '../shared/types';
import {
  QueueCommandMessage,
  QueueBroadcastMessage,
  QueueStatusPayload,
  QueueProgressPayload,
  QueueErrorPayload,
  QueueAddPayload,
  isQueueCommandMessage,
} from '../shared/messages';
import { TabManager, LoggerLike } from './tabManager';
import { BrowserAdapter } from '../shared/utils/browser';

interface ChromeRuntimePort {
  name: string;
  postMessage: (message: QueueBroadcastMessage | Record<string, unknown>) => void;
  onMessage: { addListener: (listener: (message: QueueCommandMessage | unknown) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
}

interface ChromeRuntimeLike {
  onMessage: { addListener: (listener: RuntimeMessageListener) => void };
  onConnect: { addListener: (listener: (port: ChromeRuntimePort) => void) => void };
  sendMessage: (message: QueueBroadcastMessage) => Promise<unknown> | void;
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
}

export class BackgroundOrchestrator {
  private readonly tabManager: TabManager;
  private readonly chrome: ChromeLike;
  private readonly logger: LoggerLike;
  private initialized = false;

  private readonly ports = new Set<ChromeRuntimePort>();
  private unsubscribeFns: Array<() => void> = [];

  constructor(options: BackgroundOrchestratorOptions) {
    this.tabManager = options.tabManager;
    const browserAPI = BrowserAdapter.getInstance();
    this.chrome = options.chrome || (browserAPI as unknown as ChromeLike);
    this.logger = options.logger || console;

    if (!this.chrome?.runtime) {
      throw new Error('Chrome runtime APIs are not available');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.tabManager.initialize();
    this.registerTabManagerListeners();
    this.registerRuntimeListeners();
    this.registerCommandListeners();

    this.initialized = true;
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

    const handlePortMessage = async (message: QueueCommandMessage | unknown) => {
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
        await this.tabManager.updateSettings(message.payload.settings);
        return { success: true };
      case 'REQUEST_QUEUE_STATE':
        return { success: true, payload: this.tabManager.getSnapshot() };
      default:
        return { success: false, error: 'Unknown command' } as any;
    }
  }

  private async handleAddCommand(payload: QueueAddPayload): Promise<void> {
    const tab: TabInfo = {
      tabId: payload.tab.tabId,
      url: payload.tab.url,
      title: payload.tab.title,
      content: payload.tab.content,
      summary: payload.tab.summary,
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
    try {
      const sendResult = this.chrome.runtime.sendMessage(message);
      if (sendResult instanceof Promise) {
        sendResult.catch((error) => this.logger.debug('BackgroundOrchestrator: runtime sendMessage failed', error));
      }
    } catch (error) {
      this.logger.debug('BackgroundOrchestrator: runtime sendMessage threw', error);
    }

    for (const port of this.ports) {
      try {
        port.postMessage(message);
      } catch (error) {
        this.logger.debug('BackgroundOrchestrator: port postMessage failed', error);
      }
    }
  }
}
