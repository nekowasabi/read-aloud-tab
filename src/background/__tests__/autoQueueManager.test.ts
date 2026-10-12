import { AutoQueueManager } from '../autoQueueManager';
import { TabManager } from '../tabManager';
import type { ReadingQueue, TabInfo } from '../../shared/types';
import {
  StorageManager,
  getIgnoredDomains,
  getPendingAutoQueueTabIds,
  setPendingAutoQueueTabIds,
} from '../../shared/utils/storage';

jest.mock('../../shared/utils/storage', () => ({
  StorageManager: { getAutoQueueNewTabs: jest.fn() },
  getIgnoredDomains: jest.fn(),
  getPendingAutoQueueTabIds: jest.fn(),
  setPendingAutoQueueTabIds: jest.fn(),
}));

const storage = StorageManager as jest.Mocked<typeof StorageManager>;
const pending = getPendingAutoQueueTabIds as jest.MockedFunction<typeof getPendingAutoQueueTabIds>;
const savePending = setPendingAutoQueueTabIds as jest.MockedFunction<
  typeof setPendingAutoQueueTabIds
>;
const ignored = getIgnoredDomains as jest.MockedFunction<typeof getIgnoredDomains>;

describe('AutoQueueManager', () => {
  const addTab = jest.fn().mockResolvedValue(undefined);
  const getTabById = jest.fn().mockReturnValue(null);
  const onTabClosed = jest.fn().mockResolvedValue(undefined);
  const manager = new AutoQueueManager({ addTab, getTabById, onTabClosed } as any, () => true);

  beforeEach(() => {
    jest.clearAllMocks();
    addTab.mockResolvedValue(undefined);
    getTabById.mockReturnValue(null);
    storage.getAutoQueueNewTabs.mockResolvedValue(true);
    pending.mockResolvedValue([]);
    ignored.mockResolvedValue([]);
  });

  it('does not re-add a tab already in the queue', async () => {
    getTabById.mockReturnValue({ tabId: 9, url: 'https://example.com' });
    manager.onCreated({ id: 9, url: 'https://example.com', title: 'Example' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).not.toHaveBeenCalled();
    expect(savePending).not.toHaveBeenCalled();
  });

  it('queues a created normal tab once without autoplay', async () => {
    manager.onCreated({ id: 10, url: 'https://example.com', title: 'Example' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ tabId: 10 }), {
      position: 'end',
      autoStart: false,
    });
    expect(savePending).not.toHaveBeenCalled();
  });

  it('persists an empty tab and completes it on its first normal URL', async () => {
    manager.onCreated({ id: 11, url: 'about:blank' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(savePending).toHaveBeenCalledWith([11]);
    pending.mockResolvedValue([11]);
    manager.onUpdated(11, { id: 11, url: 'https://example.com', title: 'Example' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ tabId: 11 }), {
      position: 'end',
      autoStart: false,
    });
    expect(savePending).toHaveBeenLastCalledWith([]);
  });

  it('does not add a tab removed while auto-queue work is pending', async () => {
    let releaseSetting: (() => void) | undefined;
    storage.getAutoQueueNewTabs.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseSetting = () => resolve(true);
        })
    );
    manager.onCreated({ id: 12, url: 'https://example.com', title: 'Example' });
    manager.onRemoved(12);
    await Promise.resolve();
    expect(onTabClosed).toHaveBeenCalledWith(12);
    releaseSetting?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).not.toHaveBeenCalled();
  });

  it('keeps a normal created tab pending when storage fails', async () => {
    ignored.mockRejectedValueOnce(new Error('storage failure'));
    manager.onCreated({ id: 13, url: 'https://example.com' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(savePending).toHaveBeenCalledWith([13]);
  });

  it('uses pendingUrl for URL completion and clears pending when disabled', async () => {
    manager.onCreated({ id: 14, url: 'about:blank' });
    await new Promise(resolve => setTimeout(resolve, 0));
    pending.mockResolvedValue([14]);
    manager.onUpdated(14, { id: 14, url: 'about:blank', pendingUrl: 'https://example.com' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.com' }),
      expect.anything()
    );
    manager.onSettingChanged(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(savePending).toHaveBeenLastCalledWith([]);
  });

  it('deletes the queue entry even when pending cleanup storage fails', async () => {
    pending.mockResolvedValue([15]);
    savePending.mockRejectedValueOnce(new Error('storage failure'));
    manager.onRemoved(15);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onTabClosed).toHaveBeenCalledWith(15);
  });

  it('excludes tabs that already existed at startup', async () => {
    manager.onStartup([16]);
    await new Promise(resolve => setTimeout(resolve, 0));
    manager.onCreated({ id: 16, url: 'https://example.com' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).not.toHaveBeenCalled();
  });

  it('queues a reused tab ID after the startup tab is removed', async () => {
    manager.onStartup([16]);
    await new Promise(resolve => setTimeout(resolve, 0));
    manager.onRemoved(16);
    manager.onCreated({ id: 16, url: 'https://example.com' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ tabId: 16 }), {
      position: 'end',
      autoStart: false,
    });
  });

  it('keeps unreachable Chrome error pages pending', async () => {
    manager.onCreated({ id: 17, url: 'chrome-error://chromewebdata/' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).not.toHaveBeenCalled();
    expect(savePending).toHaveBeenCalledWith([17]);
  });

  it('consumes a pending ignored tab without adding it', async () => {
    pending.mockResolvedValue([18]);
    const ignoredManager = new AutoQueueManager(
      { addTab, getTabById, onTabClosed } as any,
      () => false
    );

    ignoredManager.onUpdated(18, { url: 'https://example.com' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(addTab).not.toHaveBeenCalled();
    expect(savePending).toHaveBeenLastCalledWith([]);
  });

  it('continues the event chain after an add failure', async () => {
    addTab.mockRejectedValueOnce(new Error('add failed'));
    manager.onCreated({ id: 19, url: 'https://example.com' });
    manager.onCreated({ id: 20, url: 'https://example.com' });
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(addTab).toHaveBeenCalledTimes(2);
    expect(savePending).toHaveBeenCalledWith([19]);
  });

  it('does not add a pending tab after it is closed mid-update', async () => {
    manager.onCreated({ id: 21, url: 'about:blank' });
    await new Promise(resolve => setTimeout(resolve, 0));
    pending.mockResolvedValue([21]);
    manager.onUpdated(21, { id: 21, url: 'https://example.com', title: 'Example' });
    manager.onRemoved(21);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).not.toHaveBeenCalled();
    expect(onTabClosed).toHaveBeenCalledWith(21);
  });

  it('does nothing when auto-queue is disabled', async () => {
    storage.getAutoQueueNewTabs.mockResolvedValue(false);
    manager.onCreated({ id: 30, url: 'https://example.com', title: 'Example' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).not.toHaveBeenCalled();
    expect(savePending).not.toHaveBeenCalled();
  });

  it('keeps pending on invalid or internal URL updates', async () => {
    pending.mockResolvedValue([31]);
    manager.onUpdated(31, { id: 31, url: 'not a url' });
    await new Promise(resolve => setTimeout(resolve, 0));
    manager.onUpdated(31, { id: 31, url: 'chrome-error://chromewebdata/' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).not.toHaveBeenCalled();
    expect(savePending).not.toHaveBeenCalled();
  });

  it('clears pending tab IDs on startup', async () => {
    pending.mockResolvedValue([32]);
    manager.onStartup([32]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(savePending).toHaveBeenCalledWith([]);
  });

  it('does not auto-queue an existing tab onUpdated that is not pending', async () => {
    pending.mockResolvedValue([]);
    manager.onUpdated(33, { id: 33, url: 'https://example.com', title: 'Existing' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).not.toHaveBeenCalled();
    expect(savePending).not.toHaveBeenCalled();
  });

  it('runs tab-close handling outside the auto-queue chain', () => {
    let release: (() => void) | undefined;
    storage.getAutoQueueNewTabs.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve(true);
        })
    );
    manager.onCreated({ id: 34, url: 'https://example.com' });
    manager.onRemoved(34);
    expect(onTabClosed).toHaveBeenCalledWith(34);
    expect(addTab).not.toHaveBeenCalled();
    release?.();
  });
});

describe('AutoQueueManager with TabManager', () => {
  const settings = { rate: 1, pitch: 1, volume: 1, voice: null };
  const tab = (tabId: number, content = 'text'): TabInfo => ({
    tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    content,
    playbackText: content,
    isIgnored: false,
    extractedAt: new Date(),
  });

  const flush = async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  it('keeps persisted order and currentIndex when auto-adding an uninitialized queued tab', async () => {
    const persisted: ReadingQueue = {
      tabs: [tab(9), tab(10)],
      currentIndex: 1,
      status: 'idle',
      settings,
    };
    const playback = {
      start: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };
    const tabManager = new TabManager({
      playback,
      storage: {
        load: async () => ({
          ...persisted,
          tabs: persisted.tabs.map(item => ({ ...item })),
        }),
        save: jest.fn().mockResolvedValue(undefined),
      },
      getIgnoredDomains: async () => [],
    });
    const queueManager = new AutoQueueManager(tabManager, () => true);

    queueManager.onCreated({ id: 9, url: 'https://example.com/9', title: 'Tab 9' });
    await flush();

    const snapshot = tabManager.getSnapshot();
    expect(snapshot.tabs.map(item => item.tabId)).toEqual([9, 10]);
    expect(snapshot.currentIndex).toBe(1);
  });

  it('stops playback before processNext when the current tab is closed', async () => {
    const persisted: ReadingQueue = {
      tabs: [tab(101, 'first'), tab(202, 'second')],
      currentIndex: 0,
      status: 'reading',
      settings,
    };
    const playback = {
      start: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };
    const tabManager = new TabManager({
      playback,
      storage: {
        load: async () => ({
          ...persisted,
          tabs: persisted.tabs.map(item => ({ ...item })),
        }),
        save: jest.fn().mockResolvedValue(undefined),
      },
      getIgnoredDomains: async () => [],
    });
    const queueManager = new AutoQueueManager(tabManager, () => true);
    await tabManager.initialize();
    playback.stop.mockClear();
    playback.start.mockClear();

    queueManager.onRemoved(101);
    await flush();
    await flush();

    expect(playback.stop).toHaveBeenCalled();
    expect(playback.start).toHaveBeenCalled();
    expect(playback.stop.mock.invocationCallOrder[0]).toBeLessThan(
      playback.start.mock.invocationCallOrder[0]
    );
  });

  it('does not change an existing queue when auto-queue is disabled', async () => {
    jest.clearAllMocks();
    storage.getAutoQueueNewTabs.mockResolvedValue(false);
    const persisted: ReadingQueue = {
      tabs: [tab(101), tab(202)],
      currentIndex: 0,
      status: 'idle',
      settings,
    };
    const tabManager = new TabManager({
      playback: {
        start: jest.fn().mockResolvedValue(undefined),
        pause: jest.fn(),
        resume: jest.fn(),
        stop: jest.fn(),
        updateSettings: jest.fn(),
      },
      storage: {
        load: async () => ({
          ...persisted,
          tabs: persisted.tabs.map(item => ({ ...item })),
        }),
        save: jest.fn().mockResolvedValue(undefined),
      },
      getIgnoredDomains: async () => [],
    });
    await tabManager.initialize();
    const queueManager = new AutoQueueManager(tabManager, () => true);

    queueManager.onCreated({ id: 303, url: 'https://example.com/303', title: 'Tab 303' });
    await flush();

    const snapshot = tabManager.getSnapshot();
    expect(snapshot.tabs.map(item => item.tabId)).toEqual([101, 202]);
    expect(snapshot.currentIndex).toBe(0);
    expect(savePending).not.toHaveBeenCalled();
  });
});
