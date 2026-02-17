/**
 * BackgroundOrchestrator.createContentResolver - on-demand fallback tests
 *
 * When prefetch completes but summary is missing, AiProcessor should be
 * invoked as a fallback to produce summary/translation on demand.
 */
import { BackgroundOrchestrator } from '../service';
import { TabManager } from '../tabManager';
import { AiPrefetcher } from '../aiPrefetcher';
import { AiProcessor } from '../aiProcessor';
import type { TabInfo, AiSettings } from '../../shared/types';

// Mock dependencies
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

jest.mock('../aiPrefetcher');
jest.mock('../aiProcessor');
jest.mock('../../shared/utils/browser', () => ({
  BrowserAdapter: {
    getInstance: jest.fn(() => ({
      runtime: {
        onConnect: { addListener: jest.fn() },
        onMessage: { addListener: jest.fn() },
      },
      storage: { local: { get: jest.fn(), set: jest.fn() } },
    })),
    getBrowserType: jest.fn(() => 'chrome'),
  },
}));

const { StorageManager } = jest.requireMock('../../shared/utils/storage');

describe('createContentResolver fallback', () => {
  let orchestrator: BackgroundOrchestrator;
  let tabManager: TabManager;
  let prefetcher: jest.Mocked<AiPrefetcher>;
  let aiProcessor: jest.Mocked<AiProcessor>;

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

  const mockChrome = {
    runtime: {
      onConnect: { addListener: jest.fn() },
      onMessage: { addListener: jest.fn() },
    },
    storage: { local: { get: jest.fn(), set: jest.fn() } },
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    tabManager = new TabManager({
      playback: {
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        updateSettings: jest.fn(),
      },
    });

    prefetcher = new AiPrefetcher({ tabManager }) as jest.Mocked<AiPrefetcher>;
    prefetcher.waitForPrefetch = jest.fn();

    aiProcessor = new AiProcessor() as jest.Mocked<AiProcessor>;
    aiProcessor.processContent = jest.fn();
    aiProcessor.updateSettings = jest.fn();

    orchestrator = new BackgroundOrchestrator({
      tabManager,
      chrome: mockChrome as never,
      logger: mockLogger,
      prefetcher,
      aiProcessor,
    });
  });

  it('should trigger on-demand summarization when prefetch returns no summary', async () => {
    // Setup: prefetch succeeds but tab has no summary
    prefetcher.waitForPrefetch.mockResolvedValue(true);
    const tabNoSummary = { ...baseTab, summary: undefined, translation: undefined };
    tabManager.addTab(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);
    aiProcessor.processContent.mockResolvedValue('AI generated summary');

    // Act
    const resolver = (orchestrator as any).createContentResolver;
    const result = await resolver(tabNoSummary);

    // Assert: AiProcessor.processContent was called as fallback
    expect(aiProcessor.processContent).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 42 }),
      aiSettingsEnabled
    );
    expect(result.summary).toBe('AI generated summary');
  });

  it('should not trigger fallback when summary already exists from prefetch', async () => {
    // Setup: prefetch succeeds and tab has summary
    prefetcher.waitForPrefetch.mockResolvedValue(true);
    const tabWithSummary = { ...baseTab, summary: 'Prefetched summary' };
    tabManager.addTab(tabWithSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);

    const resolver = (orchestrator as any).createContentResolver;
    const result = await resolver(tabWithSummary);

    // Assert: no fallback needed
    expect(aiProcessor.processContent).not.toHaveBeenCalled();
    expect(result.summary).toBe('Prefetched summary');
  });

  it('should not trigger fallback when AI settings are disabled', async () => {
    // Setup: AI disabled → needsAi is false → no prefetch wait at all
    prefetcher.waitForPrefetch.mockResolvedValue(true);
    const tabNoSummary = { ...baseTab, summary: undefined };
    tabManager.addTab(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsDisabled);

    const resolver = (orchestrator as any).createContentResolver;
    const result = await resolver(tabNoSummary);

    // Assert: no fallback because AI is disabled
    expect(aiProcessor.processContent).not.toHaveBeenCalled();
  });

  it('should handle AiProcessor failure gracefully', async () => {
    // Setup: prefetch succeeds, no summary, AiProcessor throws
    prefetcher.waitForPrefetch.mockResolvedValue(true);
    const tabNoSummary = { ...baseTab, summary: undefined };
    tabManager.addTab(tabNoSummary);
    StorageManager.getAiSettings.mockResolvedValue(aiSettingsEnabled);
    aiProcessor.processContent.mockRejectedValue(new Error('API error'));

    const resolver = (orchestrator as any).createContentResolver;
    const result = await resolver(tabNoSummary);

    // Assert: returns content without summary, no crash
    expect(result).toBeTruthy();
    expect(result.content).toBe(baseTab.content);
  });
});
