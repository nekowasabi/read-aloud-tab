import { KeepAliveController } from '../keepAliveController';
import { jest } from '@jest/globals';

describe('KeepAliveController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const createController = () => {
    const alarms = {
      create: jest.fn(async () => undefined),
      clear: jest.fn(async () => true),
    } as const;

    const runtime = {
      sendMessage: jest.fn(async () => undefined),
      connect: jest.fn(() => ({
        name: 'keep-alive-fallback',
        postMessage: jest.fn(),
        disconnect: jest.fn(),
        onDisconnect: { addListener: jest.fn() },
      })),
    } as const;

    const onKeepAlive = jest.fn(async () => undefined);

    const controller = new KeepAliveController({
      alarms,
      runtime,
      logger: console,
      onKeepAlive,
      config: {
        alarmName: 'read-aloud-tab-heartbeat',
        periodInMinutes: 1,
        fallbackPingIntervalMs: 15000,
        maxMissCount: 3,
      },
    });

    return { controller, alarms, runtime, onKeepAlive };
  };

  it('registers heartbeat alarm when startHeartbeat is called', async () => {
    const { controller, alarms } = createController();

    await controller.startHeartbeat('queue-1');

    expect(alarms.create).toHaveBeenCalledWith('read-aloud-tab-heartbeat', {
      delayInMinutes: 1,
      periodInMinutes: 1,
    });
  });

  it('clears heartbeat alarm when stopHeartbeat is called', async () => {
    const { controller, alarms } = createController();

    await controller.startHeartbeat('queue-1');
    await controller.stopHeartbeat('queue-1');

    expect(alarms.clear).toHaveBeenCalledWith('read-aloud-tab-heartbeat');
  });

  it('invokes onKeepAlive when alarm fires', async () => {
    const { controller, onKeepAlive } = createController();

    await controller.startHeartbeat('queue-1');
    await controller.handleAlarm('read-aloud-tab-heartbeat');

    expect(onKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('invokes fallback when alarm misses exceed threshold', async () => {
    const { controller, runtime } = createController();

    await controller.startHeartbeat('queue-1');

    jest.advanceTimersByTime(15000 * 3 + 10);

    expect(runtime.connect).toHaveBeenCalled();
  });
});
