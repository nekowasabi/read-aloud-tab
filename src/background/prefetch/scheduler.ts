import { QueueStatusPayload, SerializedTabInfo } from '../../shared/messages';

export interface PrefetchJob {
  tabId: number;
  priority: number;
}

interface LoggerLike {
  debug?: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

interface PrefetchSchedulerOptions {
  enqueue: (job: PrefetchJob) => void;
  cancel: (tabId: number) => void;
  maxPrefetchAhead?: number;
  logger?: LoggerLike;
}

const DEFAULT_PREFETCH_AHEAD = 1;

export class PrefetchScheduler {
  private readonly enqueueJob: (job: PrefetchJob) => void;
  private readonly cancelJob: (tabId: number) => void;
  private readonly maxPrefetchAhead: number;
  private readonly scheduled = new Set<number>();
  private readonly cooldownMap = new Map<number, number>();
  private readonly COOLDOWN_MS = 5000;
  private readonly logger: LoggerLike;
  private onEnqueue?: (tabId: number) => void;

  constructor(options: PrefetchSchedulerOptions) {
    this.enqueueJob = options.enqueue;
    this.cancelJob = options.cancel;
    this.maxPrefetchAhead = options.maxPrefetchAhead ?? DEFAULT_PREFETCH_AHEAD;
    this.logger = options.logger || console;
  }

  setOnEnqueue(callback: (tabId: number) => void): void {
    this.onEnqueue = callback;
  }

  handleStatusUpdate(payload: QueueStatusPayload): void {
    if (!payload.tabs || payload.tabs.length === 0) {
      return;
    }

    if (payload.status === 'error') {
      return;
    }

    const targets = this.collectTargets(payload);
    this.reconcileSchedule(targets.map((tab) => tab.tabId));

    targets.forEach((tab, index) => {
      // Only enqueue if not already scheduled and not in cooldown
      if (!this.scheduled.has(tab.tabId) && !this.isInCooldown(tab.tabId)) {
        this.logger.debug?.(`[Prefetch] Scheduled job for tab ${tab.tabId} with priority ${index}`);
        this.enqueueJob({ tabId: tab.tabId, priority: index });
        this.scheduled.add(tab.tabId);
        this.onEnqueue?.(tab.tabId);
      }
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

  /**
   * Clear scheduled status for a tab (called when prefetch completes)
   * Starts cooldown period to prevent immediate re-scheduling
   */
  clearScheduled(tabId: number): void {
    this.scheduled.delete(tabId);
    this.cooldownMap.set(tabId, Date.now());
  }

  /**
   * Check if a tab is in cooldown period after prefetch completion
   */
  private isInCooldown(tabId: number): boolean {
    const cooldownStart = this.cooldownMap.get(tabId);
    if (!cooldownStart) {
      return false;
    }
    if (Date.now() - cooldownStart >= this.COOLDOWN_MS) {
      this.cooldownMap.delete(tabId);
      return false;
    }
    return true;
  }

  private reconcileSchedule(nextIds: number[]): void {
    const nextSet = new Set(nextIds);
    for (const tabId of Array.from(this.scheduled)) {
      if (!nextSet.has(tabId)) {
        this.logger.debug?.(`[Prefetch] Cancelled job for tab ${tabId}`);
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
