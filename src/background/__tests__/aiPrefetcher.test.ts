import { AiPrefetcher } from '../aiPrefetcher';
import { QueueStatusPayload, SerializedTabInfo } from '../../shared/messages';
import { AiSettings, TabInfo, TTSSettings } from '../../shared/types';
import { TabManager } from '../tabManager';
import { OpenRouterClient } from '../../shared/services/openrouter';

const baseSettings: TTSSettings = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: null,
};

const createSerializedTab = (overrides: Partial<SerializedTabInfo> = {}): SerializedTabInfo => ({
  tabId: overrides.tabId ?? 1,
  url: overrides.url ?? 'https://example.com',
  title: overrides.title ?? 'Example',
  isIgnored: overrides.isIgnored ?? false,
  extractedAt: overrides.extractedAt ?? new Date().toISOString(),
  content: overrides.content,
  summary: overrides.summary,
  translation: overrides.translation,
});

const createQueuePayload = (tabs: SerializedTabInfo[], currentIndex = 0): QueueStatusPayload => ({
  status: 'reading',
  currentIndex,
  totalCount: tabs.length,
  activeTabId: tabs[currentIndex]?.tabId ?? null,
  tabs,
  settings: baseSettings,
  updatedAt: Date.now(),
});

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('AiPrefetcher', () => {
  let statusListener: ((payload: QueueStatusPayload) => void) | null;
  let tabManagerMock: Partial<TabManager>;
  let summarizeMock: jest.Mock;
  let translateMock: jest.Mock;
  let createClientMock: jest.Mock;
  let loadSettingsMock: jest.Mock<Promise<AiSettings>, []>;

  const makeTabInfo = (tabId: number, overrides: Partial<TabInfo> = {}): TabInfo => ({
    tabId,
    url: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Example',
    isIgnored: overrides.isIgnored ?? false,
    extractedAt: overrides.extractedAt ?? new Date(),
    content: overrides.content,
    summary: overrides.summary,
    translation: overrides.translation,
  });

  beforeEach(() => {
    statusListener = null;
    summarizeMock = jest.fn().mockResolvedValue('summarized content');
    translateMock = jest.fn().mockResolvedValue('translated content');
    createClientMock = jest.fn(() => ({
      summarize: summarizeMock,
      translate: translateMock,
    } as unknown as OpenRouterClient));

    loadSettingsMock = jest.fn(async () => ({
      openRouterApiKey: 'test-key',
      openRouterModel: 'test-model',
      enableAiSummary: true,
      enableAiTranslation: false,
    }));

    tabManagerMock = {
      addStatusListener: jest.fn((listener: (payload: QueueStatusPayload) => void) => {
        statusListener = listener;
        return () => {
          statusListener = null;
        };
      }),
      getTabById: jest.fn(),
      requestContentForPrefetch: jest.fn().mockResolvedValue(undefined),
      onTabUpdated: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('prefetches summary for upcoming tab when content is available', async () => {
    const currentTab = createSerializedTab({ tabId: 1, content: 'current content' });
    const nextTab = createSerializedTab({ tabId: 2, content: 'next tab content' });
    const payload = createQueuePayload([currentTab, nextTab]);

    (tabManagerMock.getTabById as jest.Mock).mockImplementation((tabId: number) => {
      if (tabId === 1) {
        return makeTabInfo(1, { content: 'current content' });
      }
      if (tabId === 2) {
        return makeTabInfo(2, { content: 'next tab content' });
      }
      return null;
    });

    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      createClient: createClientMock,
      loadSettings: loadSettingsMock,
      maxPrefetchAhead: 1,
    });

    prefetcher.initialize();
    expect(tabManagerMock.addStatusListener).toHaveBeenCalledTimes(1);

    statusListener?.(payload);
    await flushPromises();

    expect(createClientMock).toHaveBeenCalledWith('test-key', 'test-model');
    expect(summarizeMock).toHaveBeenCalledWith('current content', expect.any(Number));
    expect(summarizeMock).toHaveBeenCalledWith('next tab content', expect.any(Number));
    expect(tabManagerMock.onTabUpdated).toHaveBeenCalledWith(1, expect.objectContaining({ summary: 'summarized content' }));
    expect(tabManagerMock.onTabUpdated).toHaveBeenCalledWith(2, expect.objectContaining({ summary: 'summarized content' }));
    expect(tabManagerMock.requestContentForPrefetch).not.toHaveBeenCalled();
  });

  it('requests content when it is missing before attempting AI generation', async () => {
    const currentTab = createSerializedTab({ tabId: 10 });
    const payload = createQueuePayload([currentTab]);

    (tabManagerMock.getTabById as jest.Mock).mockReturnValue(makeTabInfo(10, { content: undefined }));

    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      createClient: createClientMock,
      loadSettings: loadSettingsMock,
      maxPrefetchAhead: 0,
      contentRequestThrottleMs: 0,
    });

    prefetcher.initialize();

    statusListener?.(payload);
    await flushPromises();

    expect(tabManagerMock.requestContentForPrefetch).toHaveBeenCalledWith(10);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(tabManagerMock.onTabUpdated).not.toHaveBeenCalled();
  });

  it('prefetches translation when enabled and summary disabled', async () => {
    loadSettingsMock.mockResolvedValue({
      openRouterApiKey: 'test-key',
      openRouterModel: 'test-model',
      enableAiSummary: false,
      enableAiTranslation: true,
    });

    const tab = createSerializedTab({ tabId: 42, content: 'translation content' });
    const payload = createQueuePayload([tab], 0);

    (tabManagerMock.getTabById as jest.Mock).mockReturnValue(
      makeTabInfo(42, { content: 'translation content', summary: 'already summarized' }),
    );

    const prefetcher = new AiPrefetcher({
      tabManager: tabManagerMock as TabManager,
      createClient: createClientMock,
      loadSettings: loadSettingsMock,
      maxPrefetchAhead: 0,
      translationTarget: 'en',
    });

    prefetcher.initialize();

    statusListener?.(payload);
    await flushPromises();

    expect(summarizeMock).not.toHaveBeenCalled();
    expect(translateMock).toHaveBeenCalledWith('translation content', 'en', expect.any(Number));
    expect(tabManagerMock.onTabUpdated).toHaveBeenCalledWith(42, expect.objectContaining({ translation: 'translated content' }));
  });
});
