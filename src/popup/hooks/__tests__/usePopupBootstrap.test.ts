/**
 * usePopupBootstrap.test.ts
 * Process 100 Red Phase: popup初期化hookのテスト
 */
import { renderHook, waitFor } from '@testing-library/react';
import { usePopupBootstrap } from '../usePopupBootstrap';

// BrowserAdapter モック
const mockTabsQuery = jest.fn();
jest.mock('../../../shared/utils/browser', () => ({
  BrowserAdapter: {
    getInstance: () => ({
      tabs: { query: mockTabsQuery },
    }),
  },
}));

// StorageManager モック
const mockGetSettings = jest.fn();
const mockGetDeveloperMode = jest.fn();
const mockGetAiSettings = jest.fn();
jest.mock('../../../shared/utils/storage', () => ({
  StorageManager: {
    getSettings: () => mockGetSettings(),
    getDeveloperMode: () => mockGetDeveloperMode(),
    getAiSettings: () => mockGetAiSettings(),
  },
}));

describe('usePopupBootstrap (Process 100)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTabsQuery.mockResolvedValue([{ id: 1, url: 'https://example.com', title: 'Example' }]);
    mockGetSettings.mockResolvedValue({ rate: 1.5, pitch: 1.0, volume: 1.0, voice: null });
    mockGetDeveloperMode.mockResolvedValue(false);
    mockGetAiSettings.mockResolvedValue({
      enableAiSummary: false,
      openRouterApiKey: '',
      summaryWaitMode: 'wait',
    });
  });

  it('should initialize popup state on mount', async () => {
    const { result } = renderHook(() => usePopupBootstrap());

    // 初期ローディング状態
    expect(result.current.isLoading).toBe(true);

    // 非同期初期化完了を待つ
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.activeTab).toEqual({
      id: 1,
      url: 'https://example.com',
      title: 'Example',
    });
    expect(result.current.settings.rate).toBe(1.5);
    expect(result.current.developerMode).toBe(false);
    expect(result.current.initError).toBeNull();
  });

  it('should set aiEnabled when api key and summary enabled', async () => {
    mockGetAiSettings.mockResolvedValue({
      enableAiSummary: true,
      openRouterApiKey: 'sk-test-key',
      summaryWaitMode: 'skip',
    });

    const { result } = renderHook(() => usePopupBootstrap());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.aiEnabled).toBe(true);
    expect(result.current.summaryWaitMode).toBe('skip');
  });

  it('should set initError on failure', async () => {
    mockGetSettings.mockRejectedValue(new Error('storage error'));

    const { result } = renderHook(() => usePopupBootstrap());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.initError).toMatch(/初期化に失敗しました/);
  });
});
