import { TabInfo, STORAGE_KEYS, KeepAliveDiagnostics } from '../shared/types';
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
import { KeepAliveController, KeepAliveConfig, KeepAliveEvent, RuntimePort } from './keepAliveController';
import { StorageManager } from '../shared/utils/storage';
import { BrowserAdapter } from '../shared/utils/browser';
import { getIgnoredDomains } from '../shared/utils/storage';

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
  connect?: (options: { name: string }) => ChromeRuntimePort;
}

interface ChromeTabsLike {
  sendMessage: (tabId: number, message: any) => Promise<unknown> | void;
  query?: {
    (queryInfo: any): Promise<any[]> | any[];
    (queryInfo: any, callback: (tabs: any[]) => void): void;
  };
}

interface ChromeAlarmsLike {
  create: (name: string, alarmInfo: { delayInMinutes?: number; periodInMinutes?: number }) => void;
  clear: (name: string, callback?: (wasCleared: boolean) => void) => void | Promise<boolean> | boolean;
  onAlarm: {
    addListener: (listener: (alarm: { name: string }) => void) => void;
    removeListener?: (listener: (alarm: { name: string }) => void) => void;
  };
}

interface ChromeLike {
  runtime: ChromeRuntimeLike;
  tabs: ChromeTabsLike;
  commands?: {
    onCommand: {
      addListener: (listener: (command: string) => void) => void;
    };
  };
  alarms?: ChromeAlarmsLike;
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
  keepAliveController?: KeepAliveController;
  keepAliveConfig?: Partial<KeepAliveConfig>;
}

export class BackgroundOrchestrator {
  private readonly tabManager: TabManager;
  private readonly chrome: ChromeLike;
  private readonly logger: LoggerLike;
  private readonly prefetcher: AiPrefetcher | null;
  private initialized = false;

  private readonly ports = new Set<ChromeRuntimePort>();
  private unsubscribeFns: Array<() => void> = [];
  private readonly keepAliveController: KeepAliveController | null;
  private developerMode = false;
  private keepAliveDiagnostics: KeepAliveDiagnostics = {
    state: 'stopped',
    lastHeartbeatAt: null,
    lastAlarmAt: null,
    lastFallbackAt: null,
    fallbackCount: 0,
  };
  private lastOffscreenHeartbeatAt: number | null = null;

  constructor(options: BackgroundOrchestratorOptions) {
    this.tabManager = options.tabManager;
    const browserAPI = BrowserAdapter.getInstance();
    this.chrome = options.chrome || (browserAPI as unknown as ChromeLike);
    this.logger = options.logger || console;
    this.prefetcher = options.prefetcher ?? null;
    this.keepAliveController = options.keepAliveController || this.createKeepAliveController(options.keepAliveConfig);

    if (!this.chrome?.runtime) {
      throw new Error('Chrome runtime APIs are not available');
    }

    // Set content resolver for TabManager to enable AI prefetch waiting
    this.tabManager.setContentResolver(this.createContentResolver);
  }

  /**
   * Content resolver for TabManager
   * Waits for AI summary/translation if enabled before returning
   */
  private createContentResolver = async (tab: TabInfo) => {
    // If no content, request extraction first
    if (!tab.content || tab.content.trim().length === 0) {
      this.emitContentRequest(tab.tabId, 'missing');
      return null;
    }

    // If AI prefetcher is available and enabled, wait for summary/translation
    if (this.prefetcher) {
      try {
        const settings = await import('../shared/utils/storage').then((m) => m.StorageManager.getAiSettings());
        const needsAi = settings.enableAiSummary || settings.enableAiTranslation;

        if (needsAi) {
          this.logger.info(`[BackgroundOrchestrator] Waiting for AI prefetch for tab ${tab.tabId}...`);
          const success = await this.prefetcher.waitForPrefetch(tab.tabId, 30000);

          if (success) {
            this.logger.info(`[BackgroundOrchestrator] AI prefetch completed for tab ${tab.tabId}`);
            // Get updated tab info with summary/translation
            const updatedTab = this.tabManager.getTabById(tab.tabId);
            if (updatedTab) {
              const hasSummary = !!updatedTab.summary;
              const hasTranslation = !!updatedTab.translation;
              this.logger.debug?.(`[BackgroundOrchestrator] Prefetch result: summary=${hasSummary}, translation=${hasTranslation}`);
              return {
                content: updatedTab.content,
                summary: updatedTab.summary,
                translation: updatedTab.translation,
                extractedAt: updatedTab.extractedAt,
              };
            }
          } else {
            this.logger.warn(`[BackgroundOrchestrator] AI prefetch timeout for tab ${tab.tabId}, proceeding with original content`);
          }
        }
      } catch (error) {
        this.logger.warn('[BackgroundOrchestrator] Failed to check AI settings or wait for prefetch', error);
      }
    }

    // Return current content (fallback or AI disabled)
    const hasSummary = !!tab.summary;
    const hasTranslation = !!tab.translation;
    this.logger.debug?.(`[BackgroundOrchestrator] Resolved content for tab ${tab.tabId}: summary=${hasSummary}, translation=${hasTranslation}`);
    return {
      content: tab.content,
      summary: tab.summary,
      translation: tab.translation,
      extractedAt: tab.extractedAt,
    };
  };

