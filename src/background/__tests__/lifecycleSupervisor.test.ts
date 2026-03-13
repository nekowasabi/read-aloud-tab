/**
 * lifecycleSupervisor.test.ts
 * Process 50 Red: lifecycleSupervisor 抽出前の契約テスト
 *
 * These tests define the interface contract for LifecycleSupervisor.
 * They will be expanded once lifecycleSupervisor.ts is extracted from service.ts.
 */
import { LifecycleSupervisor } from '../lifecycleSupervisor';

jest.mock('../../shared/utils/storage', () => ({
  StorageManager: {
    getDeveloperMode: jest.fn().mockResolvedValue(false),
  },
}));

const { StorageManager } = jest.requireMock('../../shared/utils/storage');

describe('LifecycleSupervisor', () => {
  let supervisor: LifecycleSupervisor;
  let mockLogger: {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };
  let mockOnStatusUpdate: jest.Mock;
  let mockOnProgressUpdate: jest.Mock;
  let mockOnError: jest.Mock;
  let mockOnCommandEvent: jest.Mock;
  let mockOnAlarm: jest.Mock;
  let mockRuntime: {
    onMessage: { addListener: jest.Mock };
    onConnect: { addListener: jest.Mock };
  };
  let mockCommands: {
    onCommand: { addListener: jest.Mock };
  };
  let mockAlarms: {
    onAlarm: { addListener: jest.Mock; removeListener: jest.Mock };
    create: jest.Mock;
    clear: jest.Mock;
  };
  let mockStorage: {
    onChanged: { addListener: jest.Mock; removeListener: jest.Mock };
  };
  let mockTabManager: {
    addStatusListener: jest.Mock;
    addProgressListener: jest.Mock;
    addErrorListener: jest.Mock;
    addCommandListener: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockOnStatusUpdate = jest.fn();
    mockOnProgressUpdate = jest.fn();
    mockOnError = jest.fn();
    mockOnCommandEvent = jest.fn();
    mockOnAlarm = jest.fn();

    mockRuntime = {
      onMessage: { addListener: jest.fn() },
      onConnect: { addListener: jest.fn() },
    };

    mockCommands = {
      onCommand: { addListener: jest.fn() },
    };

    mockAlarms = {
      onAlarm: { addListener: jest.fn(), removeListener: jest.fn() },
      create: jest.fn(),
      clear: jest.fn(),
    };

    mockStorage = {
      onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
    };

    mockTabManager = {
      addStatusListener: jest.fn().mockReturnValue(() => undefined),
      addProgressListener: jest.fn().mockReturnValue(() => undefined),
      addErrorListener: jest.fn().mockReturnValue(() => undefined),
      addCommandListener: jest.fn().mockReturnValue(() => undefined),
    };

    supervisor = new LifecycleSupervisor({
      logger: mockLogger,
      runtime: mockRuntime,
      commands: mockCommands,
      alarms: mockAlarms,
      storage: mockStorage,
      tabManager: mockTabManager,
      onRuntimeMessage: jest.fn(),
      onRuntimeConnect: jest.fn(),
      onStatusUpdate: mockOnStatusUpdate,
      onProgressUpdate: mockOnProgressUpdate,
      onError: mockOnError,
      onCommandEvent: mockOnCommandEvent,
      onAlarm: mockOnAlarm,
      onShortcutCommand: jest.fn(),
    });
  });

  describe('registerAll', () => {
    it('should register runtime message listener', () => {
      supervisor.registerAll();
      expect(mockRuntime.onMessage.addListener).toHaveBeenCalledTimes(1);
    });

    it('should register runtime connect listener', () => {
      supervisor.registerAll();
      expect(mockRuntime.onConnect.addListener).toHaveBeenCalledTimes(1);
    });

    it('should register command listeners when commands API is available', () => {
      supervisor.registerAll();
      expect(mockCommands.onCommand.addListener).toHaveBeenCalledTimes(1);
    });

    it('should register alarm listener when alarms API is available', () => {
      supervisor.registerAll();
      expect(mockAlarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    });

    it('should register tab manager status listener', () => {
      supervisor.registerAll();
      expect(mockTabManager.addStatusListener).toHaveBeenCalledTimes(1);
    });

    it('should register tab manager progress listener', () => {
      supervisor.registerAll();
      expect(mockTabManager.addProgressListener).toHaveBeenCalledTimes(1);
    });

    it('should register tab manager error listener', () => {
      supervisor.registerAll();
      expect(mockTabManager.addErrorListener).toHaveBeenCalledTimes(1);
    });

    it('should register tab manager command listener', () => {
      supervisor.registerAll();
      expect(mockTabManager.addCommandListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('should call unsubscribe functions on dispose', () => {
      const unsubscribe1 = jest.fn();
      const unsubscribe2 = jest.fn();
      mockTabManager.addStatusListener.mockReturnValue(unsubscribe1);
      mockTabManager.addProgressListener.mockReturnValue(unsubscribe2);

      supervisor.registerAll();
      supervisor.dispose();

      expect(unsubscribe1).toHaveBeenCalled();
      expect(unsubscribe2).toHaveBeenCalled();
    });
  });

  describe('refreshDeveloperMode', () => {
    it('should load developer mode from storage', async () => {
      StorageManager.getDeveloperMode.mockResolvedValue(true);
      await supervisor.refreshDeveloperMode();
      expect(StorageManager.getDeveloperMode).toHaveBeenCalled();
    });

    it('should default to false on error', async () => {
      StorageManager.getDeveloperMode.mockRejectedValue(new Error('storage error'));
      await expect(supervisor.refreshDeveloperMode()).resolves.not.toThrow();
    });
  });
});
