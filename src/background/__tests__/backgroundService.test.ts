import { QueueCommandMessage, QueueStatusPayload } from '../../shared/messages';
import { getIgnoredDomains } from '../../shared/utils/storage';

// Mock BrowserAdapter to disable Offscreen API
jest.mock('../../shared/utils/browser', () => ({
  BrowserAdapter: {
    getInstance: jest.fn(),
    getBrowserType: jest.fn().mockReturnValue('chrome'),
    isFeatureSupported: jest.fn().mockReturnValue(false), // Disable offscreen API
  },
}));

jest.mock('../../shared/utils/storage', () => ({
  getIgnoredDomains: jest.fn().mockResolvedValue([]),
  StorageManager: {
    getDeveloperMode: jest.fn().mockResolvedValue(false),
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
      clearQueue: jest.fn().mockResolvedValue(undefined),
      reorderTabs: jest.fn().mockResolvedValue(undefined),
      skipTab: jest.fn().mockResolvedValue(undefined),
      processNext: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn().mockResolvedValue(undefined),
      refreshIgnoredDomains: jest.fn().mockResolvedValue(undefined),
      resumePlaybackIfNeeded: jest.fn().mockResolvedValue(undefined),
    } as any;

    return { stub, listeners };
  };

  const createKeepAliveStub = () => {
    return {
      startHeartbeat: jest.fn(async () => undefined),
      stopHeartbeat: jest.fn(async () => undefined),
      handleAlarm: jest.fn(async () => undefined),
    };
  };

  const createChromeLike = () => {
    const runtimeListeners: Function[] = [];
    const runtimeMessageListeners: Function[] = [];
    const ports: any[] = [];
    let commandListener: ((command: string) => void) | null = null;
    const alarmListeners: Array<(alarm: { name: string }) => void> = [];

    const chromeLike = {
      runtime: {
        onConnect: {
          addListener: jest.fn((listener: Function) => runtimeListeners.push(listener)),
        },
        onMessage: {
          addListener: jest.fn((listener: Function) => runtimeMessageListeners.push(listener)),
        },
        sendMessage: jest.fn().mockResolvedValue(undefined),
        connect: jest.fn(() => ({
          name: 'keep-alive-fallback',
          postMessage: jest.fn(),
          disconnect: jest.fn(),
          onDisconnect: { addListener: jest.fn() },
        })),
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
      alarms: {
        create: jest.fn(),
        clear: jest.fn().mockResolvedValue(true),
        onAlarm: {
          addListener: jest.fn((listener: (alarm: { name: string }) => void) => alarmListeners.push(listener)),
          removeListener: jest.fn((listener: (alarm: { name: string }) => void) => {
            const index = alarmListeners.indexOf(listener);
            if (index >= 0) {
              alarmListeners.splice(index, 1);
            }
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
      return commandListener?.(command);
    }
    const emitAlarm = (name: string) => {
      alarmListeners.forEach((listener) => listener({ name }));
    };
    return { chromeLike, connectPort, emitRuntimeMessage, triggerCommand, ports, emitAlarm };
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

  test('reading 状態で keepAlive を開始し idle/paused で停止する', async () => {
    const { stub, listeners } = createTabManagerStub();
    const keepAlive = createKeepAliveStub();
    const { chromeLike } = createChromeLike();

    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike, keepAliveController: keepAlive });
    await orchestrator.initialize();

    const statusListener = listeners.status;
    statusListener({
      status: 'reading',
      currentIndex: 0,
      totalCount: 1,
      activeTabId: 99,
      tabs: [],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    });

    expect(keepAlive.startHeartbeat).toHaveBeenCalled();

    statusListener({
      status: 'paused',
      currentIndex: 0,
      totalCount: 1,
      activeTabId: 99,
      tabs: [],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    });

    expect(keepAlive.stopHeartbeat).toHaveBeenCalled();
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

  test('read-aloud-toggle ショートカットでキュー制御を行う', async () => {
    const { stub } = createTabManagerStub();
    const snapshot: QueueStatusPayload = {
      status: 'reading',
      currentIndex: 0,
      totalCount: 1,
      activeTabId: 1,
      tabs: [{
        tabId: 1,
        url: 'https://example.com',
        title: 'Test',
        isIgnored: false,
        extractedAt: new Date(),
      } as any],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    } as QueueStatusPayload;
    stub.getSnapshot.mockImplementation(() => snapshot);

    const { chromeLike, triggerCommand } = createChromeLike();
    chromeLike.tabs.query
      .mockResolvedValueOnce([{ id: 11, url: 'https://example.com/article', title: 'Article' }]) // ensureActiveTabInQueue
      .mockResolvedValue([]);

    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike });
    await orchestrator.initialize();

    await triggerCommand('read-aloud-toggle');
    expect(stub.pause).toHaveBeenCalled();

    snapshot.status = 'paused';
    await triggerCommand('read-aloud-toggle');
    expect(stub.resume).toHaveBeenCalled();

    snapshot.status = 'idle';
    snapshot.tabs = [];
    snapshot.totalCount = 0;

    await triggerCommand('read-aloud-toggle');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeLike.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(stub.addTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 11 }),
      expect.objectContaining({ position: 'end', autoStart: false }),
    );
    expect(stub.processNext).toHaveBeenCalled();
  });

  test('read-aloud-queue-all ショートカットでタブを一括追加して再生する', async () => {
    const { stub } = createTabManagerStub();
    const snapshot: QueueStatusPayload = {
      status: 'idle',
      currentIndex: 0,
      totalCount: 0,
      activeTabId: null,
      tabs: [],
      settings: { rate: 1, pitch: 1, volume: 1, voice: null },
      updatedAt: Date.now(),
    } as QueueStatusPayload;
    stub.getSnapshot.mockImplementation(() => snapshot);

    (getIgnoredDomains as jest.Mock).mockResolvedValue(['ignored.example']);

    const { chromeLike, triggerCommand } = createChromeLike();
    chromeLike.tabs.query
      .mockResolvedValueOnce([
        { id: 1, url: 'https://valid.example/article', title: 'Valid' },
        { id: 2, url: 'chrome://extensions' },
        { id: 3, url: 'https://ignored.example/page', title: 'Ignored' },
      ])
      .mockResolvedValueOnce([{ id: 4, url: 'https://second.example/post', title: 'Second' }])
      .mockResolvedValue([]);

    const orchestrator = new BackgroundOrchestrator({ tabManager: stub, chrome: chromeLike });
    await orchestrator.initialize();

    await triggerCommand('read-aloud-queue-all');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stub.addTab).toHaveBeenCalledTimes(1);
    expect(stub.addTab).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: 1, url: 'https://valid.example/article' }),
      expect.objectContaining({ position: 'end', autoStart: false }),
    );
    expect(stub.processNext).toHaveBeenCalled();

    snapshot.status = 'paused';
    snapshot.tabs = [{
      tabId: 4,
      url: 'https://second.example/post',
      title: 'Second',
      isIgnored: false,
      extractedAt: new Date().toISOString(),
    } as any];
    snapshot.totalCount = 1;
    snapshot.activeTabId = 4;
    await triggerCommand('read-aloud-queue-all');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stub.resume).toHaveBeenCalled();
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
