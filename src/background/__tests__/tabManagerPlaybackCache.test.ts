/**
 * TabManager playbackText キャッシュ短絡のユニットテスト (Process 11)
 *
 * 検証目標:
 * - tab.playbackText 有 → resolveContent spy 0 回呼出（2周目API実行ゼロ要件）
 * - tab.playbackText 有 → selectPlaybackContent が playbackText を返す
 * - tab.playbackText 無 → resolveContent spy が呼ばれる（従来動作継続）
 * - 1周目 processNext 後に playbackText が書込・storage.local に永続化される
 * - write-once: playbackText 設定済みタブで再生しても値が上書きされない
 *
 * RED 起点: Process 01 実装前は全テストが失敗する（TabInfo.playbackText 未存在）
 */
import { TabManager } from '../tabManager';
import type { PlaybackController } from '../tabManager';
import type { TabInfo } from '../../shared/types';
import { loadQueue, saveQueue } from '../../shared/utils/storage';

jest.mock('../aiProcessor', () => ({
  AiProcessor: jest.fn().mockImplementation(() => ({
    updateSettings: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(false),
    processContent: jest.fn(),
  })),
}));

jest.mock('../../shared/utils/storage', () => {
  const loadQueue = jest.fn();
  const saveQueue = jest.fn();
  return {
    StorageManager: {
      getAiSettings: jest.fn().mockResolvedValue({
        openRouterApiKey: null,
        openRouterModel: null,
        enableAiSummary: false,
        enableAiTranslation: false,
        summaryPrompt: '',
        translationPrompt: '',
      }),
      validateSettings: jest.fn((settings) => settings),
      saveSettings: jest.fn(),
    },
    loadQueue,
    saveQueue,
    getIgnoredDomains: jest.fn().mockResolvedValue([]),
  };
});

// ── ヘルパー ──────────────────────────────────────────────────────────────────

function createTabWithPlaybackText(text: string): TabInfo {
  return {
    tabId: 1,
    url: 'https://example.com',
    title: 'Cached Tab',
    content: 'original content',
    isIgnored: false,
    extractedAt: new Date(),
    playbackText: text,
  };
}

function createTabWithoutPlaybackText(): TabInfo {
  return {
    tabId: 2,
    url: 'https://example.com/fresh',
    title: 'Fresh Tab',
    content: 'fresh content',
    isIgnored: false,
    extractedAt: new Date(),
  };
}

// ── テストスイート ────────────────────────────────────────────────────────────

describe('TabManager playbackText キャッシュ短絡 (Process 11)', () => {
  let manager: TabManager;
  let playback: jest.Mocked<PlaybackController>;
  let mockResolveContent: jest.Mock;
  let mockSaveQueue: jest.MockedFunction<typeof saveQueue>;
  let mockLoadQueue: jest.MockedFunction<typeof loadQueue>;

  const initialTTSSettings = { rate: 1, pitch: 1, volume: 1, voice: null };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockLoadQueue = loadQueue as jest.MockedFunction<typeof loadQueue>;
    mockSaveQueue = saveQueue as jest.MockedFunction<typeof saveQueue>;

    mockLoadQueue.mockResolvedValue({
      tabs: [],
      currentIndex: 0,
      status: 'idle',
      settings: initialTTSSettings,
    });
    mockSaveQueue.mockResolvedValue(undefined);

    playback = {
      start: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };

    mockResolveContent = jest.fn().mockImplementation((tab: TabInfo) =>
      Promise.resolve({
        content: tab.content ?? 'resolved content',
        extractedAt: tab.extractedAt,
      })
    );

    manager = new TabManager({
      playback,
      resolveContent: mockResolveContent,
    });

    await manager.initialize();
  });

  // ── テスト 1: 短絡ガード — resolveContent 0 回 ──────────────────────────────

  test('tab.playbackText が設定済みの場合、resolveContent が呼ばれない', async () => {
    // Arrange
    const tab = createTabWithPlaybackText('cached text');
    await manager.addTab(tab);

    // Act
    await manager.processNext(0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert — 2周目API実行ゼロ要件 (Done-Definition D3)
    expect(mockResolveContent).not.toHaveBeenCalled();
  });

  // ── テスト 2: 短絡ガード — selectPlaybackContent が playbackText を返す ─────

  test('tab.playbackText が設定済みの場合、playbackText がそのまま再生に使用される', async () => {
    // Arrange
    const cachedText = 'cached playback text';
    const tab = createTabWithPlaybackText(cachedText);
    await manager.addTab(tab);

    // Act
    await manager.processNext(0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert — playback.start に渡された content が playbackText と一致する
    expect(playback.start).toHaveBeenCalledWith(
      expect.objectContaining({ content: cachedText }),
      expect.anything(),
      expect.anything()
    );
  });

  // ── テスト 3: 非短絡パス — playbackText 無 → resolveContent が呼ばれる ──────

  test('tab.playbackText が未設定の場合、resolveContent が呼ばれる', async () => {
    // Arrange
    const tab = createTabWithoutPlaybackText();
    await manager.addTab(tab);

    // Act
    await manager.processNext(0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert — 従来動作継続
    expect(mockResolveContent).toHaveBeenCalledTimes(1);
  });

  // ── テスト 4: write-once 書込と永続化 ────────────────────────────────────────

  test('1周目の processNext 後に tab.playbackText が書き込まれ、saveQueue に永続化される', async () => {
    // Arrange
    const resolvedContent = 'resolved fresh content';
    mockResolveContent.mockResolvedValueOnce({
      content: resolvedContent,
      extractedAt: new Date(),
    });

    const tab = createTabWithoutPlaybackText();
    await manager.addTab(tab);

    // Act
    await manager.processNext(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await manager.flushPersistence();

    // Assert — snapshot で playbackText が書き込まれている
    const snapshot = manager.getSnapshot();
    expect(snapshot.tabs[0].playbackText).toBeTruthy();

    // Assert — saveQueue の保存引数 (queue.tabs[].playbackText) で永続化を確認
    // playbackText は ReadingQueue.tabs[] に含まれて storage.local に保存される
    const lastCallIdx = mockSaveQueue.mock.calls.length - 1;
    const savedQueue = mockSaveQueue.mock.calls[lastCallIdx]?.[0];
    expect(savedQueue?.tabs[0].playbackText).toBeTruthy();
  });

  // ── テスト 5: write-once — 上書き禁止 ────────────────────────────────────────

  test('playbackText が既に設定済みのタブで processNext しても値が上書きされない', async () => {
    // Arrange
    const original = 'original cached text';
    const tab = createTabWithPlaybackText(original);
    await manager.addTab(tab);

    // Act
    await manager.processNext(0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert — 値が変化しない
    const snapshot = manager.getSnapshot();
    expect(snapshot.tabs[0].playbackText).toBe(original);
  });
});
