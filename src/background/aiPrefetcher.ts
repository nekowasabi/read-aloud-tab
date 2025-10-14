import { OpenRouterClient } from '../shared/services/openrouter';
import { AiSettings, TabInfo } from '../shared/types';
import { StorageManager } from '../shared/utils/storage';
import { QueueStatusPayload, SerializedTabInfo } from '../shared/messages';
import { LoggerLike, TabManager } from './tabManager';

interface AiPrefetcherOptions {
  tabManager: TabManager;
  logger?: LoggerLike;
  maxPrefetchAhead?: number;
  summaryMaxTokens?: number;
  translationMaxTokens?: number;
  translationTarget?: string;
  settingsTtlMs?: number;
  contentRequestThrottleMs?: number;
  createClient?: (apiKey: string, model: string) => OpenRouterClient;
  loadSettings?: () => Promise<AiSettings>;
}

const DEFAULT_SUMMARY_MAX_TOKENS = 480;
const DEFAULT_TRANSLATION_MAX_TOKENS = 1200;
const DEFAULT_PREFETCH_AHEAD = 1;
const DEFAULT_SETTINGS_TTL = 60_000;
const DEFAULT_CONTENT_REQUEST_THROTTLE = 5_000;

type TabManagerStatusListener = (payload: QueueStatusPayload) => void;

/**
 * AI Prefetcher
 * - Listens to queue status updates
 * - Prefetches AI summaries/translations for current and upcoming tabs
 * - Ensures content is requested ahead of playback to reduce waiting time
 */
export class AiPrefetcher {
  private readonly tabManager: TabManager;
  private readonly logger: LoggerLike;
  private readonly maxPrefetchAhead: number;
  private readonly summaryMaxTokens: number;
  private readonly translationMaxTokens: number;
  private readonly translationTarget: string;
  private readonly settingsTtlMs: number;
  private readonly contentRequestThrottleMs: number;
  private readonly createClient: (apiKey: string, model: string) => OpenRouterClient;
  private readonly loadSettings: () => Promise<AiSettings>;

  private unsubscribeStatus?: () => void;
  private inFlight = new Map<number, Promise<void>>();
  private contentRequestTimestamps = new Map<number, number>();

  private cachedSettings: AiSettings | null = null;
  private cachedSettingsTimestamp = 0;
  private clientCacheKey: string | null = null;
  private clientInstance: OpenRouterClient | null = null;

  private statusListener: TabManagerStatusListener = (payload) => {
    this.handleStatusUpdate(payload).catch((error) => {
      this.logger.error('AiPrefetcher: failed to handle status update', error);
    });
  };

  constructor(options: AiPrefetcherOptions) {
    this.tabManager = options.tabManager;
    this.logger = options.logger || console;
    this.maxPrefetchAhead = options.maxPrefetchAhead ?? DEFAULT_PREFETCH_AHEAD;
    this.summaryMaxTokens = options.summaryMaxTokens ?? DEFAULT_SUMMARY_MAX_TOKENS;
    this.translationMaxTokens = options.translationMaxTokens ?? DEFAULT_TRANSLATION_MAX_TOKENS;
    this.translationTarget = options.translationTarget ?? 'ja';
    this.settingsTtlMs = options.settingsTtlMs ?? DEFAULT_SETTINGS_TTL;
    this.contentRequestThrottleMs = options.contentRequestThrottleMs ?? DEFAULT_CONTENT_REQUEST_THROTTLE;
    this.createClient = options.createClient ?? ((apiKey, model) => new OpenRouterClient(apiKey, model));
    this.loadSettings = options.loadSettings ?? (() => StorageManager.getAiSettings());
  }

  initialize(): void {
    if (this.unsubscribeStatus) {
      return;
    }
    this.unsubscribeStatus = this.tabManager.addStatusListener(this.statusListener);
  }

  dispose(): void {
    if (this.unsubscribeStatus) {
      this.unsubscribeStatus();
      this.unsubscribeStatus = undefined;
    }
    this.inFlight.clear();
  }

  private async handleStatusUpdate(payload: QueueStatusPayload): Promise<void> {
    if (!payload.tabs || payload.tabs.length === 0) {
      return;
    }

    if (!['reading', 'paused'].includes(payload.status)) {
      return;
    }

    const targets = this.collectPrefetchTargets(payload);
    if (targets.length === 0) {
      return;
    }

    const settings = await this.ensureSettings();
    if (!settings) {
      return;
    }

    for (const tab of targets) {
      this.enqueuePrefetch(tab.tabId, settings);
    }
  }

