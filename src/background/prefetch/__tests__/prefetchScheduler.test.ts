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

  it('stops scheduling when status is not reading/paused', () => {
    const enqueue = jest.fn();
    const scheduler = new PrefetchScheduler({ enqueue, cancel: jest.fn(), maxPrefetchAhead: 1 });

    const status = baseStatus();
    status.status = 'idle';
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
    const scheduler = new PrefetchScheduler({ enqueue, cancel: jest.fn(), maxPrefetchAhead: 2 });

    const status1 = baseStatus();
    status1.tabs = [makeTab(1), makeTab(2), makeTab(3)];
    status1.totalCount = 3;

    scheduler.handleStatusUpdate(status1);

    enqueue.mockClear();

    const status2 = baseStatus();
    status2.currentIndex = 1;
    status2.tabs = [makeTab(1), makeTab(2), makeTab(3)];
    status2.totalCount = 3;
    status2.activeTabId = 2;

    scheduler.handleStatusUpdate(status2);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ tabId: 2, priority: 0 }));
    expect(enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ tabId: 3, priority: 1 }));
  });
});
