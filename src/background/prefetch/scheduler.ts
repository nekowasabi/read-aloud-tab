import { QueueStatusPayload, SerializedTabInfo } from '../../shared/messages';

export interface PrefetchJob {
  tabId: number;
  priority: number;
}

interface PrefetchSchedulerOptions {
  enqueue: (job: PrefetchJob) => void;
  cancel: (tabId: number) => void;
  maxPrefetchAhead?: number;
}

const DEFAULT_PREFETCH_AHEAD = 1;

export class PrefetchScheduler {
  private readonly enqueueJob: (job: PrefetchJob) => void;
  private readonly cancelJob: (tabId: number) => void;
  private readonly maxPrefetchAhead: number;
  private readonly scheduled = new Set<number>();

  constructor(options: PrefetchSchedulerOptions) {
    this.enqueueJob = options.enqueue;
    this.cancelJob = options.cancel;
    this.maxPrefetchAhead = options.maxPrefetchAhead ?? DEFAULT_PREFETCH_AHEAD;
  }

  handleStatusUpdate(payload: QueueStatusPayload): void {
    if (!payload.tabs || payload.tabs.length === 0) {
      return;
    }

    if (!['reading', 'paused'].includes(payload.status)) {
      return;
    }

    const targets = this.collectTargets(payload);
    this.reconcileSchedule(targets.map((tab) => tab.tabId));

    targets.forEach((tab, index) => {
      this.enqueueJob({ tabId: tab.tabId, priority: index });
      this.scheduled.add(tab.tabId);
    });
  }

  cancelPrefetchForTab(tabId: number): void {
    if (!this.scheduled.has(tabId)) {
      return;
    }
    this.cancelJob(tabId);
    this.scheduled.delete(tabId);
  }

  markScheduled(tabId: number): void {
    this.scheduled.add(tabId);
  }

  isScheduled(tabId: number): boolean {
    return this.scheduled.has(tabId);
  }

  retry(tabId: number): void {
    this.cancelPrefetchForTab(tabId);
    this.enqueueJob({ tabId, priority: 0 });
    this.scheduled.add(tabId);
  }

  private reconcileSchedule(nextIds: number[]): void {
    const nextSet = new Set(nextIds);
    for (const tabId of Array.from(this.scheduled)) {
      if (!nextSet.has(tabId)) {
        this.cancelJob(tabId);
        this.scheduled.delete(tabId);
      }
    }
  }

  private collectTargets(payload: QueueStatusPayload): SerializedTabInfo[] {
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
}
