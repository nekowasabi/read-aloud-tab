import { TabInfo } from '../shared/types';
import {
  getIgnoredDomains,
  getPendingAutoQueueTabIds,
  setPendingAutoQueueTabIds,
  StorageManager,
} from '../shared/utils/storage';
import { TabManager } from './tabManager';

type CandidateCheck = (tab: any, ignored: Set<string>) => boolean;
type AddResult = 'added' | 'ignored' | 'failed';

export class AutoQueueManager {
  private chain: Promise<void> = Promise.resolve();
  private startupTabIds = new Set<number>();
  private tabGenerations = new Map<number, number>();

  constructor(
    private readonly tabManager: TabManager,
    private readonly isCandidate: CandidateCheck
  ) {}

  onCreated(tab: any): void {
    if (typeof tab?.id === 'number' && this.startupTabIds.has(tab.id)) return;
    const generation = this.nextGeneration(tab?.id);
    this.enqueue(() => this.handleCreated(tab, generation));
  }
  onUpdated(tabId: number, tab: any): void {
    const generation = this.tabGenerations.get(tabId) ?? 0;
    this.enqueue(() => this.handleUpdated(tabId, tab, generation));
  }
  onRemoved(tabId: number): void {
    this.startupTabIds.delete(tabId);
    this.nextGeneration(tabId);
    this.enqueue(() => this.removePending(tabId));
    this.tabManager.onTabClosed(tabId).catch(error => console.warn('Failed to close tab', error));
  }
  onStartup(tabIds: number[] = []): void {
    this.startupTabIds = new Set(tabIds);
    this.enqueue(() => setPendingAutoQueueTabIds([]));
  }
  onSettingChanged(enabled: boolean): void {
    if (!enabled) this.enqueue(() => setPendingAutoQueueTabIds([]));
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain
      .then(task)
      .catch(error => console.warn('Auto queue event failed', error));
  }

  private async handleCreated(tab: any, generation: number): Promise<void> {
    if (!(await StorageManager.getAutoQueueNewTabs()) || typeof tab?.id !== 'number') return;
    if (!this.isCurrentGeneration(tab.id, generation)) return;
    tab = { ...tab, url: tab.pendingUrl ?? tab.url };
    const pending = await getPendingAutoQueueTabIds();
    if (!this.isCurrentGeneration(tab.id, generation)) return;
    if (this.isNormal(tab)) {
      if ((await this.addIfNeeded(tab)) === 'failed')
        await setPendingAutoQueueTabIds([...pending, tab.id]);
      return;
    }
    if (!pending.includes(tab.id)) await setPendingAutoQueueTabIds([...pending, tab.id]);
  }

  private async handleUpdated(tabId: number, tab: any, generation: number): Promise<void> {
    if ((this.tabGenerations.get(tabId) ?? 0) !== generation) return;
    if (!(await StorageManager.getAutoQueueNewTabs())) return;
    tab = { ...tab, url: tab.pendingUrl ?? tab.url };
    const pending = await getPendingAutoQueueTabIds();
    if ((this.tabGenerations.get(tabId) ?? 0) !== generation) return;
    if (!pending.includes(tabId)) return;
    if (!this.isNormal(tab)) return;
    const result = await this.addIfNeeded({ ...tab, id: tabId });
    if ((this.tabGenerations.get(tabId) ?? 0) !== generation) return;
    if (result !== 'failed' && this.isValidUrl(tab?.url))
      await setPendingAutoQueueTabIds(pending.filter(id => id !== tabId));
  }

  private async isAlreadyQueued(tabId: number): Promise<boolean> {
    if (typeof this.tabManager.hasQueuedTab === 'function') {
      return this.tabManager.hasQueuedTab(tabId);
    }
    return Boolean(this.tabManager.getTabById(tabId));
  }

  private async addIfNeeded(tab: any): Promise<AddResult> {
    if (!this.isValidUrl(tab?.url)) return 'failed';
    if (await this.isAlreadyQueued(tab.id)) return 'added';
    let ignored: Set<string>;
    try {
      ignored = new Set((await getIgnoredDomains()).map(domain => domain.toLowerCase()));
    } catch {
      return 'failed';
    }
    if (!this.isCandidate(tab, ignored)) return 'ignored';
    if (await this.isAlreadyQueued(tab.id)) return 'added';
    const tabInfo: TabInfo = {
      tabId: tab.id,
      url: tab.url,
      title: tab.title || tab.url,
      isIgnored: false,
      extractedAt: new Date(),
    };
    try {
      await this.tabManager.addTab(tabInfo, { position: 'end', autoStart: false });
      return 'added';
    } catch {
      return 'failed';
    }
  }

  private isNormal(tab: any): boolean {
    return (
      this.isValidUrl(tab?.url) &&
      ![
        'chrome://',
        'chrome-error://',
        'chrome-extension://',
        'about:',
        'edge://',
        'moz-extension://',
      ].some(prefix => tab.url.startsWith(prefix))
    );
  }

  private isValidUrl(url: unknown): url is string {
    if (typeof url !== 'string' || !url) return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  private async removePending(tabId: number): Promise<void> {
    const pending = await getPendingAutoQueueTabIds();
    if (pending.includes(tabId))
      await setPendingAutoQueueTabIds(pending.filter(id => id !== tabId));
  }

  private nextGeneration(tabId: unknown): number {
    if (typeof tabId !== 'number') return 0;
    const generation = (this.tabGenerations.get(tabId) ?? 0) + 1;
    this.tabGenerations.set(tabId, generation);
    return generation;
  }

  private isCurrentGeneration(tabId: number, generation: number): boolean {
    return this.tabGenerations.get(tabId) === generation;
  }
}
