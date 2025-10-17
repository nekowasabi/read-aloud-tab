import { OpenRouterClient } from '../shared/services/openrouter';
import { AiSettings, TabInfo, KeepAliveDiagnostics, STORAGE_KEYS } from '../shared/types';
import { StorageManager } from '../shared/utils/storage';
import { QueueStatusPayload, PrefetchStatusSnapshot } from '../shared/messages';
import { LoggerLike, TabManager } from './tabManager';
import { PrefetchScheduler } from './prefetch/scheduler';
import { PrefetchWorker, PrefetchStatusUpdate } from './prefetch/worker';
import { PrefetchResultStoreImpl } from './prefetch/resultStore';

interface AiPrefetcherOptions {
  tabManager: TabManager;
  logger?: LoggerLike;
  maxPrefetchAhead?: number;
  summaryMaxTokens?: number;
  translationMaxTokens?: number;
  translationTarget?: string;
  settingsTtlMs?: number;
  broadcast?: (message: PrefetchStatusBroadcast) => void;
  storage?: Pick<typeof chrome.storage, 'local'>;
}

const DEFAULT_SUMMARY_MAX_TOKENS = 480;
const DEFAULT_TRANSLATION_MAX_TOKENS = 1200;
const DEFAULT_SETTINGS_TTL = 0;
const STATUS_STORAGE_KEY = 'prefetch_status';

export interface PrefetchStatusBroadcast {
  type: 'PREFETCH_STATUS_SYNC';
  payload: PrefetchStatusSnapshot;
}

export class AiPrefetcher {
  private readonly tabManager: TabManager;
  private readonly logger: LoggerLike;
  private readonly maxPrefetchAhead: number;
  private readonly summaryMaxTokens: number;
  private readonly translationMaxTokens: number;
  private readonly translationTarget: string;
  private readonly settingsTtlMs: number;
  private readonly broadcast: (message: PrefetchStatusBroadcast) => void;
  private readonly storage: Pick<typeof chrome.storage, 'local'>;

  private scheduler: PrefetchScheduler | null = null;
  private worker: PrefetchWorker | null = null;
  private unsubscribeStatus?: () => void;
  private statusMap = new Map<number, PrefetchStatusUpdate & { updatedAt: number }>();
  private keepAliveDiagnostics: KeepAliveDiagnostics | null = null;

  private cachedSettings: AiSettings | null = null;
  private cachedSettingsTimestamp = 0;
  private clientCacheKey: string | null = null;
  private clientInstance: OpenRouterClient | null = null;
  private storageChangeListener?: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

  constructor(options: AiPrefetcherOptions) {
    this.tabManager = options.tabManager;
    this.logger = options.logger || console;
    this.maxPrefetchAhead = options.maxPrefetchAhead ?? 1;
    this.summaryMaxTokens = options.summaryMaxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS;
    this.translationMaxTokens = options.translationMaxTokens ?? DEFAULT_TRANSLATION_MAX_TOKENS;
    this.translationTarget = options.translationTarget ?? 'ja';
    this.settingsTtlMs = options.settingsTtlMs ?? DEFAULT_SETTINGS_TTL;
    this.broadcast = options.broadcast ?? ((message) => {
      try {
        chrome.runtime?.sendMessage?.(message);
      } catch (error) {
        this.logger.warn('AiPrefetcher: failed to broadcast status', error);
      }
    });
    this.storage = options.storage ?? chrome.storage;

    this.setupStorageChangeListener();
  }

  initialize(): void {
    if (this.scheduler || this.worker) {
      return;
    }

    const resultStore = new PrefetchResultStoreImpl({
      storage: this.storage.local,
    });

    const worker = new PrefetchWorker({
      fetchTab: async (tabId) => this.tabManager.getTabById(tabId),
      requestContent: (tabId) => this.tabManager.requestContentForPrefetch(tabId),
      getSettings: () => this.ensureSettings(),
      summarize: (content) => this.summarize(content),
      translate: (text, target) => this.translate(text, target),
      resultStore,
      emitStatus: (update) => this.handleStatusUpdate(update),
      applyUpdates: (tabId, updates) => this.applyUpdates(tabId, updates),
      logger: this.logger,
      translationTarget: this.translationTarget,
    });

    const scheduler = new PrefetchScheduler({
      enqueue: (job) => worker.enqueue(job),
      cancel: (tabId) => worker.cancel(tabId),
      maxPrefetchAhead: this.maxPrefetchAhead,
      logger: this.logger,
    });

    this.worker = worker;
    this.scheduler = scheduler;

    this.unsubscribeStatus = this.tabManager.addStatusListener((payload: QueueStatusPayload) => {
      this.scheduler?.handleStatusUpdate(payload);
      this.pruneStatusMap(payload);
    });

    this.storage.local.get?.('prefetch_status', (items) => {
      const snapshot = items?.prefetch_status as PrefetchStatusSnapshot | undefined;
      if (!snapshot) {
        return;
      }
      this.statusMap = new Map(snapshot.statuses.map((status) => [status.tabId, status]));
      this.keepAliveDiagnostics = snapshot.diagnostics ?? null;
    });
  }

  dispose(): void {
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = undefined;
    this.scheduler = null;
    this.worker = null;
    this.statusMap.clear();
    if (this.storageChangeListener && typeof chrome !== 'undefined' && chrome.storage?.onChanged?.removeListener) {
      chrome.storage.onChanged.removeListener(this.storageChangeListener);
    }
  }

