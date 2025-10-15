import { PrefetchWorker } from '../worker';
import { AiSettings, TabInfo } from '../../../shared/types';
import * as languageDetector from '../../../shared/utils/languageDetector';

// Mock language detector to force translation
jest.spyOn(languageDetector, 'isTranslationNeeded').mockReturnValue(true);
jest.spyOn(languageDetector, 'detectLanguage').mockReturnValue('ja');

describe('PrefetchWorker', () => {
  const makeTab = (overrides: Partial<TabInfo> = {}): TabInfo => ({
    tabId: overrides.tabId ?? 1,
    url: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Example',
    isIgnored: overrides.isIgnored ?? false,
    content: overrides.content,
    summary: overrides.summary,
    translation: overrides.translation,
    extractedAt: overrides.extractedAt ?? new Date(),
  });

  const baseSettings: AiSettings = {
    openRouterApiKey: 'key',
    openRouterModel: 'model',
    enableAiSummary: true,
    enableAiTranslation: true,
    summaryPrompt: 'summary',
    translationPrompt: 'translation',
  } as AiSettings;

  const createWorker = () => {
    const fetchTab = jest.fn<Promise<TabInfo | null>, [number]>
      ((tabId) => Promise.resolve(makeTab({ tabId, content: `content-${tabId}` })));
    const requestContent = jest.fn().mockResolvedValue(undefined);
    const getSettings = jest.fn<Promise<AiSettings>, []>(() => Promise.resolve(baseSettings));
    const summarize = jest.fn<Promise<string>, [string]>(async (content) => `summary:${content}`);
    const translate = jest.fn<Promise<string>, [string, string]>(async (text) => `translation:${text}`);
    const resultStore = {
      save: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      prune: jest.fn().mockResolvedValue(undefined),
    };
    const emitStatus = jest.fn();
    const applyUpdates = jest.fn().mockResolvedValue(undefined);

    const worker = new PrefetchWorker({
      fetchTab,
      requestContent,
      getSettings,
      summarize,
      translate,
      resultStore,
      emitStatus,
      applyUpdates,
      logger: console,
      translationTarget: 'en',
    });

    return { worker, fetchTab, requestContent, getSettings, summarize, translate, resultStore, emitStatus, applyUpdates };
  };

  it('processes jobs sequentially and saves summary/translation', async () => {
    const { worker, summarize, translate, resultStore, applyUpdates } = createWorker();

    worker.enqueue({ tabId: 1, priority: 0 });
    worker.enqueue({ tabId: 2, priority: 1 });

    await worker.waitForIdle();

    expect(summarize).toHaveBeenNthCalledWith(1, 'content-1');
    expect(translate).toHaveBeenNthCalledWith(1, 'summary:content-1', 'en');
    expect(summarize).toHaveBeenNthCalledWith(2, 'content-2');
    expect(resultStore.save).toHaveBeenCalledWith(expect.objectContaining({ tabId: 1, summary: 'summary:content-1' }));
    expect(resultStore.save).toHaveBeenCalledWith(expect.objectContaining({ tabId: 2, summary: 'summary:content-2' }));
    expect(applyUpdates).toHaveBeenCalledWith(1, expect.objectContaining({ summary: 'summary:content-1', translation: 'translation:summary:content-1' }));
  });

  it('requests content when missing and retries after fetch', async () => {
    const tab = makeTab({ tabId: 10, content: undefined });
    const { worker, fetchTab, requestContent, summarize } = createWorker();

    (fetchTab as jest.Mock).mockImplementation(async (tabId: number) => {
      if (tabId === 10 && requestContent.mock.calls.length === 0) {
        return makeTab({ tabId: 10, content: undefined });
      }
      return makeTab({ tabId: 10, content: 'content-10' });
    });

    worker.enqueue({ tabId: 10, priority: 0 });
    await worker.waitForIdle();

    expect(requestContent).toHaveBeenCalledWith(10);
    expect(summarize).toHaveBeenCalledWith('content-10');
  });

  it('cancels job before execution', async () => {
    const { worker, summarize } = createWorker();

    worker.enqueue({ tabId: 20, priority: 0 });
    worker.cancel(20);

    await worker.waitForIdle();

    expect(summarize).not.toHaveBeenCalled();
  });
});
