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

  constructor(
    private readonly tabManager: TabManager,
    private readonly isCandidate: CandidateCheck
  ) {}

  onCreated(tab: any): void {
    this.enqueue(() => this.handleCreated(tab));
  }
  onUpdated(tabId: number, tab: any): void {
    this.enqueue(() => this.handleUpdated(tabId, tab));
  }
  onRemoved(tabId: number): void {
    this.enqueue(async () => {
      try {
        await this.removePending(tabId);
      } finally {
        await this.tabManager.onTabClosed(tabId);
      }
    });
  }
  onStartup(): void {
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

  private async handleCreated(tab: any): Promise<void> {
    if (!(await StorageManager.getAutoQueueNewTabs()) || typeof tab?.id !== 'number') return;
    tab = { ...tab, url: tab.pendingUrl ?? tab.url };
    const pending = await getPendingAutoQueueTabIds();
    if (this.isNormal(tab)) {
      if ((await this.addIfNeeded(tab)) === 'failed')
        await setPendingAutoQueueTabIds([...pending, tab.id]);
      return;
    }
    if (!pending.includes(tab.id)) await setPendingAutoQueueTabIds([...pending, tab.id]);
  }

  private async handleUpdated(tabId: number, tab: any): Promise<void> {
    if (!(await StorageManager.getAutoQueueNewTabs())) return;
    tab = { ...tab, url: tab.pendingUrl ?? tab.url };
    const pending = await getPendingAutoQueueTabIds();
    if (!pending.includes(tabId)) return;
    if (!this.isNormal(tab)) return;
    const result = await this.addIfNeeded({ ...tab, id: tabId });
    if (result !== 'failed' && this.isValidUrl(tab?.url))
      await setPendingAutoQueueTabIds(pending.filter(id => id !== tabId));
  }

  private async addIfNeeded(tab: any): Promise<AddResult> {
    if (!this.isValidUrl(tab?.url)) return 'failed';
    if (this.tabManager.getTabById(tab.id)) return 'added';
    let ignored: Set<string>;
    try {
      ignored = new Set((await getIgnoredDomains()).map(domain => domain.toLowerCase()));
    } catch {
      return 'failed';
    }
    if (!this.isCandidate(tab, ignored)) return 'ignored';
    if (this.tabManager.getTabById(tab.id)) return 'added';
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
      !['chrome://', 'chrome-extension://', 'about:', 'edge://', 'moz-extension://'].some(prefix =>
        tab.url.startsWith(prefix)
      )
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
}
