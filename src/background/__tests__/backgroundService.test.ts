import { QueueCommandMessage, QueueStatusPayload } from '../../shared/messages';

// Mock BrowserAdapter to disable Offscreen API
jest.mock('../../shared/utils/browser', () => ({
  BrowserAdapter: {
    getInstance: jest.fn(),
    getBrowserType: jest.fn().mockReturnValue('chrome'),
    isFeatureSupported: jest.fn().mockReturnValue(false), // Disable offscreen API
  },
}));

describe('BackgroundOrchestrator', () => {
  const createTabManagerStub = () => {
    const listeners: Record<string, Function> = {};

    const stub = {
      initialize: jest.fn().mockResolvedValue(undefined),
      addStatusListener: jest.fn((listener: (payload: QueueStatusPayload) => void) => {
        listeners.status = listener;
        return () => delete listeners.status;
      }),
      addProgressListener: jest.fn(() => () => undefined),
      addErrorListener: jest.fn(() => () => undefined),
      addCommandListener: jest.fn((listener: any) => {
        listeners.command = listener;
        return () => delete listeners.command;
      }),
      getSnapshot: jest.fn().mockReturnValue({
        status: 'idle',
        currentIndex: 0,
        totalCount: 0,
        activeTabId: null,
        tabs: [],
        settings: { rate: 1, pitch: 1, volume: 1, voice: null },
        updatedAt: Date.now(),
      }),
      addTab: jest.fn().mockResolvedValue(undefined),
      removeTab: jest.fn().mockResolvedValue(undefined),
      reorderTabs: jest.fn().mockResolvedValue(undefined),
      skipTab: jest.fn().mockResolvedValue(undefined),
      clearQueue: jest.fn().mockResolvedValue(undefined),
      processNext: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined),
      refreshIgnoredDomains: jest.fn().mockResolvedValue(undefined),
    } as any;

    return { stub, listeners };
  };

  const createChromeLike = () => {
    const runtimeListeners: Function[] = [];
    const runtimeMessageListeners: Function[] = [];
    const ports: any[] = [];
    let commandListener: ((command: string) => void) | null = null;

    const chromeLike = {
      runtime: {
        onConnect: {
          addListener: jest.fn((listener: Function) => runtimeListeners.push(listener)),
        },
        onMessage: {
          addListener: jest.fn((listener: Function) => runtimeMessageListeners.push(listener)),
        },
        sendMessage: jest.fn().mockResolvedValue(undefined),
      },
      tabs: {
        sendMessage: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue([]),
      },
      commands: {
        onCommand: {
          addListener: jest.fn((listener: (command: string) => void) => {
            commandListener = listener;
          }),
        },
      },
    };

    const connectPort = () => {
      const port = {
        name: 'popup',
        onMessage: { addListener: jest.fn() },
        onDisconnect: { addListener: jest.fn() },
        postMessage: jest.fn(),
      };
      ports.push(port);
      runtimeListeners.forEach((listener) => listener(port));
      return port;
    };

    const emitRuntimeMessage = async (message: any, sender: any = {}, sendResponse: any = jest.fn()) => {
      const promises = runtimeMessageListeners.map((listener) => listener(message, sender, sendResponse));
      await Promise.all(promises);
      return sendResponse;
    };

    function triggerCommand(command: string) {
      commandListener?.(command);
    }
    return { chromeLike, connectPort, emitRuntimeMessage, triggerCommand, ports };
  };

  let BackgroundOrchestrator: any;

  beforeAll(async () => {
    const module = await import('../service');
    BackgroundOrchestrator = module.BackgroundOrchestrator;
  });

  test('初期化時にTabManagerへ初期化要求とリスナー登録を行う', async () => {
    const { stub, listeners } = createTabManagerStub();
    const { chromeLike, connectPort } = createChromeLike();

    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike });
    await orchestrator.initialize();

    expect(stub.initialize).toHaveBeenCalled();
    expect(stub.addStatusListener).toHaveBeenCalled();
    expect(stub.addCommandListener).toHaveBeenCalled();

    // Port接続
    const port = connectPort();

    const statusListener = listeners.status;
    expect(typeof statusListener).toBe('function');

    // ステータス更新をトリガー
    statusListener({
      status: 'reading',
      currentIndex: 0,
      totalCount: 1,
      activeTabId: 10,
      tabs: [],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    });

    // Port経由でメッセージが送信されることを検証
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'QUEUE_STATUS_UPDATE',
      payload: expect.objectContaining({ status: 'reading' }),
    });
  });

  test('QUEUE_ADD メッセージをTabManagerに転送する', async () => {
    const { stub } = createTabManagerStub();
    const { chromeLike, emitRuntimeMessage } = createChromeLike();
    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike });
    await orchestrator.initialize();

    const message: QueueCommandMessage = {
      type: 'QUEUE_ADD',
      payload: {
        tab: {
          tabId: 123,
          url: 'https://example.com',
          title: 'Example',
        },
      },
    };

    const sendResponse = jest.fn();
    await emitRuntimeMessage(message, {}, sendResponse);

    expect(stub.addTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 123 }),
      expect.objectContaining({ position: undefined, autoStart: undefined }),
    );
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  test('QUEUE_CLEAR メッセージでキューをリセットする', async () => {
    const { stub } = createTabManagerStub();
    const { chromeLike, emitRuntimeMessage } = createChromeLike();
    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike });
    await orchestrator.initialize();

    const message: QueueCommandMessage = {
      type: 'QUEUE_CLEAR',
    } as QueueCommandMessage;

    const sendResponse = jest.fn();
    await emitRuntimeMessage(message, {}, sendResponse);

    expect(stub.clearQueue).toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  test('ポート接続時に最新状態を即時送信する', async () => {
    const { stub } = createTabManagerStub();
    stub.getSnapshot.mockReturnValue({
      status: 'idle',
      currentIndex: 0,
      totalCount: 0,
      activeTabId: null,
      tabs: [],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: 123,
    });

    const { chromeLike, connectPort } = createChromeLike();
    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike });
    await orchestrator.initialize();

    const port = connectPort();

    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'QUEUE_STATUS_UPDATE',
      payload: expect.objectContaining({ updatedAt: 123 }),
    });
  });

  test('Queue content request を受けたら対象タブにメッセージを送る', async () => {
    const { stub, listeners } = createTabManagerStub();
    const { chromeLike } = createChromeLike();
    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike });
    await orchestrator.initialize();

    const commandListener = listeners.command;
    commandListener({ type: 'QUEUE_CONTENT_REQUEST', payload: { tabId: 222, reason: 'missing' } });

    expect(chromeLike.tabs.sendMessage).toHaveBeenCalledWith(222, {
      type: 'EXTRACT_TEXT',
      tabId: 222,
    });
  });

  test('キーボードショートカットコマンドを処理する', async () => {
    const { stub } = createTabManagerStub();
    stub.getSnapshot.mockReturnValue({
      status: 'idle',
      currentIndex: 0,
      totalCount: 1,
      activeTabId: null,
      tabs: [{ tabId: 1, url: 'https://example.com', title: 'Test', content: 'test content', isIgnored: false }],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    });
    const { chromeLike, triggerCommand } = createChromeLike();
    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike });
    await orchestrator.initialize();

    triggerCommand('read-aloud-start');
    await new Promise(resolve => setTimeout(resolve, 10)); // Wait for async command
    expect(stub.processNext).toHaveBeenCalled();

    triggerCommand('read-aloud-stop');
    expect(stub.stop).toHaveBeenCalled();

    triggerCommand('read-aloud-next');
    expect(stub.skipTab).toHaveBeenCalledWith('next');

    triggerCommand('read-aloud-prev');
    expect(stub.skipTab).toHaveBeenCalledWith('previous');
  });

  test('KeepAlive diagnostics message updates prefetcher and notifies ports', async () => {
    const { stub } = createTabManagerStub();
    const prefetcher = {
      retry: jest.fn(),
      getStatusSnapshot: jest.fn().mockReturnValue({ statuses: [], updatedAt: 42 }),
      updateKeepAliveDiagnostics: jest.fn(),
    } as any;

    const { chromeLike, connectPort, emitRuntimeMessage } = createChromeLike();
    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike, prefetcher });
    await orchestrator.initialize();

    const port = connectPort();
    port.postMessage.mockClear();

    const diagnosticsMessage = {
      type: 'KEEP_ALIVE_DIAGNOSTICS',
      payload: {
        state: 'running',
        lastHeartbeatAt: 100,
        lastAlarmAt: null,
        lastFallbackAt: null,
        fallbackCount: 1,
      },
    };

    const sendResponse = jest.fn();
    await emitRuntimeMessage(diagnosticsMessage, {}, sendResponse);

    expect(prefetcher.updateKeepAliveDiagnostics).toHaveBeenCalledWith(diagnosticsMessage.payload);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'PREFETCH_STATUS_SYNC',
      payload: { statuses: [], updatedAt: 42 },
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});
