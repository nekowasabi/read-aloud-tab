/**
 * contentResolver - on-demand fallback tests (Process 50 refactored)
 *
 * Previously tested via (orchestrator as any).createContentResolver.
 * Now tests the extracted createContentResolver() factory directly.
 *
 * --- Interface Contract ---
 * interface ContentResolverAdapter {
 *   resolveContent(tab: TabInfo): Promise<Partial<TabInfo>>;
 *   fallback(tab: TabInfo, aiSettings: AiSettings): Promise<Partial<TabInfo>>;
 * }
 */
import { createContentResolver } from '../contentResolver';
import type { TabInfo, AiSettings } from '../../shared/types';

jest.mock('../../shared/utils/storage', () => ({
  StorageManager: {
    getAiSettings: jest.fn(),
    validateSettings: jest.fn((s) => s),
    saveSettings: jest.fn(),
  },
  loadQueue: jest.fn().mockResolvedValue({ tabs: [], currentIndex: 0, status: 'idle', settings: { rate: 1, pitch: 1, volume: 1, voice: null } }),
  saveQueue: jest.fn(),
  getIgnoredDomains: jest.fn().mockResolvedValue([]),
}));

const { StorageManager } = jest.requireMock('../../shared/utils/storage');

describe('createContentResolver fallback', () => {
  const baseTab: TabInfo = {
    tabId: 42,
    url: 'https://example.com',
    title: 'Test',
    content: 'Some long article content here',
    isIgnored: false,
    extractedAt: new Date(),
  };

  const aiSettingsEnabled: AiSettings = {
    enableAiSummary: true,
    enableAiTranslation: false,
    openRouterApiKey: 'test-key',
    openRouterModel: 'test-model',
    summaryPrompt: '',
    translationPrompt: '',
  };

  const aiSettingsDisabled: AiSettings = {
    enableAiSummary: false,
    enableAiTranslation: false,
    openRouterApiKey: '',
    openRouterModel: '',
    summaryPrompt: '',
    translationPrompt: '',
  };

  let mockLogger: {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };
  let mockPrefetcher: {
    isPrefetchComplete: jest.Mock;
    waitForPrefetch: jest.Mock;
    consumeCancelledWait: jest.Mock;
    getResultFromStore: jest.Mock;
  };
  let mockAiProcessor: {
    processContent: jest.Mock;
  };
  let mockTabLookup: {
    getTabById: jest.Mock;
  };
  let mockEmitContentRequest: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockPrefetcher = {
      isPrefetchComplete: jest.fn().mockReturnValue(false),
      waitForPrefetch: jest.fn().mockResolvedValue('completed'),
      consumeCancelledWait: jest.fn().mockReturnValue(false),
      getResultFromStore: jest.fn().mockResolvedValue(null),
    };

    mockAiProcessor = {
      processContent: jest.fn().mockResolvedValue(null),
    };

    mockTabLookup = {
      getTabById: jest.fn().mockReturnValue(null),
    };

    mockEmitContentRequest = jest.fn();
  });

  function makeResolver(overrides?: {
    prefetcher?: typeof mockPrefetcher | null;
    aiProcessor?: typeof mockAiProcessor | null;
  }) {
    return createContentResolver({
      logger: mockLogger,
      prefetcher: overrides?.prefetcher !== undefined ? overrides.prefetcher : mockPrefetcher,
      aiProcessor: overrides?.aiProcessor !== undefined ? overrides.aiProcessor : mockAiProcessor,
      tabLookup: mockTabLookup,
      emitContentRequest: mockEmitContentRequest,
    });
  }

  it('should trigger on-demand summarization when prefetch returns no summary', async () => {
    const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
    mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);
    mockAiProcessor.processContent.mockResolvedValue('AI generated summary');

    const resolver = makeResolver();
    const result = await resolver(tabNoSummary);

    expect(mockAiProcessor.processContent).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 42 }),
      aiSettingsEnabled,
    );
    expect(result?.summary).toBe('AI generated summary');
  });

  it('should not trigger fallback when summary already exists from prefetch', async () => {
    const tabWithSummary = { ...baseTab, summary: 'Prefetched summary' };
    mockTabLookup.getTabById.mockReturnValue(tabWithSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);

    const resolver = makeResolver();
    const result = await resolver(tabWithSummary);

    expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
    expect(result?.summary).toBe('Prefetched summary');
  });

  it('should not trigger fallback when AI settings are disabled', async () => {
    const tabNoSummary = { ...baseTab, summary: undefined };
    mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsDisabled);

    const resolver = makeResolver();
    await resolver(tabNoSummary);

    expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
  });

  it('should handle AiProcessor failure gracefully', async () => {
    const tabNoSummary = { ...baseTab, summary: undefined };
    mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);
    mockAiProcessor.processContent.mockRejectedValue(new Error('API error'));

    const resolver = makeResolver();
    const result = await resolver(tabNoSummary);

    expect(result).toBeTruthy();
    expect(result?.content).toBe(baseTab.content);
  });

  it('should trigger on-demand summarization when prefetch times out', async () => {
    mockPrefetcher.waitForPrefetch.mockResolvedValue('timed_out');
    const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
    mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);
    mockAiProcessor.processContent.mockResolvedValue('Delayed summary from fallback');

    const resolver = makeResolver();
    const result = await resolver(tabNoSummary);

    expect(mockAiProcessor.processContent).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 42 }),
      aiSettingsEnabled,
    );
    expect(result?.summary).toBe('Delayed summary from fallback');
  });

  it('should not trigger on-demand summarization when prefetch fails explicitly in skip mode', async () => {
    mockPrefetcher.isPrefetchComplete.mockReturnValue(false);
    mockPrefetcher.waitForPrefetch.mockResolvedValue('failed');
    const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
    mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue({
      ...aiSettingsEnabled,
      summaryWaitMode: 'skip',
    });

    const resolver = makeResolver();
    const result = await resolver(tabNoSummary);

    expect(mockPrefetcher.waitForPrefetch).not.toHaveBeenCalled();
    expect(mockPrefetcher.getResultFromStore).not.toHaveBeenCalled();
    expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
    expect(result?.summary).toBeUndefined();
    expect(result?.content).toBe(baseTab.content);
  });

  it('should pass summaryWaitMode to waitForPrefetch', async () => {
    const tabWithSummary = { ...baseTab, summary: 'Prefetched summary' };
    mockTabLookup.getTabById.mockReturnValue(tabWithSummary);
    const settingsWithWaitMode: AiSettings = {
      ...aiSettingsEnabled,
      summaryWaitMode: 'wait',
    };
    StorageManager.getAiSettings.mockResolvedValue(settingsWithWaitMode);

    const resolver = makeResolver();
    await resolver(tabWithSummary);

    expect(mockPrefetcher.waitForPrefetch).toHaveBeenCalledWith(42, expect.any(Number), 'wait');
  });

  it('should not call waitForPrefetch in skip mode', async () => {
    mockPrefetcher.isPrefetchComplete.mockReturnValue(false);
    const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
    mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue({
      ...aiSettingsEnabled,
      summaryWaitMode: 'skip',
    });

    const resolver = makeResolver();
    await resolver(tabNoSummary);

    expect(mockPrefetcher.waitForPrefetch).not.toHaveBeenCalled();
  });

  it('should default to wait mode when summaryWaitMode is not set', async () => {
    const tabWithSummary = { ...baseTab, summary: 'Prefetched summary' };
    mockTabLookup.getTabById.mockReturnValue(tabWithSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);

    const resolver = makeResolver();
    await resolver(tabWithSummary);

    expect(mockPrefetcher.waitForPrefetch).toHaveBeenCalledWith(42, expect.any(Number), 'wait');
  });

  it('should use wait timeout=120000 and skip without waiting', async () => {
    const tab = { ...baseTab, summary: 'Prefetched summary' };
    mockTabLookup.getTabById.mockReturnValue(tab);

    StorageManager.getAiSettings.mockResolvedValue({ ...aiSettingsEnabled, summaryWaitMode: 'wait' });
    const resolver = makeResolver();
    await resolver(tab);
    expect(mockPrefetcher.waitForPrefetch).toHaveBeenLastCalledWith(42, 120000, 'wait');

    mockPrefetcher.waitForPrefetch.mockClear();
    mockPrefetcher.isPrefetchComplete.mockReturnValue(false);
    StorageManager.getAiSettings.mockResolvedValue({ ...aiSettingsEnabled, summaryWaitMode: 'skip' });
    await resolver(tab);
    expect(mockPrefetcher.waitForPrefetch).not.toHaveBeenCalled();
  });

  it('should treat missing summaryWaitMode as wait for failed prefetch fallback', async () => {
    mockPrefetcher.waitForPrefetch.mockResolvedValue('failed');
    const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
    mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);
    mockAiProcessor.processContent.mockResolvedValue('Fallback summary on default wait');

    const resolver = makeResolver();
    const result = await resolver(tabNoSummary);

    expect(mockAiProcessor.processContent).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 42 }),
      aiSettingsEnabled,
    );
    expect(result?.summary).toBe('Fallback summary on default wait');
  });

  it('should not trigger on-demand summarization when wait was cancelled explicitly', async () => {
    mockPrefetcher.waitForPrefetch.mockResolvedValue('timed_out');
    mockPrefetcher.consumeCancelledWait.mockReturnValue(true);
    const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
    mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);

    const resolver = makeResolver();
    const result = await resolver(tabNoSummary);

    expect(mockPrefetcher.consumeCancelledWait).toHaveBeenCalledWith(42);
    expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
    expect(result?.summary).toBeUndefined();
  });

  it('should return content immediately without waiting in skip mode when prefetch is in-flight', async () => {
    mockPrefetcher.isPrefetchComplete.mockReturnValue(false);
    const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
    mockTabLookup.getTabById.mockReturnValue(null);
    StorageManager.getAiSettings.mockResolvedValue({
      ...aiSettingsEnabled,
      summaryWaitMode: 'skip',
    });

    const resolver = makeResolver();
    const result = await resolver(tabNoSummary);

    expect(result?.content).toBe(baseTab.content);
    expect(result?.summary).toBeUndefined();
    expect(mockPrefetcher.waitForPrefetch).not.toHaveBeenCalled();
    expect(mockPrefetcher.getResultFromStore).not.toHaveBeenCalled();
    expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
  });

  it('should return existing summary and translation in skip mode when prefetch is in-flight', async () => {
    mockPrefetcher.isPrefetchComplete.mockReturnValue(false);
    const storedTab = {
      ...baseTab,
      summary: 'Existing summary',
      translation: 'Existing translation',
    };
    mockTabLookup.getTabById.mockReturnValue(storedTab);
    StorageManager.getAiSettings.mockResolvedValue({
      ...aiSettingsEnabled,
      summaryWaitMode: 'skip',
    });

    const resolver = makeResolver();
    const result = await resolver({ ...baseTab, summary: undefined });

    expect(result?.summary).toBe('Existing summary');
    expect(result?.translation).toBe('Existing translation');
    expect(result?.content).toBe(baseTab.content);
    expect(mockPrefetcher.waitForPrefetch).not.toHaveBeenCalled();
    expect(mockPrefetcher.getResultFromStore).not.toHaveBeenCalled();
    expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
  });

  it('should settle skip mode in-flight resolver with only microtasks and no timer advance', async () => {
    jest.useFakeTimers();
    try {
      mockPrefetcher.isPrefetchComplete.mockReturnValue(false);
      const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
      mockTabLookup.getTabById.mockReturnValue(tabNoSummary);
      StorageManager.getAiSettings.mockResolvedValue({
        ...aiSettingsEnabled,
        summaryWaitMode: 'skip',
      });

      const resolver = makeResolver();
      const pending = resolver(tabNoSummary);
      const result = await jest.advanceTimersByTimeAsync(0).then(() => pending);

      expect(result?.content).toBe(baseTab.content);
      expect(result?.summary).toBeUndefined();
      expect(mockPrefetcher.waitForPrefetch).not.toHaveBeenCalled();
      expect(mockAiProcessor.processContent).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
