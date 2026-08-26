/**
 * TabManager ループ制御のユニットテスト (Process 10)
 *
 * 検証目標:
 * Case A: loopEnabled=true、末尾タブ読了 → currentIndex=0（先頭 wrap）、splice されない、再生継続
 * Case B: loopEnabled=true、中間タブ読了 → currentIndex=completedIndex+1、splice されない
 * Case C: loopEnabled=false、末尾読了 → splice 除去・キュー空・status='idle'（回帰ゲート）
 * Case D: loopEnabled=true、全タブ isIgnored → stopInternal(false) → status='idle'
 * Case E: loopEnabled=true、唯一タブ → 同一タブ再生継続（currentIndex=0）
 *
 * RED 期待: Case A / B / D / E（loopEnabled=true の新規挙動）
 * GREEN 期待: Case C（loopEnabled=false の既存挙動 — 回帰ゲート）
 *
 * Process 02 実装後に全 Case GREEN となる。
 */
import { TabManager } from '../tabManager';
import type { PlaybackController } from '../tabManager';
import type { TabInfo, ReadingQueue, TTSSettings } from '../../shared/types';
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

const initialSettings: TTSSettings = { rate: 1, pitch: 1, volume: 1, voice: null };

function createMockTab(tabId: number, isIgnored = false): TabInfo {
  return {
    tabId,
    url: `https://example.com/${tabId}`,
    title: `Tab ${tabId}`,
    content: `Content for tab ${tabId}`,
    isIgnored,
    extractedAt: new Date(),
  };
}

// ── テストスイート ────────────────────────────────────────────────────────────

