import { PrefetchScheduler } from '../scheduler';
import { QueueStatusPayload, SerializedTabInfo } from '../../../shared/messages';

const baseStatus = (): QueueStatusPayload => ({
  status: 'reading',
  currentIndex: 0,
  totalCount: 0,
  activeTabId: null,
  tabs: [],
  settings: {
    rate: 1,
    pitch: 1,
    volume: 1,
    voice: null,
  },
  updatedAt: Date.now(),
});

const makeTab = (tabId: number, overrides: Partial<SerializedTabInfo> = {}): SerializedTabInfo => ({
  tabId,
  url: overrides.url ?? `https://example.com/${tabId}`,
  title: overrides.title ?? `Tab ${tabId}`,
  isIgnored: overrides.isIgnored ?? false,
  extractedAt: overrides.extractedAt ?? new Date().toISOString(),
  content: overrides.content,
  summary: overrides.summary,
  translation: overrides.translation,
});

describe('PrefetchScheduler', () => {
  it('enqueues next readable tab when queue is in reading state', () => {
    const enqueue = jest.fn();
    const cancel = jest.fn();
    const scheduler = new PrefetchScheduler({
      enqueue,
      cancel,
      maxPrefetchAhead: 1,
    });

    const status = baseStatus();
    status.tabs = [makeTab(1, { content: 'current' }), makeTab(2, { content: 'next' })];
    status.totalCount = status.tabs.length;
    status.activeTabId = 1;

    scheduler.handleStatusUpdate(status);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ tabId: 1, priority: 0 }));
    expect(enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ tabId: 2, priority: 1 }));
  });

  it('schedules prefetch when idle with tabs in queue', () => {
    const enqueue = jest.fn();
    const scheduler = new PrefetchScheduler({ enqueue, cancel: jest.fn(), maxPrefetchAhead: 1 });

    const status = baseStatus();
    status.status = 'idle';
    status.tabs = [makeTab(1), makeTab(2)];
    status.totalCount = 2;
    status.currentIndex = 0;

    scheduler.handleStatusUpdate(status);

    expect(enqueue).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ tabId: 1, priority: 0 }));
  });

  it('skips prefetch when idle with empty queue', () => {
    const enqueue = jest.fn();
    const scheduler = new PrefetchScheduler({ enqueue, cancel: jest.fn(), maxPrefetchAhead: 1 });

    const status = baseStatus();
    status.status = 'idle';
    status.tabs = [];
    status.totalCount = 0;

    scheduler.handleStatusUpdate(status);

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('skips prefetch when status is error', () => {
    const enqueue = jest.fn();
    const scheduler = new PrefetchScheduler({ enqueue, cancel: jest.fn(), maxPrefetchAhead: 1 });

    const status = baseStatus();
    (status as any).status = 'error';
    status.tabs = [makeTab(1)];
    status.totalCount = 1;

    scheduler.handleStatusUpdate(status);

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('cancels pending jobs when tab is removed', () => {
    const enqueue = jest.fn();
    const cancel = jest.fn();
    const scheduler = new PrefetchScheduler({ enqueue, cancel, maxPrefetchAhead: 1 });

    scheduler.markScheduled(42);
    scheduler.cancelPrefetchForTab(42);

    expect(cancel).toHaveBeenCalledWith(42);
    expect(scheduler.isScheduled(42)).toBe(false);
  });

  it('recomputes priorities when status updates change ordering', () => {
    const enqueue = jest.fn();
    const cancel = jest.fn();
    const scheduler = new PrefetchScheduler({ enqueue, cancel, maxPrefetchAhead: 2 });

    const status1 = baseStatus();
    status1.tabs = [makeTab(1), makeTab(2), makeTab(3)];
    status1.totalCount = 3;

    scheduler.handleStatusUpdate(status1);

    // First call should schedule current tab (1) + maxPrefetchAhead (2) = tabs 1, 2, 3
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ tabId: 1, priority: 0 }));
    expect(enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ tabId: 2, priority: 1 }));
    expect(enqueue).toHaveBeenNthCalledWith(3, expect.objectContaining({ tabId: 3, priority: 2 }));

    enqueue.mockClear();

    const status2 = baseStatus();
    status2.currentIndex = 1;
    status2.tabs = [makeTab(1), makeTab(2), makeTab(3)];
    status2.totalCount = 3;
    status2.activeTabId = 2;

    scheduler.handleStatusUpdate(status2);

    // Second call with currentIndex=1 should want tabs 2 and 3
    // All tabs are already scheduled, so no new enqueue calls
    expect(enqueue).toHaveBeenCalledTimes(0);
  });

  describe('onEnqueue callback', () => {
    it('should call onEnqueue with tabId when a job is enqueued', () => {
      const enqueue = jest.fn();
      const onEnqueue = jest.fn();
      const scheduler = new PrefetchScheduler({
        enqueue,
        cancel: jest.fn(),
        maxPrefetchAhead: 1,
      });
      scheduler.setOnEnqueue(onEnqueue);

      const status = baseStatus();
      status.tabs = [makeTab(1), makeTab(2)];
      status.totalCount = 2;

      scheduler.handleStatusUpdate(status);

      // onEnqueue should be called for each newly enqueued tab
      expect(onEnqueue).toHaveBeenCalledTimes(2);
      expect(onEnqueue).toHaveBeenCalledWith(1);
      expect(onEnqueue).toHaveBeenCalledWith(2);
    });

    it('should not call onEnqueue for already scheduled tabs', () => {
      const enqueue = jest.fn();
      const onEnqueue = jest.fn();
      const scheduler = new PrefetchScheduler({
        enqueue,
        cancel: jest.fn(),
        maxPrefetchAhead: 1,
      });
      scheduler.setOnEnqueue(onEnqueue);

      const status = baseStatus();
      status.tabs = [makeTab(1), makeTab(2)];
      status.totalCount = 2;

      scheduler.handleStatusUpdate(status);
      onEnqueue.mockClear();

      // Second call - tabs already scheduled
      scheduler.handleStatusUpdate(status);
      expect(onEnqueue).not.toHaveBeenCalled();
    });

    it('should not call onEnqueue for tabs in cooldown', () => {
      const enqueue = jest.fn();
      const onEnqueue = jest.fn();
      const scheduler = new PrefetchScheduler({
        enqueue,
        cancel: jest.fn(),
        maxPrefetchAhead: 1,
      });
      scheduler.setOnEnqueue(onEnqueue);

      const status = baseStatus();
      status.tabs = [makeTab(1), makeTab(2)];
      status.totalCount = 2;

      scheduler.handleStatusUpdate(status);
      onEnqueue.mockClear();
      enqueue.mockClear();

      // Clear scheduled (starts cooldown)
      scheduler.clearScheduled(1);
      scheduler.clearScheduled(2);

      // Re-trigger — tabs are in cooldown so should not be enqueued
      scheduler.handleStatusUpdate(status);
      expect(onEnqueue).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('should work without onEnqueue set', () => {
      const enqueue = jest.fn();
      const scheduler = new PrefetchScheduler({
        enqueue,
        cancel: jest.fn(),
        maxPrefetchAhead: 1,
      });

      const status = baseStatus();
      status.tabs = [makeTab(1)];
      status.totalCount = 1;

      // Should not throw even without onEnqueue
      expect(() => scheduler.handleStatusUpdate(status)).not.toThrow();
      expect(enqueue).toHaveBeenCalled();
    });
  });

  describe('cooldown after clearScheduled', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('clearScheduled starts cooldown and prevents re-scheduling', () => {
      const enqueue = jest.fn();
      const scheduler = new PrefetchScheduler({
        enqueue,
        cancel: jest.fn(),
        maxPrefetchAhead: 1,
      });

      const status = baseStatus();
      status.tabs = [makeTab(1), makeTab(2)];
      status.totalCount = 2;

      // Initial scheduling
      scheduler.handleStatusUpdate(status);
      expect(enqueue).toHaveBeenCalledTimes(2);
      enqueue.mockClear();

      // Complete prefetch for tab 1 — starts cooldown
      scheduler.clearScheduled(1);
      expect(scheduler.isScheduled(1)).toBe(false);

      // Re-trigger — tab 1 should be blocked by cooldown
      scheduler.handleStatusUpdate(status);
      expect(enqueue).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 1 }),
      );
    });

    it('isInCooldown prevents re-scheduling during cooldown window', () => {
      const enqueue = jest.fn();
      const scheduler = new PrefetchScheduler({
        enqueue,
        cancel: jest.fn(),
        maxPrefetchAhead: 1,
      });

      const status = baseStatus();
      status.tabs = [makeTab(1), makeTab(2)];
      status.totalCount = 2;

      scheduler.handleStatusUpdate(status);
      enqueue.mockClear();

      // Complete both tabs
      scheduler.clearScheduled(1);
      scheduler.clearScheduled(2);

      // Advance time but stay within cooldown (5000ms)
      jest.advanceTimersByTime(3000);

      scheduler.handleStatusUpdate(status);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('cooldown expires after COOLDOWN_MS (5000ms) and tab can be re-scheduled', () => {
      const enqueue = jest.fn();
      const scheduler = new PrefetchScheduler({
        enqueue,
        cancel: jest.fn(),
        maxPrefetchAhead: 1,
      });

      const status = baseStatus();
      status.tabs = [makeTab(1), makeTab(2)];
      status.totalCount = 2;

      scheduler.handleStatusUpdate(status);
      enqueue.mockClear();

      scheduler.clearScheduled(1);
      scheduler.clearScheduled(2);

      // Advance past cooldown
      jest.advanceTimersByTime(5000);

      scheduler.handleStatusUpdate(status);
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 1 }),
      );
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 2 }),
      );
    });
  });
});
