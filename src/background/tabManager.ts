import { ReadingQueue, TabInfo, TTSSettings, cloneTabInfo } from '../shared/types';
import {
  loadQueue as defaultLoadQueue,
  saveQueue as defaultSaveQueue,
  getIgnoredDomains as defaultGetIgnoredDomains,
  StorageManager,
} from '../shared/utils/storage';
import {
  QueueStatusPayload,
  QueueProgressPayload,
  QueueErrorPayload,
  QueueStatusListener,
  QueueProgressListener,
  QueueErrorListener,
  QueueCommandListener,
  QueueSkipDirection,
  SerializedTabInfo,
  toSerializedTabInfo,
} from '../shared/messages';
import {
  QUEUE_CONTENT_CHAR_BUDGET,
  QUEUE_PERSIST_DEBOUNCE_MS,
  QUEUE_CONTENT_RESERVE_ACTIVE,
} from '../shared/constants';
import { createExtensionError, formatErrorLog } from '../shared/errors';

export interface PlaybackHooks {
  onEnd: () => void;
  onError: (error: Error) => void;
  onProgress?: (progress: number) => void;
}

export interface PlaybackController {
  start: (tab: TabInfo, settings: TTSSettings, hooks: PlaybackHooks) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  updateSettings: (settings: TTSSettings) => void;
}

export interface ContentResolverResult {
  content?: string;
  summary?: string;
  translation?: string;
  extractedAt?: number | string | Date;
}

export type ContentResolver = (tab: TabInfo) => Promise<ContentResolverResult | null>;

interface QueueStorageAdapter {
  load: () => Promise<ReadingQueue>;
  save: (queue: ReadingQueue) => Promise<void>;
}

export interface LoggerLike {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface TabManagerOptions {
  playback: PlaybackController;
  storage?: QueueStorageAdapter;
  getIgnoredDomains?: () => Promise<string[]>;
  resolveContent?: ContentResolver;
  logger?: LoggerLike;
  now?: () => number;
}

interface AddTabOptions {
  position?: 'start' | 'end' | number;
  autoStart?: boolean;
}

export class TabManager {
  private queue: ReadingQueue = {
    tabs: [],
    currentIndex: 0,
    status: 'idle',
    settings: {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      voice: null,
    },
  };

  private readonly playback: PlaybackController;
  private readonly storage: QueueStorageAdapter;
  private readonly fetchIgnoredDomains?: () => Promise<string[]>;
  private resolveContent?: ContentResolver;
  private readonly logger: LoggerLike;
  private readonly now: () => number;

  private ignoredDomains: Set<string> = new Set();

  private statusListeners: Set<QueueStatusListener> = new Set();
  private progressListeners: Set<QueueProgressListener> = new Set();
  private errorListeners: Set<QueueErrorListener> = new Set();
  private commandListeners: Set<QueueCommandListener> = new Set();

  private initialized = false;
  private activePlaybackToken: number | null = null;
  private playbackTokenSeq = 0;
  private progressByTab: Record<number, number> = {};

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPersistPromise: Promise<void> | null = null;
  private persistResolve?: () => void;
  private persistReject?: (error: unknown) => void;
  private readonly persistDelayMs = QUEUE_PERSIST_DEBOUNCE_MS;
  private reloadingTabs: Set<number> = new Set();

  constructor(options: TabManagerOptions) {
    this.playback = options.playback;
    this.storage = options.storage || {
      load: defaultLoadQueue,
      save: defaultSaveQueue,
    };
    this.fetchIgnoredDomains = options.getIgnoredDomains || defaultGetIgnoredDomains;
    this.resolveContent = options.resolveContent;
    this.logger = options.logger || console;
    this.now = options.now || (() => Date.now());
    // aiProcessorはenableTabReadyで不要になった
    // (プリフェッチからのsummary/translationを使用するため)
  }