describe('TabManager ループ制御 (Process 10)', () => {
  let manager: TabManager;
  let playback: jest.Mocked<PlaybackController>;
  let onEndCallback: (() => void) | null = null;
  let mockResolveContent: jest.Mock;

  const mockedLoadQueue = loadQueue as jest.MockedFunction<typeof loadQueue>;
  const mockedSaveQueue = saveQueue as jest.MockedFunction<typeof saveQueue>;

  function buildInitialQueue(
    tabs: TabInfo[],
    currentIndex: number,
    loopEnabled?: boolean
  ): ReadingQueue {
    const queue: ReadingQueue = {
      tabs,
      currentIndex,
      status: 'reading',
      settings: initialSettings,
      loopEnabled,
    };
    return queue;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    onEndCallback = null;

    mockedSaveQueue.mockResolvedValue(undefined);

    playback = {
      start: jest.fn().mockImplementation((_tab, _settings, hooks) => {
        onEndCallback = hooks?.onEnd ?? null;
        return Promise.resolve();
      }),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      updateSettings: jest.fn(),
    };

    mockResolveContent = jest.fn().mockImplementation((tab: TabInfo) =>
      Promise.resolve({
        content: tab.content ?? `Content for tab ${tab.tabId}`,
        extractedAt: tab.extractedAt,
      })
    );

    manager = new TabManager({
      playback,
      resolveContent: mockResolveContent,
    });
  });

  // ── Case A: loopEnabled=true、末尾タブ読了 → 先頭 wrap ────────────────────

  test('Case A: loopEnabled=true で末尾タブ完了後、currentIndex=0 に戻り再生継続する', async () => {
    // Arrange: tabs=[t0, t1, t2], currentIndex=2, loopEnabled=true
    const tabs = [createMockTab(101), createMockTab(202), createMockTab(303)];
    mockedLoadQueue.mockResolvedValue(buildInitialQueue(tabs, 2, true));

    await manager.initialize();
    // 末尾タブ(index=2)から再生開始
    await manager.processNext(2);

    // Act: 読み上げ完了をトリガー
    if (onEndCallback) {
      onEndCallback();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert
    await manager.flushPersistence();

    const snapshot = manager.getSnapshot();
    // splice されず 3 タブのまま
    expect(snapshot.tabs).toHaveLength(3);
    // currentIndex が 0 に巻き戻る
    expect(snapshot.currentIndex).toBe(0);
    // 再生継続（status が reading）
    expect(snapshot.status).toBe('reading');
    // playback.start が 2 回呼ばれている（初回 + wrap 後の再生）
    expect(playback.start).toHaveBeenCalledTimes(2);
  });

  // ── Case B: loopEnabled=true、中間タブ読了 → completedIndex+1 ─────────────

  test('Case B: loopEnabled=true で中間タブ完了後、currentIndex が次インデックスに進み splice されない', async () => {
    // Arrange: tabs=[t0, t1, t2], currentIndex=1, loopEnabled=true
    const tabs = [createMockTab(101), createMockTab(202), createMockTab(303)];
    mockedLoadQueue.mockResolvedValue(buildInitialQueue(tabs, 1, true));

    await manager.initialize();
    await manager.processNext(1);

    // Act: 読み上げ完了をトリガー
    if (onEndCallback) {
      onEndCallback();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await manager.flushPersistence();

    const snapshot = manager.getSnapshot();
    // splice されず 3 タブのまま
    expect(snapshot.tabs).toHaveLength(3);
    // currentIndex が 2 へ進む（completedIndex+1）
    expect(snapshot.currentIndex).toBe(2);
  });

  // ── Case C: loopEnabled=false、末尾読了 → idle 回帰ゲート ──────────────────
  // 注意: これは GREEN ベースライン。Process 02 実装前から通過する。

  test('Case C: loopEnabled=false で末尾タブ完了後、キューが空になり status=idle になる（回帰ゲート）', async () => {
    // Arrange: tabs=[t0], currentIndex=0, loopEnabled=false
    const tabs = [createMockTab(101)];
    mockedLoadQueue.mockResolvedValue(buildInitialQueue(tabs, 0, false));

    await manager.initialize();
    await manager.processNext(0);

    // Act
    if (onEndCallback) {
      onEndCallback();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await manager.flushPersistence();

    const snapshot = manager.getSnapshot();
    // 既存動作: splice でタブが除去されキューが空
    expect(snapshot.tabs).toHaveLength(0);
    expect(snapshot.status).toBe('idle');
  });

  // ── Case D: loopEnabled=true、全タブ isIgnored → idle ────────────────────

  test('Case D: loopEnabled=true でキュー内の全タブが isIgnored になると findNextReadableIndex が -1 を返し status=idle になる', async () => {
    // Arrange: 全タブが同一ドメイン(example.com)の URL を持つ2タブ、loopEnabled=true
    // getIgnoredDomains は初期状態では [] を返すため、tab 101 は非無視で再生可能
    const tabs = [createMockTab(101, false), createMockTab(202, false)];
    mockedLoadQueue.mockResolvedValue(buildInitialQueue(tabs, 0, true));

    // getIgnoredDomains を TabManager に渡す
    const mockGetIgnoredDomains = jest.fn().mockResolvedValue([]);
    const managerD = new TabManager({
      playback,
      resolveContent: mockResolveContent,
      getIgnoredDomains: mockGetIgnoredDomains,
    });
    await managerD.initialize();

    // tab 101（index=0）の再生を開始し onEndCallback を捕捉
    await managerD.processNext(0);
    expect(onEndCallback).not.toBeNull();

    // onEnd 発火前に全タブを無視対象に変更する:
    // getIgnoredDomains が 'example.com' を返すよう変更し refreshIgnoredDomains() で適用
    mockGetIgnoredDomains.mockResolvedValue(['example.com']);
    await managerD.refreshIgnoredDomains();

    // Act: 全タブ isIgnored=true 状態で読み上げ完了をトリガー
    if (onEndCallback) {
      onEndCallback();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await managerD.flushPersistence();

    const snapshot = managerD.getSnapshot();
    // findNextReadableIndex が completedIndex+1 と wrap(0) ともに -1 を返し
    // stopInternal(false) → idle（無限空ループ防止）
    expect(snapshot.status).toBe('idle');
  });

  // ── Case E: loopEnabled=true、唯一タブ → 同一タブ再生継続 ────────────────

  test('Case E: loopEnabled=true で唯一タブ完了後、同一タブの再生が継続される', async () => {
    // Arrange: tabs=[t0], currentIndex=0, loopEnabled=true
    const tabs = [createMockTab(101)];
    mockedLoadQueue.mockResolvedValue(buildInitialQueue(tabs, 0, true));

    await manager.initialize();
    await manager.processNext(0);

    // Act
    if (onEndCallback) {
      onEndCallback();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await manager.flushPersistence();

    const snapshot = manager.getSnapshot();
    // 1 タブのまま splice されない
    expect(snapshot.tabs).toHaveLength(1);
    // currentIndex=0（同一タブ再生継続）
    expect(snapshot.currentIndex).toBe(0);
    // 再生が継続している
    expect(snapshot.status).toBe('reading');
    // playback.start が 2 回呼ばれている（初回 + ループ後）
    expect(playback.start).toHaveBeenCalledTimes(2);
  });
});
