import { TabManager } from '../tabManager';
import type { PlaybackController } from '../tabManager';
import type { TabInfo, TTSSettings } from '../../shared/types';
import { StorageManager } from '../../shared/utils/storage';

jest.mock('../../shared/utils/storage', () => ({
  StorageManager: {
    validateSettings: jest.fn(settings => settings),
    saveSettings: jest.fn(),
    getAiSettings: jest.fn(),
  },
  loadQueue: jest.fn(),
  saveQueue: jest.fn(),
  getIgnoredDomains: jest.fn(),
}));

describe('TabManager.updateSettings §7', () => {
  test('queue reading + summary: updateSettings({rate}) keeps reading, keeps summary, no pause', async () => {
    const mockPlayback: jest.Mocked<PlaybackController> = {
      start: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };

    const tab: TabInfo = {
      tabId: 1,
      url: 'https://example.com',
      title: 'Test Page',
      content: 'Original content',
      isIgnored: false,
      extractedAt: new Date(),
    };

    const initialSettings: TTSSettings = {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      voice: null,
    };

    const { loadQueue, saveQueue } = jest.requireMock('../../shared/utils/storage') as {
      loadQueue: jest.Mock;
      saveQueue: jest.Mock;
    };
    loadQueue.mockResolvedValue({
      tabs: [],
      currentIndex: 0,
      status: 'idle',
      settings: initialSettings,
    });
    saveQueue.mockResolvedValue(undefined);
    (StorageManager.saveSettings as jest.Mock).mockResolvedValue(undefined);

    const manager = new TabManager({
      playback: mockPlayback,
      resolveContent: jest.fn().mockResolvedValue({
        content: tab.content,
        summary: 'Summarized content',
        extractedAt: tab.extractedAt,
      }),
    });

    await manager.initialize();
    await manager.addTab(tab);
    await manager.processNext(0);

    expect(manager.getSnapshot().status).toBe('reading');
    expect(manager.getSnapshot().tabs[0].summary).toBe('Summarized content');

    await manager.updateSettings({ rate: 1.5 });

    const snapshot = manager.getSnapshot();
    expect(snapshot.status).toBe('reading');
    expect(snapshot.tabs[0].summary).toBe('Summarized content');
    expect(mockPlayback.pause).not.toHaveBeenCalled();
    expect(mockPlayback.updateSettings).toHaveBeenCalled();
    expect(snapshot.settings.rate).toBe(1.5);
  });
});