  private collectPrefetchTargets(payload: QueueStatusPayload): SerializedTabInfo[] {
    const targets: SerializedTabInfo[] = [];

    const current = payload.tabs[payload.currentIndex] ?? null;
    if (current && !current.isIgnored) {
      targets.push(current);
    }

    if (this.maxPrefetchAhead <= 0) {
      return targets;
    }

    let collected = 0;
    for (let index = payload.currentIndex + 1; index < payload.tabs.length; index += 1) {
      const candidate = payload.tabs[index];
      if (!candidate || candidate.isIgnored) {
        continue;
      }
      targets.push(candidate);
      collected += 1;
      if (collected >= this.maxPrefetchAhead) {
        break;
      }
    }

    return targets;
  }

  private enqueuePrefetch(tabId: number, settings: AiSettings): void {
    if (this.inFlight.has(tabId)) {
      return;
    }

    const task = this.runPrefetch(tabId, settings)
      .catch((error) => {
        this.logger.warn('AiPrefetcher: prefetch task failed', error);
      })
      .finally(() => {
        this.inFlight.delete(tabId);
      });

    this.inFlight.set(tabId, task);
  }

  private async runPrefetch(tabId: number, settings: AiSettings): Promise<void> {
    const tab = this.tabManager.getTabById(tabId);
    if (!tab || tab.isIgnored) {
      return;
    }

    const needsSummary = settings.enableAiSummary && (!tab.summary || tab.summary.trim().length === 0);
    const needsTranslation =
      settings.enableAiTranslation && (!tab.translation || tab.translation.trim().length === 0);

    if (!needsSummary && !needsTranslation) {
      return;
    }

    if (!settings.openRouterApiKey || settings.openRouterApiKey.trim().length === 0) {
      this.logger.warn('AiPrefetcher: OpenRouter API key is not configured; skipping prefetch');
      return;
    }

    const now = Date.now();
    if (!tab.content || tab.content.trim().length === 0) {
      const lastRequestAt = this.contentRequestTimestamps.get(tabId) ?? 0;
      if (now - lastRequestAt >= this.contentRequestThrottleMs) {
        try {
          await this.tabManager.requestContentForPrefetch(tabId);
        } catch (error) {
          this.logger.warn('AiPrefetcher: failed to request content for tab', tabId, error);
        }
        this.contentRequestTimestamps.set(tabId, now);
      }
      return;
    }

    const client = this.getClient(settings);
    const updates: Partial<TabInfo> = {};

    if (needsSummary) {
      try {
        const summary = await client.summarize(tab.content, this.summaryMaxTokens);
        updates.summary = summary.trim();
      } catch (error) {
        this.logger.warn('AiPrefetcher: summary generation failed', error);
      }
    }

    if (needsTranslation) {
      try {
        const translation = await client.translate(tab.content, this.translationTarget, this.translationMaxTokens);
        updates.translation = translation.trim();
      } catch (error) {
        this.logger.warn('AiPrefetcher: translation generation failed', error);
      }
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    try {
      await this.tabManager.onTabUpdated(tabId, updates);
    } catch (error) {
      this.logger.error('AiPrefetcher: failed to apply AI updates to tab', error);
    }
  }

  private async ensureSettings(): Promise<AiSettings | null> {
    const now = Date.now();
    if (this.cachedSettings && now - this.cachedSettingsTimestamp < this.settingsTtlMs) {
      if (this.isAiEnabled(this.cachedSettings)) {
        return this.cachedSettings;
      }
      return null;
    }

    try {
      const settings = await this.loadSettings();
      this.cachedSettings = settings;
      this.cachedSettingsTimestamp = now;
      if (!this.isAiEnabled(settings)) {
        return null;
      }
      return settings;
    } catch (error) {
      this.logger.warn('AiPrefetcher: failed to load AI settings', error);
      return null;
    }
  }

  private isAiEnabled(settings: AiSettings): boolean {
    if (!settings.openRouterApiKey || settings.openRouterApiKey.trim().length === 0) {
      return false;
    }
    return settings.enableAiSummary || settings.enableAiTranslation;
  }

  private getClient(settings: AiSettings): OpenRouterClient {
    const cacheKey = `${settings.openRouterApiKey}|${settings.openRouterModel}`;
    if (!this.clientInstance || this.clientCacheKey !== cacheKey) {
      this.clientInstance = this.createClient(settings.openRouterApiKey, settings.openRouterModel);
      this.clientCacheKey = cacheKey;
    }
    return this.clientInstance;
  }
}