  private emitContentRequest(tabId: number, reason: 'missing' | 'stale'): void {
    const event = { type: 'QUEUE_CONTENT_REQUEST', payload: { tabId, reason } } as const;
    for (const listener of this.unsubscribeFns) {
      // This is a workaround - we need to emit to command listeners
      // but we don't have direct access here
    }
    // Send directly via tabs API
    try {
      this.chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_TEXT', tabId });
    } catch (error) {
      this.logger.error('[BackgroundOrchestrator] Failed to request content extraction', error);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.refreshDeveloperMode();
    await this.tabManager.initialize();
    await this.setupOffscreenDocument();
    this.registerTabManagerListeners();
    this.registerRuntimeListeners();
    this.registerCommandListeners();
    this.registerKeepAliveListeners();
    this.registerDeveloperModeListener();

    // Check if playback needs to be resumed after Service Worker restart
    const snapshot = this.tabManager.getSnapshot();
    if (snapshot.status === 'reading') {
      this.logger.info('[BackgroundOrchestrator] Service Worker restarted during playback, attempting to resume...');

      // For Chrome with Offscreen API, ensure offscreen document is available
      if (BrowserAdapter.getBrowserType() === 'chrome' && BrowserAdapter.isFeatureSupported('offscreen')) {
        const hasOffscreen = await this.ensureOffscreenDocument();
        if (!hasOffscreen) {
          this.logger.warn('[BackgroundOrchestrator] Cannot resume: offscreen document unavailable');
          // TabManager will handle state sync in resumePlaybackIfNeeded
        } else {
          this.logger.info('[BackgroundOrchestrator] Offscreen document ready for resume');
        }
      }
    }

    // Resume playback if needed
    this.tabManager.resumePlaybackIfNeeded().catch((error) => {
      this.logger.warn('BackgroundOrchestrator: failed to resume playback', error);
    });

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

  /**
   * Ensure Offscreen Document exists, recreating if necessary.
   * This is critical after Service Worker restarts.
   * @returns true if offscreen document is available, false otherwise
   */
  private async ensureOffscreenDocument(): Promise<boolean> {
    if (BrowserAdapter.getBrowserType() !== 'chrome' || !BrowserAdapter.isFeatureSupported('offscreen')) {
      return false;
    }

    try {
      const hasOffscreen = await BrowserAdapter.hasOffscreenDocument();
      if (hasOffscreen) {
        return true;
      }

      this.logger.warn('[BackgroundOrchestrator] Offscreen document missing, recreating...');
      await BrowserAdapter.createOffscreenDocument(
        'offscreen.html',
        ['AUDIO_PLAYBACK' as any],
        'Text-to-speech audio playback'
      );
      this.logger.info('[BackgroundOrchestrator] Offscreen document recreated successfully');
      return true;
    } catch (error) {
      this.logger.error('[BackgroundOrchestrator] Failed to ensure offscreen document', error);
      return false;
    }
  }

  private registerTabManagerListeners(): void {
    const statusHandler = (payload: QueueStatusPayload) => {
      this.broadcastStatus(payload);
      if (!this.keepAliveController) {
        return;
      }

      if (payload.status === 'reading') {
        void this.keepAliveController.startHeartbeat('queue').catch((error) => {
          this.logger.warn('BackgroundOrchestrator: failed to start keep-alive heartbeat', error);
        });
      } else {
        void this.keepAliveController.stopHeartbeat('queue').catch((error) => {
          this.logger.warn('BackgroundOrchestrator: failed to stop keep-alive heartbeat', error);
        });
      }
    };

    this.unsubscribeFns.push(this.tabManager.addStatusListener(statusHandler));
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

  private registerKeepAliveListeners(): void {
    if (!this.keepAliveController || !this.chrome.alarms?.onAlarm?.addListener) {
      return;
    }

    const handler = (alarm: { name: string }) => {
      void this.keepAliveController?.handleAlarm(alarm.name).catch((error) => {
        this.logger.warn('BackgroundOrchestrator: keep-alive alarm handling failed', error);
      });
    };

    this.chrome.alarms.onAlarm.addListener(handler);
    this.unsubscribeFns.push(() => this.chrome.alarms?.onAlarm?.removeListener?.(handler));
  }

  private registerDeveloperModeListener(): void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync' || !changes[STORAGE_KEYS.DEVELOPER_MODE]) {
        return;
      }
      this.refreshDeveloperMode().catch((error) => {
        this.logger.warn('BackgroundOrchestrator: failed to refresh developer mode', error);
      });
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
      chrome.storage.onChanged.addListener(listener);
      this.unsubscribeFns.push(() => chrome.storage.onChanged.removeListener(listener));
    }
  }