  /**
   * Set or update the content resolver function
   * This allows BackgroundOrchestrator to configure the resolver after construction
   */
  setContentResolver(resolver: ContentResolver): void {
    this.resolveContent = resolver;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.queue = await this.storage.load();
    } catch (error) {
      this.logError('QUEUE_LOAD_FAILED', 'TabManager: failed to load queue from storage', error);
      // Fallback to default empty queue
      this.queue = {
        tabs: [],
        currentIndex: 0,
        status: 'idle',
        settings: {
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          voice: null,
        },
      };
    }

    // Ensure types are normalized
    this.queue.tabs = this.queue.tabs.map((tab) => this.normalizeTabInfo(tab));
    this.queue.currentIndex = this.clampIndex(this.queue.currentIndex);
    if (!['idle', 'reading', 'paused', 'error', 'processing'].includes(this.queue.status)) {
      this.queue.status = 'idle';
    }
    this.progressByTab = { ...(this.queue.progressByTab ?? {}) };
    this.pruneProgressByTabs();
    this.queue.persistedAt = this.queue.persistedAt ?? this.now();

    if (this.fetchIgnoredDomains) {
      try {
        const domains = await this.fetchIgnoredDomains();
        this.ignoredDomains = new Set(domains.map((domain) => domain.toLowerCase()));
      } catch (error) {
        this.logger.warn('TabManager: failed to load ignored domains', error);
      }
    }

    // AI設定の読み込みはAiPrefetcherが行う
    // (TabManagerはプリフェッチ結果を使用するのみ)

    this.refreshIgnoredFlags();
    this.enforceContentBudget();

    await this.persistQueue(true);
    this.emitStatus();

    this.initialized = true;
  }

