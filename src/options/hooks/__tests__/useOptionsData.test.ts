/**
 * useOptionsData.test.ts
 * Process 100 Red Phase: options データhookのテスト
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useOptionsData } from '../useOptionsData';

const mockGetSettings = jest.fn();
const mockGetAiSettings = jest.fn();
const mockGetDeveloperMode = jest.fn();
const mockGetIgnoredDomains = jest.fn();

jest.mock('../../../shared/utils/storage', () => ({
  StorageManager: {
    getSettings: () => mockGetSettings(),
    getAiSettings: () => mockGetAiSettings(),
    getDeveloperMode: () => mockGetDeveloperMode(),
    validateAiSettings: (v: unknown) => ({ enableAiSummary: false, openRouterApiKey: '', openRouterModel: '', openRouterProvider: '', summaryPrompt: '', translationPrompt: '', enableAiTranslation: false, summaryWaitMode: 'wait', ...((v as object) ?? {}) }),
  },
  getIgnoredDomains: () => mockGetIgnoredDomains(),
}));

describe('useOptionsData (Process 100)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSettings.mockResolvedValue({ rate: 1.0, pitch: 1.0, volume: 1.0, voice: null });
    mockGetAiSettings.mockResolvedValue({ enableAiSummary: false, openRouterApiKey: '', openRouterModel: '', openRouterProvider: '', summaryPrompt: '', translationPrompt: '', enableAiTranslation: false, summaryWaitMode: 'wait' });
    mockGetDeveloperMode.mockResolvedValue(false);
    mockGetIgnoredDomains.mockResolvedValue(['example.com']);
  });

  it('should load options data from storage', async () => {
    const { result } = renderHook(() => useOptionsData());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings).toEqual({ rate: 1.0, pitch: 1.0, volume: 1.0, voice: null });
    expect(result.current.ignoredDomains).toEqual(['example.com']);
    expect(result.current.developerMode).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('should expose setter functions for all state fields', async () => {
    const { result } = renderHook(() => useOptionsData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(typeof result.current.setSettings).toBe('function');
    expect(typeof result.current.setIgnoredDomains).toBe('function');
    expect(typeof result.current.setAiSettings).toBe('function');
    expect(typeof result.current.setDeveloperMode).toBe('function');
  });

  it('should set loadError on storage failure', async () => {
    mockGetSettings.mockRejectedValue(new Error('storage error'));

    const { result } = renderHook(() => useOptionsData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.loadError).toMatch(/設定の読み込みに失敗しました/);
  });
});