  retry(tabId: number): void {
    this.scheduler?.retry(tabId);
    const entry = { tabId, state: 'pending' as const, updatedAt: Date.now() };
    this.statusMap.set(tabId, entry);
    this.persistStatus();
    this.broadcast({
      type: 'PREFETCH_STATUS_SYNC',
      payload: this.getStatusSnapshot(),
    });
  }

  private setupStorageChangeListener(): void {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged?.addListener) {
      return;
    }

    this.storageChangeListener = (changes, areaName) => {
      if (areaName !== 'sync') {
        return;
      }
      if (STORAGE_KEYS.AI_SETTINGS in changes) {
        this.cachedSettings = null;
        this.cachedSettingsTimestamp = 0;
        this.clientInstance = null;
        this.clientCacheKey = null;
      }
    };

    chrome.storage.onChanged.addListener(this.storageChangeListener);
  }

  getStatusSnapshot(): PrefetchStatusSnapshot {
    const statuses = Array.from(this.statusMap.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    const updatedAt = statuses.length > 0 ? statuses[statuses.length - 1].updatedAt : Date.now();
    return { statuses, updatedAt, diagnostics: this.keepAliveDiagnostics ?? undefined };
  }

  updateKeepAliveDiagnostics(diagnostics: KeepAliveDiagnostics): void {
    this.keepAliveDiagnostics = diagnostics;
    this.persistStatus();
    this.broadcast({
      type: 'PREFETCH_STATUS_SYNC',
      payload: this.getStatusSnapshot(),
    });
  }

  /**
   * Check if prefetch processing is complete for a specific tab
   * Returns true if summary/translation generation is completed or not needed
   */
  isPrefetchComplete(tabId: number): boolean {
    const status = this.statusMap.get(tabId);
    if (!status) {
      // No prefetch status means it hasn't started or isn't needed
      return true;
    }
    return status.state === 'completed' || status.state === 'failed';
  }

  /**
   * Wait for prefetch completion for a specific tab
   * Returns a promise that resolves when prefetch is complete or timeout occurs
   */
  async waitForPrefetch(tabId: number, timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    // Poll status every 100ms
    while (Date.now() - startTime < timeoutMs) {
      if (this.isPrefetchComplete(tabId)) {
        const status = this.statusMap.get(tabId);
        return status?.state === 'completed';
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Timeout
    this.logger.warn(`[AiPrefetcher] Timeout waiting for prefetch completion: tabId=${tabId}`);
    return false;
  }

  private async ensureSettings(): Promise<AiSettings> {
    const now = Date.now();
    if (!this.cachedSettings || this.settingsTtlMs === 0 || now - this.cachedSettingsTimestamp > this.settingsTtlMs) {
      this.cachedSettings = await StorageManager.getAiSettings();
      this.cachedSettingsTimestamp = now;
    }
    return this.cachedSettings;
  }

  private async getClient(settings: AiSettings): Promise<OpenRouterClient> {
    const cacheKey = `${settings.openRouterApiKey}|${settings.openRouterModel}`;
    if (this.clientInstance && this.clientCacheKey === cacheKey) {
      return this.clientInstance;
    }
    const client = new OpenRouterClient(settings.openRouterApiKey, settings.openRouterModel);
    this.clientInstance = client;
    this.clientCacheKey = cacheKey;
    return client;
  }

  private async summarize(content: string): Promise<string> {
    const settings = await this.ensureSettings();
    if (!settings.enableAiSummary) {
      return content;
    }
    const client = await this.getClient(settings);
    const result = await client.summarize(content, this.summaryMaxTokens, settings.summaryPrompt);
    return result.trim();
  }

  private async translate(text: string, target: string): Promise<string> {
    const settings = await this.ensureSettings();
    if (!settings.enableAiTranslation) {
      return text;
    }
    const client = await this.getClient(settings);
    const result = await client.translate(text, target, this.translationMaxTokens, settings.translationPrompt);
    return result.trim();
  }

  private async applyUpdates(tabId: number, updates: Partial<TabInfo>): Promise<void> {
    await this.tabManager.onTabUpdated(tabId, updates);
  }

  private handleStatusUpdate(update: PrefetchStatusUpdate): void {
    const entry = { ...update, updatedAt: Date.now() };
    this.statusMap.set(update.tabId, entry);

    // Clear scheduled status when prefetch completes or fails
    if (update.state === 'completed' || update.state === 'failed') {
      this.scheduler?.clearScheduled(update.tabId);
    }

    this.persistStatus();
    this.broadcast({
      type: 'PREFETCH_STATUS_SYNC',
      payload: this.getStatusSnapshot(),
    });
  }

  private persistStatus(): void {
    try {
      const snapshot = this.getStatusSnapshot();
      this.storage.local.set?.({
        [STATUS_STORAGE_KEY]: snapshot,
      });
    } catch (error) {
      this.logger.warn('AiPrefetcher: failed to persist status snapshot', error);
    }
  }

  private pruneStatusMap(payload: QueueStatusPayload): void {
    const validIds = new Set(payload.tabs.map((tab) => tab.tabId));
    for (const tabId of Array.from(this.statusMap.keys())) {
      if (!validIds.has(tabId)) {
        this.statusMap.delete(tabId);
      }
    }
    this.persistStatus();
  }
}