  /**
   * Registers a listener for queue status updates. Returns an unsubscribe function.
   */
  addStatusListener(listener: QueueStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  addProgressListener(listener: QueueProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  addErrorListener(listener: QueueErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  addCommandListener(listener: QueueCommandListener): () => void {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  getSnapshot(): QueueStatusPayload {
    return this.createStatusPayload();
  }

  getTabById(tabId: number): TabInfo | null {
    const found = this.queue.tabs.find((tab) => tab.tabId === tabId);
    if (!found) {
      return null;
    }
    return cloneTabInfo(found);
  }

  async requestContentForPrefetch(tabId: number): Promise<void> {
    await this.ensureInitialized();
    const tab = this.queue.tabs.find((candidate) => candidate.tabId === tabId);
    if (!tab || tab.isIgnored) {
      return;
    }
    if (tab.content && tab.content.length > 0) {
      return;
    }
    this.emitContentRequest(tabId, 'missing');
  }

  async addTab(tab: TabInfo, options: AddTabOptions = {}): Promise<void> {
    await this.ensureInitialized();

    const normalized = this.normalizeTabInfo(tab);
    const existingIndex = this.queue.tabs.findIndex((candidate) => candidate.tabId === normalized.tabId);

    if (existingIndex !== -1) {
      this.queue.tabs.splice(existingIndex, 1);
      if (existingIndex <= this.queue.currentIndex && this.queue.currentIndex > 0) {
        this.queue.currentIndex -= 1;
      }
    }

    const insertIndex = this.resolveInsertIndex(options.position);
    this.queue.tabs.splice(insertIndex, 0, normalized);

    if (this.queue.tabs.length === 1) {
      this.queue.currentIndex = 0;
    } else if (insertIndex <= this.queue.currentIndex) {
      this.queue.currentIndex += 1;
    }

    this.enforceContentBudget();
    await this.persistQueue();
    this.emitStatus();

    if (options.autoStart) {
      await this.processNext(this.queue.currentIndex);
    }
  }

  async removeTab(tabId: number): Promise<void> {
    await this.ensureInitialized();

    const index = this.queue.tabs.findIndex((tab) => tab.tabId === tabId);
    if (index === -1) {
      return;
    }

    const wasCurrent = index === this.queue.currentIndex;

    this.queue.tabs.splice(index, 1);

    if (this.queue.tabs.length === 0) {
      await this.stopInternal(true);
      await this.persistQueue();
      this.emitStatus();
      return;
    }

    if (index < this.queue.currentIndex) {
      this.queue.currentIndex = Math.max(0, this.queue.currentIndex - 1);
    } else if (this.queue.currentIndex >= this.queue.tabs.length) {
      this.queue.currentIndex = this.queue.tabs.length - 1;
    }

    if (wasCurrent) {
      await this.processNext(this.queue.currentIndex);
    } else {
      await this.persistQueue();
      this.emitStatus();
    }
  }

  async clearQueue(): Promise<void> {
    await this.ensureInitialized();

    if (this.queue.tabs.length === 0 && this.queue.status === 'idle') {
      return;
    }

    await this.stopInternal(true);
    this.queue.tabs = [];
    this.queue.currentIndex = 0;

    await this.persistQueue();
    this.emitStatus();
  }

  async reorderTabs(fromIndex: number, toIndex: number): Promise<void> {
    await this.ensureInitialized();

    const clampedFrom = this.clampIndex(fromIndex);
    const clampedTo = this.clampIndex(toIndex);

    if (clampedFrom === clampedTo) {
      return;
    }

    const [moved] = this.queue.tabs.splice(clampedFrom, 1);
    this.queue.tabs.splice(clampedTo, 0, moved);

    if (clampedFrom === this.queue.currentIndex) {
      this.queue.currentIndex = clampedTo;
    } else if (clampedFrom < this.queue.currentIndex && clampedTo >= this.queue.currentIndex) {
      this.queue.currentIndex -= 1;
    } else if (clampedFrom > this.queue.currentIndex && clampedTo <= this.queue.currentIndex) {
      this.queue.currentIndex += 1;
    }

    await this.persistQueue();
    this.emitStatus();
  }

  async skipTab(direction: QueueSkipDirection = 'next'): Promise<void> {
    await this.ensureInitialized();

    if (this.queue.tabs.length === 0) {
      return;
    }

    if (direction === 'next') {
      const nextIndex = this.findNextReadableIndex(this.queue.currentIndex + 1);
      if (nextIndex === -1) {
        await this.stopInternal(true);
        await this.persistQueue();
        this.emitStatus();
        return;
      }
      await this.playbackStopSafe();
      await this.processNext(nextIndex);
    } else {
      const previousIndex = this.findPreviousReadableIndex(this.queue.currentIndex - 1);
      if (previousIndex === -1) {
        await this.stopInternal(true);
        await this.persistQueue();
        this.emitStatus();
        return;
      }
      await this.playbackStopSafe();
      await this.processNext(previousIndex);
    }
  }

  async processNext(startIndex?: number): Promise<void> {
    await this.ensureInitialized();

    if (this.queue.tabs.length === 0) {
      await this.stopInternal(true);
      await this.persistQueue();
      this.emitStatus();
      return;
    }

    const targetIndex = this.selectNextIndex(startIndex);
    if (targetIndex === -1) {
      await this.stopInternal(true);
      await this.persistQueue();
      this.emitStatus();
      return;
    }

    const tab = this.queue.tabs[targetIndex];

    // ステータスを処理中に変更してUIに通知
    this.queue.status = 'processing';
    this.queue.currentIndex = targetIndex;
    await this.persistQueue();
    this.emitStatus();

    const ready = await this.ensureTabReady(tab);

    if (!ready) {
      this.queue.status = 'paused';
      this.queue.pausedByUser = false;  // コンテンツ抽出待ちのpause
      this.queue.currentIndex = targetIndex;
      await this.persistQueue();
      this.emitStatus();
      return;
    }

    const playbackText = this.selectPlaybackContent(tab);
    if (!playbackText) {
      this.logger.warn('TabManager: no playable content available after prefetch', {
        tabId: tab.tabId,
        hasContent: Boolean(tab.content),
        hasSummary: Boolean(tab.summary),
        hasTranslation: Boolean(tab.translation),
      });
      this.queue.status = 'paused';
      this.queue.pausedByUser = false;  // コンテンツ不足のpause
      this.queue.currentIndex = targetIndex;
      await this.persistQueue();
      this.emitStatus();
      return;
    }

    this.queue.currentIndex = targetIndex;
    this.queue.status = 'reading';
    this.queue.pausedByUser = false;  // 再生開始時にリセット
    await this.persistQueue();
    this.emitStatus();

    const token = this.nextPlaybackToken();
    this.activePlaybackToken = token;

    try {
      const playbackTab: TabInfo = {
        ...tab,
        content: playbackText,
      };

      await this.playback.start(playbackTab, this.queue.settings, {
        onEnd: () => this.handlePlaybackEnd(token),
        onError: (error) => this.handlePlaybackError(token, error, tab.tabId),
        onProgress: (progress) => this.handlePlaybackProgress(token, tab.tabId, progress),
      });
    } catch (error) {
      this.handlePlaybackError(token, error instanceof Error ? error : new Error('Playback start failed'), tab.tabId);
      throw error;
    }
  }

  pause(): void {
    if (this.queue.status !== 'reading') {
      return;
    }
    this.playback.pause();
    this.queue.status = 'paused';
    this.queue.pausedByUser = true;
    this.persistQueue().catch((error) => {
      this.logError('QUEUE_PERSIST_FAILED', 'TabManager: failed to persist queue after pause', error);
    });
    this.emitStatus();
  }

  resume(): void {
    if (this.queue.status !== 'paused') {
      return;
    }
    this.playback.resume();
    this.queue.status = 'reading';
    this.queue.pausedByUser = false;
    this.persistQueue().catch((error) => {
      this.logError('QUEUE_PERSIST_FAILED', 'TabManager: failed to persist queue after resume', error);
    });
    this.emitStatus();
  }

  async resumePlaybackIfNeeded(): Promise<void> {
    await this.ensureInitialized();

    if (this.queue.status !== 'reading') {
      return;
    }

    const currentTab = this.queue.tabs[this.queue.currentIndex];
    if (!currentTab) {
      this.queue.status = 'idle';
      await this.persistQueue();
      this.emitStatus();
      return;
    }

    try {
      await this.processNext(this.queue.currentIndex);
    } catch (error) {
      this.logger.warn('TabManager: failed to resume playback after restart', error);
      this.queue.status = 'idle';
      await this.persistQueue();
      this.emitStatus();
      this.pushQueueError('QUEUE_RESUME_FAILED', '読み上げ再開に失敗しました', error, currentTab.tabId);
    }
  }

  async stop(): Promise<void> {
    await this.stopInternal(true);
    await this.persistQueue();
    this.emitStatus();
  }

  async onTabClosed(tabId: number): Promise<void> {
    await this.ensureInitialized();
    const index = this.queue.tabs.findIndex((tab) => tab.tabId === tabId);
    if (index === -1) {
      return;
    }
    await this.removeTab(tabId);
  }

  async onTabLoading(tabId: number): Promise<void> {
    await this.ensureInitialized();

    const index = this.queue.tabs.findIndex((candidate) => candidate.tabId === tabId);
    if (index === -1) {
      return;
    }

    this.reloadingTabs.add(tabId);

    const tab = this.queue.tabs[index];
    if (tab) {
      tab.content = undefined;
      tab.summary = undefined;
      tab.translation = undefined;
    }

    await this.persistQueue();
    this.emitStatus();
  }

  async onTabUpdated(tabId: number, update: Partial<TabInfo>): Promise<void> {
    await this.ensureInitialized();
    const tab = this.queue.tabs.find((candidate) => candidate.tabId === tabId);
    if (!tab) {
      return;
    }

    if (update.title !== undefined) {
      tab.title = update.title;
    }
    if (update.url !== undefined) {
      tab.url = update.url;
      tab.isIgnored = this.isDomainIgnored(update.url);
    }
    if (update.content !== undefined) {
      tab.content = update.content;
    }
    if (update.summary !== undefined) {
      tab.summary = update.summary;
    }
    if (update.translation !== undefined) {
      tab.translation = update.translation;
    }
    if (update.extractedAt) {
      tab.extractedAt = new Date(update.extractedAt);
    }

    await this.persistQueue();
    const index = this.queue.tabs.findIndex((candidate) => candidate.tabId === tabId);
    const isReloaded = this.reloadingTabs.has(tabId);

    if (isReloaded) {
      this.reloadingTabs.delete(tabId);
    }

    // Auto-resume when content is added (both for reload and new tab)
    // Do NOT auto-resume if user manually paused
    const shouldAutoResume =
      update.content &&
      index === this.queue.currentIndex &&
      this.queue.status === 'paused' &&
      !this.queue.pausedByUser;

    this.logger.info('[TabManager] onTabUpdated auto-resume check', {
      tabId,
      hasContent: !!update.content,
      contentLength: update.content?.length || 0,
      isCurrentTab: index === this.queue.currentIndex,
      currentIndex: this.queue.currentIndex,
      queueStatus: this.queue.status,
      pausedByUser: this.queue.pausedByUser,
      shouldAutoResume,
      isReloaded,
    });

    if (shouldAutoResume) {
      this.logger.info(`[TabManager] Auto-resuming playback for tab ${tabId} after content extraction`);
      await this.processNext(this.queue.currentIndex);
    } else {
      this.emitStatus();
    }
  }

  async cleanupClosedTabs(closedTabIds?: number[]): Promise<void> {
    await this.ensureInitialized();

    if (!closedTabIds || closedTabIds.length === 0) {
      return;
    }

    const closedSet = new Set(closedTabIds);
    const originalLength = this.queue.tabs.length;
    this.queue.tabs = this.queue.tabs.filter((tab) => !closedSet.has(tab.tabId));

    if (this.queue.tabs.length === originalLength) {
      return;
    }

    if (this.queue.tabs.length === 0) {
      await this.stopInternal(true);
    } else if (this.queue.currentIndex >= this.queue.tabs.length) {
      this.queue.currentIndex = this.queue.tabs.length - 1;
    }

    await this.persistQueue();
    this.emitStatus();
  }

  async refreshIgnoredDomains(): Promise<void> {
    if (!this.fetchIgnoredDomains) {
      return;
    }
    try {
      const domains = await this.fetchIgnoredDomains();
      this.ignoredDomains = new Set(domains.map((domain) => domain.toLowerCase()));
      this.refreshIgnoredFlags();
      await this.persistQueue();
      this.emitStatus();
    } catch (error) {
      this.logger.warn('TabManager: failed to refresh ignored domains', error);
    }
  }

  async updateSettings(settings: Partial<TTSSettings>): Promise<void> {
    await this.ensureInitialized();

    const merged: Partial<TTSSettings> = {
      ...this.queue.settings,
      ...settings,
    };

    const validated = StorageManager.validateSettings(merged);
    this.queue.settings = validated;

    // Update TTSEngine's current settings
    // If reading, TTSEngine will pause, so update queue status to match
    if (this.queue.status === 'reading') {
      this.playback.updateSettings(validated);
      this.queue.status = 'paused';
    } else if (this.queue.status === 'paused') {
      this.playback.updateSettings(validated);
    }

    // 既存タブのプリフェッチ結果をクリア
    // (AI設定が変更されたため、再プリフェッチが必要)
    for (const tab of this.queue.tabs) {
      tab.summary = undefined;
      tab.translation = undefined;
      tab.processedContent = undefined;
    }

    await Promise.all([
      this.persistQueue(),
      StorageManager.saveSettings(validated),
    ]);

    this.emitStatus();
  }

  validateQueue(): void {
    if (this.queue.tabs.length === 0) {
      this.queue.currentIndex = 0;
      if (this.queue.status !== 'idle') {
        this.queue.status = 'idle';
      }
      return;
    }

    this.queue.currentIndex = this.clampIndex(this.queue.currentIndex);

    if (this.queue.status === 'reading' && this.activePlaybackToken === null) {
      this.queue.status = 'idle';
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async persistQueue(immediate: boolean = false): Promise<void> {
    if (immediate) {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }

      try {
        this.pruneProgressByTabs();
        this.queue.persistedAt = this.now();
        await this.storage.save(this.queue);
        if (this.pendingPersistPromise && this.persistResolve) {
          this.persistResolve();
        }
      } catch (error) {
        if (this.pendingPersistPromise && this.persistReject) {
          this.persistReject(error instanceof Error ? error : new Error('Queue persistence failed'));
        }
        this.logError('QUEUE_PERSIST_FAILED', 'TabManager: failed to persist queue', error);
        throw error;
      } finally {
        this.cleanupPersistState();
      }

      return;
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    if (!this.pendingPersistPromise) {
      this.pendingPersistPromise = new Promise<void>((resolve, reject) => {
        this.persistResolve = resolve;
        this.persistReject = reject;
      });
    }

    this.persistTimer = setTimeout(() => {
      this.persistQueue(true).catch((error) => {
        this.logError('QUEUE_PERSIST_FAILED', 'TabManager: scheduled persistence error', error);
      });
    }, this.persistDelayMs);
    this.pruneProgressByTabs();
  }

  async flushPersistence(): Promise<void> {
    if (!this.persistTimer && !this.pendingPersistPromise) {
      return;
    }

    await this.persistQueue(true);
  }

  private cleanupPersistState(): void {
    this.persistTimer = null;
    this.pendingPersistPromise = null;
    this.persistResolve = undefined;
    this.persistReject = undefined;
  }

  private emitStatus(): void {
    const payload = this.createStatusPayload();
    for (const listener of this.statusListeners) {
      try {
        listener(payload);
      } catch (error) {
        this.logError('QUEUE_STATUS_NOTIFY_FAILED', 'TabManager: status listener failed', error);
      }
    }
  }

  private emitProgress(payload: QueueProgressPayload): void {
    for (const listener of this.progressListeners) {
      try {
        listener(payload);
      } catch (error) {
        this.logError('QUEUE_PROGRESS_NOTIFY_FAILED', 'TabManager: progress listener failed', error);
      }
    }
  }

  private emitError(payload: QueueErrorPayload): void {
    for (const listener of this.errorListeners) {
      try {
        listener(payload);
      } catch (error) {
        this.logError('QUEUE_ERROR_NOTIFY_FAILED', 'TabManager: error listener failed', error);
      }
    }
  }

  private pushQueueError(code: string, message: string, detail?: unknown, tabId?: number): void {
    const error = createExtensionError(code, message, detail);
    this.emitError({ ...error, tabId, timestamp: this.now() });
  }

  private emitContentRequest(tabId: number, reason: 'missing' | 'stale'): void {
    const event = { type: 'QUEUE_CONTENT_REQUEST', payload: { tabId, reason } } as const;
    for (const listener of this.commandListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logError('QUEUE_COMMAND_NOTIFY_FAILED', 'TabManager: command listener failed', error);
      }
    }
  }

  private createStatusPayload(): QueueStatusPayload {
    const tabs: SerializedTabInfo[] = this.queue.tabs.map((tab) => toSerializedTabInfo(tab));
    return {
      status: this.queue.status,
      currentIndex: this.queue.currentIndex,
      totalCount: this.queue.tabs.length,
      activeTabId: this.queue.tabs[this.queue.currentIndex]?.tabId ?? null,
      tabs,
      settings: this.queue.settings,
      updatedAt: this.now(),
    };
  }

  private pruneProgressByTabs(): void {
    const validTabIds = new Set(this.queue.tabs.map((tab) => tab.tabId));
    const filtered: Record<number, number> = {};
    for (const [tabId, progress] of Object.entries(this.progressByTab)) {
      const numericId = Number(tabId);
      if (validTabIds.has(numericId)) {
        filtered[numericId] = progress;
      }
    }
    this.progressByTab = filtered;
    this.queue.progressByTab = { ...filtered };
  }

  private async stopInternal(stopPlayback: boolean): Promise<void> {
    if (stopPlayback) {
      try {
        this.playback.stop();
      } catch (error) {
        this.logger.warn('TabManager: playback stop failed', error);
      }
    }
    this.activePlaybackToken = null;
    this.queue.status = 'idle';
    this.queue.currentIndex = this.queue.tabs.length === 0 ? 0 : this.clampIndex(this.queue.currentIndex);
  }

  private async playbackStopSafe(): Promise<void> {
    try {
      this.playback.stop();
    } catch (error) {
      this.logger.warn('TabManager: playback stop error', error);
    }
    this.activePlaybackToken = null;
  }

  private handlePlaybackEnd(token: number): void {
    if (this.activePlaybackToken !== token) {
      return;
    }

    // 完了したタブをキューから除去
    const completedIndex = this.queue.currentIndex;
    if (completedIndex >= 0 && completedIndex < this.queue.tabs.length) {
      this.queue.tabs.splice(completedIndex, 1);
      this.pruneProgressByTabs();
      // currentIndexは変更しない（要素が除去されたので実質的に次を指す）
    }

    // キューが空になった場合
    if (this.queue.tabs.length === 0) {
      this.queue.currentIndex = 0;
      this.stopInternal(false)
        .then(() => this.persistQueue())
        .then(() => this.emitStatus())
        .catch((error) => this.logError('QUEUE_STOP_FAILED', 'TabManager: failed to stop queue', error));
      return;
    }

    // currentIndexが範囲外になった場合の調整
    if (this.queue.currentIndex >= this.queue.tabs.length) {
      this.queue.currentIndex = 0;
    }

    // 次の読み上げ可能なタブを検索
    const nextIndex = this.findNextReadableIndex(this.queue.currentIndex);
    if (nextIndex === -1) {
      this.stopInternal(false)
        .then(() => this.persistQueue())
        .then(() => this.emitStatus())
        .catch((error) => this.logError('QUEUE_STOP_FAILED', 'TabManager: failed to stop queue', error));
      return;
    }

    this.processNext(nextIndex).catch((error) => {
      this.logError('QUEUE_ADVANCE_FAILED', 'TabManager: failed to advance to next tab', error);
    });
  }

  private handlePlaybackError(token: number, error: Error, tabId?: number): void {
    if (this.activePlaybackToken !== token) {
      return;
    }

    this.logError('PLAYBACK_ERROR', 'TabManager: playback error', error);
    this.activePlaybackToken = null;
    this.queue.status = 'error';

    this.pushQueueError('PLAYBACK_ERROR', error.message, error, tabId);

    this.persistQueue().then(() => this.emitStatus());
  }

  private handlePlaybackProgress(token: number, tabId: number, progress: number): void {
    if (this.activePlaybackToken !== token) {
      return;
    }
    const clamped = Math.max(0, Math.min(100, progress));
    this.progressByTab[tabId] = clamped;
    this.queue.progressByTab = { ...this.progressByTab };
    this.emitProgress({
      tabId,
      progress: clamped,
      timestamp: this.now(),
    });
    this.persistQueue().catch((error) => {
      this.logError('QUEUE_PERSIST_FAILED', 'TabManager: failed to persist queue after progress update', error);
    });
  }

  private normalizeTabInfo(tab: TabInfo): TabInfo {
    return {
      ...tab,
      extractedAt: tab.extractedAt instanceof Date
        ? tab.extractedAt
        : new Date(tab.extractedAt ?? Date.now()),
      isIgnored: this.isDomainIgnored(tab.url),
    };
  }

  private refreshIgnoredFlags(): void {
    this.queue.tabs = this.queue.tabs.map((tab) => ({
      ...tab,
      isIgnored: this.isDomainIgnored(tab.url),
    }));
  }

  private resolveInsertIndex(position?: 'start' | 'end' | number): number {
    if (position === undefined || position === 'end') {
      return this.queue.tabs.length;
    }
    if (position === 'start') {
      return 0;
    }
    if (typeof position === 'number' && !Number.isNaN(position)) {
      return this.clampIndex(position, true);
    }
    return this.queue.tabs.length;
  }

  private clampIndex(index: number, allowEnd: boolean = false): number {
    if (this.queue.tabs.length === 0) {
      return 0;
    }
    const max = allowEnd ? this.queue.tabs.length : this.queue.tabs.length - 1;
    const clamped = Math.max(0, Math.min(max, index));
    return clamped;
  }

  private selectNextIndex(startIndex?: number): number {
    if (typeof startIndex === 'number') {
      const direct = this.findNextReadableIndex(startIndex);
      if (direct !== -1) {
        return direct;
      }
    }
    return this.findNextReadableIndex(this.queue.currentIndex);
  }

  private findNextReadableIndex(from: number): number {
    for (let i = Math.max(0, from); i < this.queue.tabs.length; i += 1) {
      if (!this.queue.tabs[i].isIgnored) {
        return i;
      }
    }
    return -1;
  }

  private findPreviousReadableIndex(from: number): number {
    for (let i = Math.min(this.queue.tabs.length - 1, from); i >= 0; i -= 1) {
      if (!this.queue.tabs[i].isIgnored) {
        return i;
      }
    }
    return -1;
  }

  private async ensureTabReady(tab: TabInfo): Promise<boolean> {
    if (tab.isIgnored) {
      return false;
    }

    // Always call resolveContent if available, even if content exists
    // This allows waiting for AI summary/translation before playback
    if (this.resolveContent) {
      try {
        const result = await this.resolveContent(tab);
        if (result && result.content) {
          tab.content = result.content;
          if (result.summary !== undefined) {
            tab.summary = result.summary;
          }
          if (result.translation !== undefined) {
            tab.translation = result.translation;
          }
          if (result.extractedAt) {
            tab.extractedAt = new Date(result.extractedAt);
          }
        } else {
          this.emitContentRequest(tab.tabId, 'missing');
          return false;
        }
      } catch (error) {
        this.logError('CONTENT_RESOLVE_FAILED', 'TabManager: content resolver failed', error);
        this.emitContentRequest(tab.tabId, 'missing');
        return false;
      }
    } else {
      this.emitContentRequest(tab.tabId, 'missing');
      return false;
    }

    // prependフェッチにより、content, summary, translationが既に設定されているため、
    // ここではAI処理は不要。selectPlaybackContent()で優先順位に従って使用される。

    this.enforceContentBudget();
    await this.persistQueue();
    return true;
  }

  private enforceContentBudget(): void {
    let totalChars = 0;
    const activeTab = this.queue.tabs[this.queue.currentIndex] ?? null;
    const reserveId = QUEUE_CONTENT_RESERVE_ACTIVE && activeTab ? activeTab.tabId : null;

    for (let i = this.queue.tabs.length - 1; i >= 0; i -= 1) {
      const tab = this.queue.tabs[i];
      if (!tab.content) {
        continue;
      }

      const contentLength = tab.content.length;
      if (reserveId !== null && tab.tabId === reserveId) {
        continue;
      }

      totalChars += contentLength;
      if (totalChars > QUEUE_CONTENT_CHAR_BUDGET) {
        tab.content = undefined;
        // summary と translation は保持（再生に必要なため）
      }
    }
  }

  private selectPlaybackContent(tab: TabInfo): string | null {
    const translation = tab.translation?.trim();
    if (translation && translation.length > 0) {
      return translation;
    }

    const summary = tab.summary?.trim();
    if (summary && summary.length > 0) {
      return summary;
    }

    const content = tab.content?.trim();
    if (content && content.length > 0) {
      return content;
    }

    return null;
  }

  private logError(code: string, message: string, detail?: unknown): void {
    this.logger.error(...formatErrorLog(code, message, detail));
  }

  private nextPlaybackToken(): number {
    this.playbackTokenSeq += 1;
    return this.playbackTokenSeq;
  }

  private isDomainIgnored(url: string): boolean {
    if (this.ignoredDomains.size === 0) {
      return false;
    }
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.toLowerCase();
      return this.ignoredDomains.has(domain);
    } catch (error) {
      this.logger.debug('TabManager: failed to parse URL for ignore check', url, error);
      return false;
    }
  }
}
