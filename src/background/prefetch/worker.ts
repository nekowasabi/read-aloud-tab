import { AiSettings, TabInfo } from '../../shared/types';
import { PrefetchJob } from './scheduler';

interface PrefetchResult {
  tabId: number;
  summary?: string;
  translation?: string;
  generatedAt: number;
}

export interface PrefetchResultStore {
  save(result: PrefetchResult): Promise<void>;
  get(tabId: number): Promise<PrefetchResult | null>;
  delete(tabId: number): Promise<void>;
  prune(): Promise<void>;
}

export type PrefetchState = 'pending' | 'processing' | 'completed' | 'failed';

export interface PrefetchStatusUpdate {
  tabId: number;
  state: PrefetchState;
  error?: string;
}

interface PrefetchWorkerOptions {
  fetchTab: (tabId: number) => Promise<TabInfo | null>;
  requestContent: (tabId: number) => Promise<void>;
  getSettings: () => Promise<AiSettings>;
  summarize: (content: string) => Promise<string>;
  translate: (text: string, target: string) => Promise<string>;
  resultStore: PrefetchResultStore;
  emitStatus: (update: PrefetchStatusUpdate) => void;
  applyUpdates: (tabId: number, updates: Partial<TabInfo>) => Promise<void>;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  translationTarget?: string;
}

interface QueueEntry extends PrefetchJob {
  enqueuedAt: number;
}

export class PrefetchWorker {
  private readonly fetchTab: (tabId: number) => Promise<TabInfo | null>;
  private readonly requestContent: (tabId: number) => Promise<void>;
  private readonly getSettings: () => Promise<AiSettings>;
  private readonly summarize: (content: string) => Promise<string>;
  private readonly translate: (text: string, target: string) => Promise<string>;
  private readonly resultStore: PrefetchResultStore;
  private readonly emitStatus: (update: PrefetchStatusUpdate) => void;
  private readonly applyUpdates: (tabId: number, updates: Partial<TabInfo>) => Promise<void>;
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>;
  private readonly translationTarget: string;

  private readonly queue: QueueEntry[] = [];
  private readonly cancelled = new Set<number>();
  private processing = false;
  private idleResolvers: Array<() => void> = [];

  constructor(options: PrefetchWorkerOptions) {
    this.fetchTab = options.fetchTab;
    this.requestContent = options.requestContent;
    this.getSettings = options.getSettings;
    this.summarize = options.summarize;
    this.translate = options.translate;
    this.resultStore = options.resultStore;
    this.emitStatus = options.emitStatus;
    this.applyUpdates = options.applyUpdates;
    this.logger = options.logger ?? console;
    this.translationTarget = options.translationTarget ?? 'en';
  }

  enqueue(job: PrefetchJob): void {
    this.queue.push({ ...job, enqueuedAt: Date.now() });
    this.queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
    this.processNext();
  }

  cancel(tabId: number): void {
    this.cancelled.add(tabId);
    this.queue.splice(0, this.queue.length, ...this.queue.filter((entry) => entry.tabId !== tabId));
  }

  async waitForIdle(): Promise<void> {
    if (!this.processing && this.queue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve));
  }

  private resolveIdle(): void {
    if (this.processing || this.queue.length > 0) {
      return;
    }
    while (this.idleResolvers.length > 0) {
      const resolve = this.idleResolvers.shift();
      resolve?.();
    }
  }

  private processNext(): void {
    if (this.processing) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      this.resolveIdle();
      return;
    }

    this.processing = true;
    Promise.resolve()
      .then(async () => {
        if (this.cancelled.has(next.tabId)) {
          this.cancelled.delete(next.tabId);
          return;
        }
        await this.runJob(next);
      })
      .catch((error) => {
        this.logger.error('PrefetchWorker: job failed', error);
        this.emitStatus({ tabId: next.tabId, state: 'failed', error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        this.processing = false;
        this.resolveIdle();
        this.processNext();
      });
  }

  private async runJob(job: QueueEntry): Promise<void> {
    this.emitStatus({ tabId: job.tabId, state: 'processing' });

    const settings = await this.getSettings();
    if (!settings || !settings.openRouterApiKey || settings.openRouterApiKey.trim().length === 0) {
      this.logger.warn('PrefetchWorker: missing API key, skipping job');
      this.emitStatus({ tabId: job.tabId, state: 'failed', error: 'API key not configured' });
      return;
    }

    let tab = await this.fetchTab(job.tabId);
    if (!tab || tab.isIgnored) {
      this.emitStatus({ tabId: job.tabId, state: 'failed', error: 'Tab unavailable' });
      return;
    }

    if (!tab.content || tab.content.trim().length === 0) {
      await this.requestContent(job.tabId);
      tab = await this.fetchTab(job.tabId);
      if (!tab || !tab.content || tab.content.trim().length === 0) {
        this.emitStatus({ tabId: job.tabId, state: 'pending' });
        setTimeout(() => {
          if (!this.cancelled.has(job.tabId)) {
            this.enqueue({ tabId: job.tabId, priority: job.priority });
          }
        }, 500);
        return;
      }
    }

    const summaryNeeded = settings.enableAiSummary !== false;
    const translationNeeded = settings.enableAiTranslation === true;

    let summary: string | undefined;
    let translation: string | undefined;

    if (summaryNeeded) {
      summary = (await this.summarize(tab.content)).trim();
    }

    if (translationNeeded) {
      const translationSource = summary ?? tab.content;
      translation = (await this.translate(translationSource, this.translationTarget)).trim();
    }

    await this.resultStore.save({
      tabId: job.tabId,
      summary,
      translation,
      generatedAt: Date.now(),
    });

    const updates: Partial<TabInfo> = {};
    if (summary) {
      updates.summary = summary;
    }
    if (translation) {
      updates.translation = translation;
    }
    if (Object.keys(updates).length > 0) {
      await this.applyUpdates(job.tabId, updates);
    }

    this.emitStatus({ tabId: job.tabId, state: 'completed' });
    await this.resultStore.prune();
  }
}