  private async refreshDeveloperMode(): Promise<void> {
    try {
      this.developerMode = await StorageManager.getDeveloperMode();
      if (this.developerMode) {
        this.persistDiagnostics();
      } else {
        chrome.storage?.local?.remove?.('readAloudDiagnostics');
      }
    } catch (error) {
      this.developerMode = false;
      this.logger.warn('BackgroundOrchestrator: failed to load developer mode flag', error);
    }
  }

  private handleKeepAliveEvent(event: KeepAliveEvent): void {
    switch (event.type) {
      case 'heartbeat-started':
        this.updateDiagnostics({ state: 'running', lastHeartbeatAt: event.timestamp });
        break;
      case 'heartbeat-stopped':
        this.updateDiagnostics({ state: 'stopped' });
        break;
      case 'alarm-fired':
        this.updateDiagnostics({ lastAlarmAt: event.timestamp });
        break;
      case 'fallback-triggered':
        this.updateDiagnostics({
          lastFallbackAt: event.timestamp,
          fallbackCount: this.keepAliveDiagnostics.fallbackCount + 1,
        });
        break;
      default:
        break;
    }
  }

  private updateDiagnostics(patch: Partial<KeepAliveDiagnostics>): void {
    this.keepAliveDiagnostics = {
      ...this.keepAliveDiagnostics,
      ...patch,
    };
    this.persistDiagnostics();
  }

  private persistDiagnostics(): void {
    if (!this.developerMode) {
      return;
    }
    try {
      chrome.storage?.local?.set?.({ readAloudDiagnostics: this.keepAliveDiagnostics });
    } catch (error) {
      this.logger.warn('BackgroundOrchestrator: failed to persist diagnostics', error);
    }
  }

