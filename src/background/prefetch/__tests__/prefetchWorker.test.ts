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
    const fetchTab = jest.fn<Promise<TabInfo | null>, [number]>(tabId =>
      Promise.resolve(makeTab({ tabId, content: `content-${tabId}` }))
    );
    const requestContent = jest.fn().mockResolvedValue(undefined);
    const getSettings = jest.fn<Promise<AiSettings>, []>(() => Promise.resolve(baseSettings));
    const summarize = jest.fn<Promise<string>, [string]>(async content => `summary:${content}`);
    const translate = jest.fn<Promise<string>, [string, string]>(
      async text => `translation:${text}`
    );
    const resultStore = {
      save: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      prune: jest.fn().mockResolvedValue(undefined),
      clearAll: jest.fn().mockResolvedValue(undefined),
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

    return {
      worker,
      fetchTab,
      requestContent,
      getSettings,
      summarize,
      translate,
      resultStore,
      emitStatus,
      applyUpdates,
    };
  };

  it('processes jobs sequentially and saves summary/translation', async () => {
    const { worker, summarize, translate, resultStore, applyUpdates } = createWorker();

    worker.enqueue({ tabId: 1, priority: 0 });
    worker.enqueue({ tabId: 2, priority: 1 });

    await worker.waitForIdle();

    expect(summarize).toHaveBeenNthCalledWith(1, 'content-1');
    expect(translate).toHaveBeenNthCalledWith(1, 'summary:content-1', 'en');
    expect(summarize).toHaveBeenNthCalledWith(2, 'content-2');
    expect(resultStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1, summary: 'summary:content-1' })
    );
    expect(resultStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 2, summary: 'summary:content-2' })
    );
    expect(applyUpdates).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        summary: 'summary:content-1',
        translation: 'translation:summary:content-1',
      })
    );
  });

  it('requests content when missing and retries after fetch', async () => {
    makeTab({ tabId: 10, content: undefined });
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

  describe('reset()', () => {
    it('clears queue and cancelled set, sets processing to false', () => {
      const { worker } = createWorker();

      // Add items to cancelled via cancel()
      worker.cancel(30);
      worker.cancel(31);

      // reset should clear everything
      worker.reset();

      // After reset, cancelled items should not block new enqueue
      // (we verify by checking that the worker is in a clean state)
      expect((worker as any).queue).toHaveLength(0);
      expect((worker as any).cancelled.size).toBe(0);
      expect((worker as any).processing).toBe(false);
    });

    it('allows new jobs to be enqueued after reset without stale cancelled state', async () => {
      const { worker } = createWorker();

      // Cancel tabs to populate the cancelled set
      worker.cancel(40);
      worker.cancel(41);
      expect((worker as any).cancelled.size).toBe(2);

      // reset clears cancelled set so previously cancelled tabIds can run again
      worker.reset();

      expect((worker as any).cancelled.size).toBe(0);
      expect((worker as any).queue).toHaveLength(0);
    });

    it('clears contentRetryMap on reset', async () => {
      const { worker, fetchTab } = createWorker();

      // Always return empty content so retries accumulate
      (fetchTab as jest.Mock).mockResolvedValue(makeTab({ tabId: 50, content: undefined }));

      worker.enqueue({ tabId: 50, priority: 0 });
      // Let one cycle run to increment retry count
      await new Promise(resolve => setTimeout(resolve, 10));

      worker.reset();

      expect((worker as any).contentRetryMap.size).toBe(0);
    });
  });

  describe('content retry limit (Phase A)', () => {
    // Helper: flush all microtasks + advance fake timers repeatedly until the
    // worker goes idle.  Each retry cycle is:
    //   runJob (async, multiple awaits) → pending → setTimeout(500ms) → enqueue
    // We must flush microtasks after each timer advance so the async chain
    // actually runs before the next advance.
    // Flush microtasks by chaining enough Promise.resolve() ticks.
    // runJob has ~6 awaits; 12 ticks is safely above that.
    const flushMicrotasks = async (ticks = 12) => {
      for (let i = 0; i < ticks; i++) {
        await Promise.resolve();
      }
    };

    // Run N retry cycles: flush async job → advance 500ms timer → flush re-enqueue.
    const flushCycles = async (worker: PrefetchWorker, cycles: number, intervalMs = 500) => {
      for (let i = 0; i < cycles; i++) {
        await flushMicrotasks();
        jest.advanceTimersByTime(intervalMs);
        await flushMicrotasks();
      }
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('marks job as failed after MAX_CONTENT_RETRIES when content is always empty', async () => {
      const { worker, fetchTab, emitStatus } = createWorker();

      // Always return tab without content
      (fetchTab as jest.Mock).mockResolvedValue(makeTab({ tabId: 99, content: undefined }));

      worker.enqueue({ tabId: 99, priority: 0 });

      // MAX_CONTENT_RETRIES = 5; on the 5th attempt the worker emits failed
      await flushCycles(worker, 6);

      const failedCall = emitStatus.mock.calls.find(
        ([update]) => update.tabId === 99 && update.state === 'failed'
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![0].error).toMatch(/retr/i);
    });

    it('resets retry count for a different tabId independently', async () => {
      const { worker, fetchTab, emitStatus } = createWorker();

      // Both tabs have no content
      (fetchTab as jest.Mock).mockImplementation(async (tabId: number) =>
        makeTab({ tabId, content: undefined })
      );

      worker.enqueue({ tabId: 101, priority: 0 });
      worker.enqueue({ tabId: 102, priority: 1 });

      // 3 cycles — well below the limit of 5, neither tab should fail yet
      await flushCycles(worker, 3);

      const failed101 = emitStatus.mock.calls.filter(
        ([u]) => u.tabId === 101 && u.state === 'failed'
      );
      const failed102 = emitStatus.mock.calls.filter(
        ([u]) => u.tabId === 102 && u.state === 'failed'
      );
      expect(failed101).toHaveLength(0);
      expect(failed102).toHaveLength(0);

      // Retry counts must be independent per tab (each <= 5)
      const retry101 = (worker as any).contentRetryMap.get(101) ?? 0;
      const retry102 = (worker as any).contentRetryMap.get(102) ?? 0;
      expect(retry101).toBeLessThanOrEqual(5);
      expect(retry102).toBeLessThanOrEqual(5);
    });

    it('emits failed with descriptive error message when retry limit exceeded', async () => {
      const { worker, fetchTab, emitStatus } = createWorker();

      (fetchTab as jest.Mock).mockResolvedValue(makeTab({ tabId: 77, content: undefined }));

      worker.enqueue({ tabId: 77, priority: 0 });

      await flushCycles(worker, 6);

      const failedCall = emitStatus.mock.calls.find(
        ([u]) => u.tabId === 77 && u.state === 'failed'
      );
      expect(failedCall).toBeDefined();
      expect(typeof failedCall![0].error).toBe('string');
      expect(failedCall![0].error.length).toBeGreaterThan(0);
    });

    it('does not re-enqueue after reaching retry limit', async () => {
      const { worker, fetchTab, emitStatus } = createWorker();

      (fetchTab as jest.Mock).mockResolvedValue(makeTab({ tabId: 88, content: undefined }));

      worker.enqueue({ tabId: 88, priority: 0 });

      // Extra cycles beyond the limit — should not accumulate more failed events
      await flushCycles(worker, 8);

      const failedCalls = emitStatus.mock.calls.filter(
        ([u]) => u.tabId === 88 && u.state === 'failed'
      );
      // Must fail exactly once
      expect(failedCalls).toHaveLength(1);
    });
  });

  describe('Phase B: requestContent error propagation', () => {
    it('enters retry loop (not immediately failed) when requestContent throws "Receiving end does not exist"', async () => {
      // Why: Phase C (dynamic CS injection in handleCommandEvent/emitContentRequest) may
      // complete asynchronously. Worker must NOT fast-fail on this error — it should
      // fall through to the normal 500ms re-enqueue / MAX_CONTENT_RETRIES loop.
      jest.useFakeTimers();
      const { worker, fetchTab, requestContent, emitStatus } = createWorker();

      (fetchTab as jest.Mock).mockResolvedValue(makeTab({ tabId: 55, content: undefined }));
      (requestContent as jest.Mock).mockRejectedValue(
        new Error('Could not establish connection. Receiving end does not exist.')
      );

      worker.enqueue({ tabId: 55, priority: 0 });

      // After the first run, job should NOT be marked failed immediately
      await Promise.resolve();
      await Promise.resolve();
      const failedImmediately = emitStatus.mock.calls.some(
        ([u]) => u.tabId === 55 && u.state === 'failed'
      );
      expect(failedImmediately).toBe(false);

      jest.useRealTimers();
    });

    it('eventually marks job as failed after MAX_CONTENT_RETRIES when "Receiving end" persists', async () => {
      jest.useFakeTimers();

      const flushMicrotasks = async (ticks = 12) => {
        for (let i = 0; i < ticks; i++) {
          await Promise.resolve();
        }
      };
      const flushCycles = async (worker: PrefetchWorker, cycles: number, intervalMs = 500) => {
        for (let i = 0; i < cycles; i++) {
          await flushMicrotasks();
          jest.advanceTimersByTime(intervalMs);
          await flushMicrotasks();
        }
      };

      const { worker, fetchTab, requestContent, emitStatus } = createWorker();

      (fetchTab as jest.Mock).mockResolvedValue(makeTab({ tabId: 56, content: undefined }));
      (requestContent as jest.Mock).mockRejectedValue(
        new Error('Could not establish connection. Receiving end does not exist.')
      );

      worker.enqueue({ tabId: 56, priority: 0 });

      // Drive through MAX_CONTENT_RETRIES=5 cycles — job should eventually fail
      await flushCycles(worker, 6);

      const failedCall = emitStatus.mock.calls.find(
        ([u]) => u.tabId === 56 && u.state === 'failed'
      );
      expect(failedCall).toBeDefined();

      jest.useRealTimers();
    });

    it('continues retrying for non-connection errors from requestContent', async () => {
      jest.useFakeTimers();
      const { worker, fetchTab, requestContent, emitStatus } = createWorker();

      (fetchTab as jest.Mock).mockResolvedValue(makeTab({ tabId: 66, content: undefined }));
      // requestContent throws a generic (non-connection) error
      (requestContent as jest.Mock).mockRejectedValue(new Error('Temporary network glitch'));

      worker.enqueue({ tabId: 66, priority: 0 });

      // Should not immediately fail — should retry
      await Promise.resolve();
      const failedImmediately = emitStatus.mock.calls.some(
        ([u]) => u.tabId === 66 && u.state === 'failed'
      );
      expect(failedImmediately).toBe(false);

      jest.useRealTimers();
    });
  });
});
