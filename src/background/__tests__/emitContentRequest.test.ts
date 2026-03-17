/**
 * Phase C: emitContentRequest — dynamic Content Script injection
 *
 * When chrome.tabs.sendMessage fails with "Receiving end does not exist",
 * BackgroundOrchestrator should attempt chrome.scripting.executeScript to
 * inject content.js, then retry sendMessage.
 */

jest.mock('../../shared/utils/browser', () => ({
  BrowserAdapter: {
    getInstance: jest.fn().mockReturnValue({
      runtime: { onConnect: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() } },
      tabs: { sendMessage: jest.fn() },
    }),
    getBrowserType: jest.fn().mockReturnValue('chrome'),
    isFeatureSupported: jest.fn().mockReturnValue(false),
  },
}));

jest.mock('../../shared/utils/storage', () => ({
  getIgnoredDomains: jest.fn().mockResolvedValue([]),
  StorageManager: {
    getDeveloperMode: jest.fn().mockResolvedValue(false),
  },
}));

describe('BackgroundOrchestrator.emitContentRequest — dynamic injection (Phase C)', () => {
  const CONNECTION_ERROR = new Error(
    'Could not establish connection. Receiving end does not exist.'
  );

  const createTabManagerStub = () => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    setContentResolver: jest.fn(),
    addStatusListener: jest.fn(() => () => undefined),
    addProgressListener: jest.fn(() => () => undefined),
    addErrorListener: jest.fn(() => () => undefined),
    addCommandListener: jest.fn(() => () => undefined),
    getSnapshot: jest.fn().mockReturnValue({
      status: 'idle',
      currentIndex: 0,
      totalCount: 0,
      activeTabId: null,
      tabs: [],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    }),
    resumePlaybackIfNeeded: jest.fn().mockResolvedValue(undefined),
  });

  const createChromeLike = (overrides?: {
    sendMessageImpl?: jest.Mock;
    executeScriptImpl?: jest.Mock;
  }) => {
    const sendMessage = overrides?.sendMessageImpl ?? jest.fn().mockResolvedValue(undefined);
    const executeScript = overrides?.executeScriptImpl ?? jest.fn().mockResolvedValue(undefined);

    return {
      chromeLike: {
        runtime: {
          onConnect: { addListener: jest.fn() },
          onMessage: { addListener: jest.fn() },
          sendMessage: jest.fn().mockResolvedValue(undefined),
        },
        tabs: { sendMessage },
        scripting: { executeScript },
        alarms: {
          create: jest.fn(),
          clear: jest.fn().mockResolvedValue(true),
          onAlarm: { addListener: jest.fn(), removeListener: jest.fn() },
        },
      },
      sendMessage,
      executeScript,
    };
  };

  let BackgroundOrchestrator: any;

  beforeAll(async () => {
    const module = await import('../service');
    BackgroundOrchestrator = module.BackgroundOrchestrator;
  });

  it('calls executeScript then retries sendMessage when initial sendMessage fails with connection error', async () => {
    const sendMessage = jest
      .fn()
      .mockRejectedValueOnce(CONNECTION_ERROR) // first call fails
      .mockResolvedValue(undefined); // retry succeeds
    const executeScript = jest.fn().mockResolvedValue(undefined);

    const { chromeLike } = createChromeLike({
      sendMessageImpl: sendMessage,
      executeScriptImpl: executeScript,
    });
    const tabManager = createTabManagerStub();

    const orchestrator = new BackgroundOrchestrator({ tabManager, chrome: chromeLike });

    // Call private method directly
    await (orchestrator as any).emitContentRequest(42, 'missing');
    // Allow async chain to settle
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 42 },
        files: expect.arrayContaining(['content.js']),
      })
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      42,
      expect.objectContaining({ type: 'EXTRACT_TEXT' })
    );
  });

  it('does not call executeScript when sendMessage succeeds on first try', async () => {
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const executeScript = jest.fn().mockResolvedValue(undefined);

    const { chromeLike } = createChromeLike({
      sendMessageImpl: sendMessage,
      executeScriptImpl: executeScript,
    });
    const tabManager = createTabManagerStub();

    const orchestrator = new BackgroundOrchestrator({ tabManager, chrome: chromeLike });

    await (orchestrator as any).emitContentRequest(10, 'missing');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(executeScript).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('logs warning and does not throw when executeScript also fails', async () => {
    const sendMessage = jest.fn().mockRejectedValue(CONNECTION_ERROR);
    const executeScript = jest.fn().mockRejectedValue(new Error('Cannot inject into this page'));

    const { chromeLike } = createChromeLike({
      sendMessageImpl: sendMessage,
      executeScriptImpl: executeScript,
    });
    const tabManager = createTabManagerStub();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    const orchestrator = new BackgroundOrchestrator({ tabManager, chrome: chromeLike, logger });

    await expect((orchestrator as any).emitContentRequest(99, 'missing')).resolves.not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('99'), expect.any(Error));
  });

  it('falls back to error log (not executeScript) for non-connection errors', async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error('Permission denied'));
    const executeScript = jest.fn().mockResolvedValue(undefined);

    const { chromeLike } = createChromeLike({
      sendMessageImpl: sendMessage,
      executeScriptImpl: executeScript,
    });
    const tabManager = createTabManagerStub();
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    const orchestrator = new BackgroundOrchestrator({ tabManager, chrome: chromeLike, logger });

    await (orchestrator as any).emitContentRequest(55, 'missing');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(executeScript).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