  private createKeepAliveController(config?: Partial<KeepAliveConfig>): KeepAliveController | null {
    if (!this.chrome.alarms) {
      return null;
    }

    const resolvedConfig: KeepAliveConfig = {
      alarmName: 'read-aloud-tab-heartbeat',
      periodInMinutes: 1,
      fallbackPingIntervalMs: 15000,
      maxMissCount: 3,
      ...config,
    };

    return new KeepAliveController({
      alarms: {
        create: (name, info) => {
          this.chrome.alarms?.create(name, info);
        },
        clear: (name) => {
          if (!this.chrome.alarms?.clear) {
            return false;
          }

          const result = this.chrome.alarms.clear(name, () => undefined);
          if (typeof result === 'boolean') {
            return result;
          }
          if (result instanceof Promise) {
            return result;
          }
          return true;
        },
      },
      runtime: {
        sendMessage: (message) => {
          const maybePromise = this.chrome.runtime.sendMessage?.(message as any);
          return maybePromise instanceof Promise ? maybePromise : Promise.resolve(maybePromise);
        },
        connect: (options) => (this.chrome.runtime.connect?.(options) as unknown as RuntimePort | undefined),
      },
      logger: this.logger,
      onKeepAlive: async () => {
        // Ensure offscreen document exists if we're using Chrome with offscreen
        if (BrowserAdapter.getBrowserType() === 'chrome' && BrowserAdapter.isFeatureSupported('offscreen')) {
          const snapshot = this.tabManager.getSnapshot();
          if (snapshot.status === 'reading') {
            const hasOffscreen = await this.ensureOffscreenDocument();
            if (!hasOffscreen) {
              this.logger.error('[KeepAlive] Offscreen document missing during reading state, pausing playback');
              this.tabManager.pause();
            }
          }
        }

        const snapshot = this.tabManager.getSnapshot();
        this.broadcastStatus(snapshot);
      },
      config: resolvedConfig,
      onEvent: (event) => this.handleKeepAliveEvent(event),
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
    // Handle keep-alive port from Offscreen Document
    if (port.name === 'offscreen-keepalive') {
      this.logger.info('[BackgroundOrchestrator] Offscreen keep-alive port connected');
      
      port.onMessage.addListener((message: unknown) => {
        if (typeof message === 'object' && message !== null && 'type' in message) {
          const msg = message as { type: string; timestamp?: number };
          if (msg.type === 'OFFSCREEN_HEARTBEAT') {
            const now = Date.now();
            const timestamp = msg.timestamp || now;

            // Check for heartbeat gap (>30s indicates potential issue)
            if (this.lastOffscreenHeartbeatAt !== null) {
              const gap = now - this.lastOffscreenHeartbeatAt;
              if (gap > 30000) {
                this.logger.warn(`[BackgroundOrchestrator] Heartbeat gap detected: ${gap}ms (>30s threshold)`);
              } else {
                this.logger.debug?.(`[BackgroundOrchestrator] Heartbeat received (gap: ${gap}ms, timestamp: ${timestamp})`);
              }
            } else {
              this.logger.info(`[BackgroundOrchestrator] First heartbeat received (timestamp: ${timestamp})`);
            }

            this.lastOffscreenHeartbeatAt = now;
          }
        }
      });

      port.onDisconnect.addListener(() => {
        this.logger.warn('[BackgroundOrchestrator] Offscreen keep-alive port disconnected');
        this.lastOffscreenHeartbeatAt = null;
      });

      return;
    }

    // Handle regular ports (popup, options, etc.)
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
      case 'QUEUE_CLEAR':
        await this.tabManager.clearQueue();
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

  /**
   * Ensure an active tab exists in the queue.
   * @returns The tabId of the newly added tab, or null if no tab was added
   */
  private async ensureActiveTabInQueue(snapshot?: QueueStatusPayload): Promise<number | null> {
    const queueSnapshot = snapshot ?? this.tabManager.getSnapshot();

    // 既に読み上げ対象のタブが存在する場合は何もしない
    const hasReadableTabs = queueSnapshot.tabs.some((tab) => !tab.isIgnored);
    if (hasReadableTabs) {
      return null;
    }

    if (queueSnapshot.totalCount > 0) {
      return null;
    }

    try {
      // アクティブタブを取得
      const tabs = await this.queryTabs({ active: true, currentWindow: true });
      const activeTab = tabs[0];

      if (!activeTab || !activeTab.id || !activeTab.url) {
        this.logger.warn('BackgroundOrchestrator: no active tab found');
        return null;
      }

      const tabId = activeTab.id;

      // タブ情報を作成（コンテンツは後で取得）
      const tab: TabInfo = {
        tabId,
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

      this.logger.info('BackgroundOrchestrator: added active tab to queue', { tabId, url: activeTab.url });
      return tabId;
    } catch (error) {
      this.logger.error('BackgroundOrchestrator: failed to add active tab to queue', error);
      return null;
    }
  }

  /**
   * Wait for tab content to be extracted with a timeout.
   * @param tabId - The tab ID to wait for
   * @param timeoutMs - Timeout in milliseconds (default: 5000ms)
   * @returns true if content was extracted successfully, false if timeout
   */
  private async waitForTabContent(tabId: number, timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();

    this.logger.info(`[BackgroundOrchestrator] Waiting for content extraction for tab ${tabId}...`);

    // Poll for content with exponential backoff
    let delay = 100; // Start with 100ms
    while (Date.now() - startTime < timeoutMs) {
      const tab = this.tabManager.getTabById(tabId);

      if (tab && tab.content && tab.content.trim().length > 0) {
        this.logger.info(`[BackgroundOrchestrator] Content extracted for tab ${tabId} after ${Date.now() - startTime}ms`);
        return true;
      }

      // Wait with exponential backoff (max 500ms)
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 500);
    }

    this.logger.warn(`[BackgroundOrchestrator] Content extraction timeout for tab ${tabId} after ${timeoutMs}ms`);
    return false;
  }

  private async handleControlCommand(action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> {
    // For Chrome with Offscreen API, handle tab preparation before forwarding
    if (BrowserAdapter.getBrowserType() === 'chrome' && BrowserAdapter.isFeatureSupported('offscreen')) {
      // For 'start' action, ensure tab is ready before forwarding
      if (action === 'start') {
        const addedTabId = await this.ensureActiveTabInQueue();

        // If a new tab was added, wait for content extraction
        if (addedTabId !== null) {
          this.logger.info(`[BackgroundOrchestrator] New tab ${addedTabId} added, waiting for content extraction...`);

          const contentReady = await this.waitForTabContent(addedTabId);

          if (!contentReady) {
            this.logger.warn(`[BackgroundOrchestrator] Content extraction timeout for tab ${addedTabId}, will auto-resume when ready`);
            // Don't proceed - let onTabUpdated handle auto-resume
            return;
          }
        }
      }

      // Forward to offscreen document
      await this.forwardToOffscreen(action);
      return;
    }

    // For Firefox or Chrome without offscreen, use direct TTS control
    switch (action) {
      case 'start': {
        const addedTabId = await this.ensureActiveTabInQueue();

        // If a new tab was added, wait for content extraction
        if (addedTabId !== null) {
          this.logger.info(`[BackgroundOrchestrator] New tab ${addedTabId} added, waiting for content extraction...`);

          const contentReady = await this.waitForTabContent(addedTabId);

          if (!contentReady) {
            this.logger.warn(`[BackgroundOrchestrator] Content extraction timeout for tab ${addedTabId}, will auto-resume when ready`);
            // Don't call processNext yet - let onTabUpdated handle auto-resume
            return;
          }
        }

        await this.tabManager.processNext();
        break;
      }
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
   * Forward TTS control commands to Offscreen Document.
   * Ensures offscreen document exists before sending commands.
   */
  private async forwardToOffscreen(action: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> {
    // Ensure offscreen document exists (recreate if necessary after Service Worker restart)
    const hasOffscreen = await this.ensureOffscreenDocument();
    if (!hasOffscreen) {
      this.logger.error(`[BackgroundOrchestrator] Cannot forward ${action}: offscreen document unavailable`);
      // Sync TabManager state to paused if offscreen is unavailable
      if (action === 'start' || action === 'resume') {
        this.tabManager.pause();
      }
      throw new Error('Offscreen document unavailable');
    }

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

    // Retry logic for message sending
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.chrome.runtime.sendMessage(message);
        this.logger.info(`[BackgroundOrchestrator] Forwarded ${action} command to offscreen (attempt ${attempt})`);
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`[BackgroundOrchestrator] Failed to forward ${action} (attempt ${attempt}/2)`, error);

        if (attempt < 2) {
          // On first failure, try to recreate offscreen document
          this.logger.warn('[BackgroundOrchestrator] Attempting to recreate offscreen document...');
          const recreated = await this.ensureOffscreenDocument();
          if (!recreated) {
            break; // No point retrying if recreation failed
          }
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    // All retries failed
    this.logger.error(`[BackgroundOrchestrator] Failed to forward ${action} after 2 attempts`, lastError);
    // Sync TabManager state to paused on failure
    if (action === 'start' || action === 'resume') {
      this.tabManager.pause();
    }
    throw lastError || new Error(`Failed to forward ${action} to offscreen`);
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
    this.logger.info(`Shortcut command received: ${command}`);

    switch (command) {
      case 'read-aloud-toggle': {
        const snapshot = this.tabManager.getSnapshot();
        if (snapshot.status === 'reading') {
          this.logger.info('Toggling: Pausing read aloud...');
          this.tabManager.pause();
        } else if (snapshot.status === 'paused') {
          this.logger.info('Toggling: Resuming read aloud...');
          this.tabManager.resume();
        } else {
          this.logger.info('Toggling: Starting read aloud...');
          const hasReadableTabs = snapshot.tabs.some((tab) => !tab.isIgnored);
          if (!hasReadableTabs && snapshot.totalCount === 0) {
            await this.ensureActiveTabInQueue(snapshot);
          }
          await this.tabManager.processNext();
        }
        break;
      }
      case 'read-aloud-queue-all':
        this.logger.info('Queueing all tabs from shortcut...');
        await this.queueAllTabsAndPlay();
        break;
      default:
        this.logger.debug('BackgroundOrchestrator: unknown command', command);
    }
  }

  private async queryTabs(queryInfo: any): Promise<any[]> {
    const tabsApi = this.chrome.tabs;
    const queryFn = tabsApi?.query;
    if (!queryFn) {
      this.logger.warn('BackgroundOrchestrator: tabs.query API is unavailable');
      return [];
    }

    // Support callback-based and promise-based variants
    if (queryFn.length >= 2) {
      return new Promise<any[]>((resolve) => {
        try {
          (queryFn as (queryInfo: any, callback: (tabs: any[]) => void) => void)(queryInfo, (tabs: any[]) =>
            resolve(Array.isArray(tabs) ? tabs : []),
          );
        } catch (error) {
          this.logger.error('BackgroundOrchestrator: tabs.query callback variant failed', error);
          resolve([]);
        }
      });
    }

    try {
      const result = (queryFn as (queryInfo: any) => Promise<any[]> | any[])(queryInfo);
      if (Array.isArray(result)) {
        return result;
      }
      if (result && typeof (result as Promise<any[]>).then === 'function') {
        return await result;
      }

      return [];
    } catch (error) {
      this.logger.error('BackgroundOrchestrator: tabs.query failed', error);
      return [];
    }
  }

  private isTabQueueCandidate(tab: any, ignoredDomains: Set<string>): boolean {
    if (!tab || typeof tab.id !== 'number' || !tab.url) {
      return false;
    }

    const invalidPrefixes = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'moz-extension://'];
    if (invalidPrefixes.some((prefix) => tab.url.startsWith(prefix))) {
      return false;
    }

    try {
      const url = new URL(tab.url);
      if (ignoredDomains.has(url.hostname.toLowerCase())) {
        return false;
      }
    } catch (error) {
      this.logger.debug('BackgroundOrchestrator: skipping tab due to invalid URL', { url: tab.url, error });
      return false;
    }

    return true;
  }

  private async queueAllTabsAndPlay(): Promise<void> {
    const tabs = await this.queryTabs({ currentWindow: true });
    if (!tabs.length) {
      this.logger.info('BackgroundOrchestrator: no tabs found when queueing all');
      return;
    }

    let ignoredDomains: string[] = [];
    try {
      ignoredDomains = await getIgnoredDomains();
    } catch (error) {
      this.logger.warn('BackgroundOrchestrator: failed to load ignored domains', error);
    }
    const ignoredSet = new Set(ignoredDomains.map((domain) => domain.toLowerCase()));

    let addedCount = 0;
    for (const tab of tabs) {
      if (!this.isTabQueueCandidate(tab, ignoredSet)) {
        continue;
      }

      const tabInfo: TabInfo = {
        tabId: tab.id,
        url: tab.url,
        title: tab.title || tab.url,
        isIgnored: false,
        extractedAt: new Date(),
      };

      try {
        await this.tabManager.addTab(tabInfo, { position: 'end', autoStart: false });
        addedCount += 1;
      } catch (error) {
        this.logger.error('BackgroundOrchestrator: failed to add tab from queue-all shortcut', {
          tabId: tab.id,
          url: tab.url,
          error,
        });
      }
    }

    if (addedCount === 0) {
      this.logger.info('BackgroundOrchestrator: no valid tabs to queue from shortcut');
      return;
    }

    const status = this.tabManager.getSnapshot().status;
    if (status === 'reading') {
      return;
    }

    if (status === 'paused') {
      this.tabManager.resume();
      return;
    }

    await this.tabManager.processNext();
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
