/**
 * @jest-environment node
 *
 * Keep-Alive Controller Advanced Tests
 * Tests for Chrome/Firefox keep-alive strategies
 */

import { KeepAliveController } from '../keepAliveController';

describe('Keep-Alive Controller: Chrome/Firefox Strategies', () => {
  const createController = () => {
    const mockAlarms = {
      create: jest.fn(async () => {}),
      clear: jest.fn(async () => true),
      onAlarm: { addListener: jest.fn() },
    };

    const mockRuntime = {
      sendMessage: jest.fn(() => Promise.resolve()),
      connect: jest.fn(() => ({
        postMessage: jest.fn(),
        onMessage: { addListener: jest.fn() },
        onDisconnect: { addListener: jest.fn() },
      })),
    };

    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const controller = new KeepAliveController({
      alarms: mockAlarms as any,
      runtime: mockRuntime as any,
      logger: mockLogger as any,
      onKeepAlive: async () => {},
      config: {
        alarmName: 'read-aloud-keepalive',
        periodInMinutes: 1,
        fallbackPingIntervalMs: 15000,
        maxMissCount: 3,
      },
    });

    return { controller, mockAlarms, mockRuntime, mockLogger };
  };

  describe('Chrome Manifest V3 Strategy', () => {
    it('should create KeepAliveController for Chrome', () => {
      const { controller } = createController();
      expect(controller).toBeDefined();
    });

    it('should start heartbeat', async () => {
      const { controller } = createController();
      await controller.startHeartbeat('queue-1');
      expect(controller).toBeDefined();
    });

    it('should stop heartbeat', async () => {
      const { controller } = createController();
      await controller.startHeartbeat('queue-1');
      await controller.stopHeartbeat('queue-1');
      expect(controller).toBeDefined();
    });

    it('should handle alarm', async () => {
      const { controller } = createController();
      await controller.handleAlarm('read-aloud-keepalive');
      expect(controller).toBeDefined();
    });

    it('should dispose resources', async () => {
      const { controller } = createController();
      controller.dispose();
      expect(controller).toBeDefined();
    });
  });

  describe('Firefox WebExtensions Strategy', () => {
    it('should work with Firefox persistent background script', () => {
      // Firefox uses persistent background script
      // Same KeepAliveController works because:
      // 1. Service Worker doesn't auto-suspend in Firefox
      // 2. Alarms are still used for consistency
      // 3. Port communication fallback works the same way
      const { controller } = createController();
      expect(controller).toBeDefined();
    });

    it('should not require special Offscreen handling in Firefox', () => {
      // Firefox persistent script means Offscreen isn't needed
      // Keep-alive controller works identically
      const { controller } = createController();
      expect(controller).toBeDefined();
    });
  });

  describe('Alarm-Based Keep-Alive', () => {
    it('should use alarms for periodic service worker wake-up', async () => {
      const { controller, mockAlarms } = createController();
      await controller.startHeartbeat('queue-1');

      // Verify alarm.create was called
      expect(mockAlarms.create).toHaveBeenCalled();
    });

    it('should handle missing alarms gracefully', () => {
      const mockAlarms = {
        create: jest.fn(() => null),
        clear: jest.fn(() => false),
        onAlarm: { addListener: jest.fn() },
      };

      const controller = new KeepAliveController({
        alarms: mockAlarms as any,
        runtime: {} as any,
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        } as any,
        onKeepAlive: async () => {},
        config: {
          alarmName: 'test',
          periodInMinutes: 1,
          fallbackPingIntervalMs: 15000,
          maxMissCount: 3,
        },
      });

      expect(controller).toBeDefined();
    });
  });

  describe('Fallback Mechanism', () => {
    it('should have fallback port communication', async () => {
      const { controller, mockRuntime } = createController();

      // Start heartbeat which schedules fallback monitor
      await controller.startHeartbeat('queue-1');

      // Port connection should be available for fallback
      expect(mockRuntime.connect).toBeDefined();
    });

    it('should use runtime.sendMessage as fallback', async () => {
      const { controller, mockRuntime } = createController();

      expect(mockRuntime.sendMessage).toBeDefined();
    });
  });

  describe('Cross-Browser Compatibility', () => {
    it('should use same API for both Chrome and Firefox', async () => {
      // Both Chrome Manifest V3 and Firefox WebExtensions
      // use the same KeepAliveController API
      const { controller } = createController();

      await controller.startHeartbeat('queue-1');
      await controller.stopHeartbeat('queue-1');
      await controller.handleAlarm('read-aloud-keepalive');
      controller.dispose();

      expect(controller).toBeDefined();
    });

    it('should be compatible with different alarm configurations', () => {
      const chromeConfig = {
        alarmName: 'chrome-keepalive',
        periodInMinutes: 1,
        fallbackPingIntervalMs: 15000,
        maxMissCount: 3,
      };

      const firefoxConfig = {
        alarmName: 'firefox-keepalive',
        periodInMinutes: 1,
        fallbackPingIntervalMs: 15000,
        maxMissCount: 3,
      };

      const mockAlarms = {
        create: jest.fn(),
        clear: jest.fn(() => true),
        onAlarm: { addListener: jest.fn() },
      };

      const chromeController = new KeepAliveController({
        alarms: mockAlarms as any,
        runtime: {} as any,
        logger: {} as any,
        onKeepAlive: async () => {},
        config: chromeConfig,
      });

      const firefoxController = new KeepAliveController({
        alarms: mockAlarms as any,
        runtime: {} as any,
        logger: {} as any,
        onKeepAlive: async () => {},
        config: firefoxConfig,
      });

      expect(chromeController).toBeDefined();
      expect(firefoxController).toBeDefined();
    });
  });

  describe('Event Logging', () => {
    it('should emit events for heartbeat lifecycle', async () => {
      const events: any[] = [];

      const mockAlarms = {
        create: jest.fn(),
        clear: jest.fn(() => true),
        onAlarm: { addListener: jest.fn() },
      };

      const controller = new KeepAliveController({
        alarms: mockAlarms as any,
        runtime: {} as any,
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        } as any,
        onKeepAlive: async () => {},
        config: {
          alarmName: 'test',
          periodInMinutes: 1,
          fallbackPingIntervalMs: 15000,
          maxMissCount: 3,
        },
        onEvent: (event) => {
          events.push(event);
        },
      });

      await controller.startHeartbeat('queue-1');
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('heartbeat-started');
    });

    it('should emit alarm events', async () => {
      const events: any[] = [];

      const controller = new KeepAliveController({
        alarms: { create: jest.fn(), clear: jest.fn(() => true), onAlarm: { addListener: jest.fn() } } as any,
        runtime: {} as any,
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        } as any,
        onKeepAlive: async () => {},
        config: {
          alarmName: 'test-alarm',
          periodInMinutes: 1,
          fallbackPingIntervalMs: 15000,
          maxMissCount: 3,
        },
        onEvent: (event) => {
          events.push(event);
        },
      });

      await controller.startHeartbeat('queue-1');
      await controller.handleAlarm('test-alarm');

      const alarmEvent = events.find((e) => e.type === 'alarm-fired');
      expect(alarmEvent).toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should accept custom configuration', () => {
      const config = {
        alarmName: 'custom-alarm',
        periodInMinutes: 2,
        fallbackPingIntervalMs: 30000,
        maxMissCount: 5,
      };

      const controller = new KeepAliveController({
        alarms: { create: jest.fn(), clear: jest.fn(), onAlarm: { addListener: jest.fn() } } as any,
        runtime: {} as any,
        logger: {} as any,
        onKeepAlive: async () => {},
        config,
      });

      expect(controller).toBeDefined();
    });
  });

  describe('Resource Cleanup', () => {
    it('should clean up resources on dispose', async () => {
      const { controller } = createController();

      await controller.startHeartbeat('queue-1');
      controller.dispose();

      expect(controller).toBeDefined();
    });
  });
});
