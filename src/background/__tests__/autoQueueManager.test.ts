import { AutoQueueManager } from '../autoQueueManager';
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
    storage.getAutoQueueNewTabs.mockResolvedValue(true);
    pending.mockResolvedValue([]);
    ignored.mockResolvedValue([]);
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

  it('serializes created and removed events so a removed tab is not left in the queue', async () => {
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
    releaseSetting?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ tabId: 12 }), {
      position: 'end',
      autoStart: false,
    });
    expect(onTabClosed).toHaveBeenCalledWith(12);
    expect(onTabClosed.mock.invocationCallOrder[0]).toBeGreaterThan(
      addTab.mock.invocationCallOrder[0]
    );
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
});
