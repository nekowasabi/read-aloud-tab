import { TabManager, PlaybackController } from '../tabManager';
import { ReadingQueue, TabInfo, TTSSettings } from '../../shared/types';

const createPlaybackStub = (): PlaybackController => ({
  start: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn(),
  resume: jest.fn(),
  stop: jest.fn(),
  updateSettings: jest.fn(),
});

const defaultQueue: ReadingQueue = {
  tabs: [],
  currentIndex: 0,
  status: 'idle',
  settings: { rate: 1, pitch: 1, volume: 1, voice: null },
};

const createTab = (id: number, contentLength = 0): TabInfo => ({
  tabId: id,
  url: `https://example.com/${id}`,
  title: `Tab ${id}`,
  content: contentLength ? 'x'.repeat(contentLength) : undefined,
  summary: undefined,
  isIgnored: false,
  extractedAt: new Date(),
});

const createManager = async (options: {
  queue?: ReadingQueue;
  playback?: PlaybackController;
  save?: jest.Mock;
  load?: jest.Mock;
  settings?: TTSSettings;
  resolveContent?: jest.Mock;
} = {}) => {
  const playback = options.playback ?? createPlaybackStub();
  const load = options.load ?? jest.fn().mockResolvedValue(options.queue ?? { ...defaultQueue });
  const save = options.save ?? jest.fn().mockResolvedValue(undefined);

  const manager = new TabManager({
    playback,
    storage: {
      load,
      save,
    },
    resolveContent: options.resolveContent,
    logger: console,
  });

  await manager.initialize();
  return { manager, playback, save, load };
};

describe('TabManager performance features', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('debounces queue persistence for rapid mutations', async () => {
    jest.useFakeTimers();
    const save = jest.fn().mockResolvedValue(undefined);
    const { manager } = await createManager({ save });

    save.mockClear();

    await manager.addTab(createTab(1));
    await manager.addTab(createTab(2));
    await manager.addTab(createTab(3));

    expect(save).not.toHaveBeenCalled();

    await manager.flushPersistence();

    expect(save).toHaveBeenCalledTimes(1);
  });

  test('enforces content budget by trimming older tab contents', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const { manager } = await createManager({ save });

    const large = 60_000;
    await manager.addTab(createTab(10, large));
    await manager.addTab(createTab(11, large));
    await manager.addTab(createTab(12, large));

    await manager.flushPersistence();

    const snapshot = manager.getSnapshot();
    const withContent = snapshot.tabs.filter((tab) => tab.content);

    expect(withContent.length).toBeLessThanOrEqual(2);
    const nonCurrentTrimmed = snapshot.tabs.some((tab, idx) => idx !== snapshot.currentIndex && !tab.content);
    expect(nonCurrentTrimmed).toBe(true);
  });

  test('pauses and resumes around tab reload events', async () => {
    const playback = createPlaybackStub();
    const { manager } = await createManager({ playback });

    const tab = createTab(99, 10);
    await manager.addTab(tab);
    await manager.processNext();

    await manager.onTabLoading(99);

    expect(playback.pause).toHaveBeenCalled();
    expect(manager.getSnapshot().status).toBe('paused');

    // Simulate content being provided directly in the update
    await manager.onTabUpdated(99, { url: tab.url, title: tab.title, content: 'reloaded content' });

    // Should auto-resume when content is added to the current paused tab
    expect(playback.start).toHaveBeenCalledTimes(2);
  });
});
