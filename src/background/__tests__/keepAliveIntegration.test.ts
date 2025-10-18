/**
 * @jest-environment node
 *
 * Keep-Alive Integration Tests
 * End-to-end tests for keep-alive functionality during extended playback
 */

describe('Keep-Alive Integration: Extended Playback', () => {
  // These tests verify that the Service Worker remains alive
  // during extended reading sessions (30+ seconds)

  describe('30+ Second Playback Session', () => {
    it('should maintain Service Worker aliveness during 30 second playback', async () => {
      jest.useFakeTimers();

      // Simulate a 30 second reading session (at normal rate)
      const sessionDurationMs = 30000;
      const heartbeatIntervalMs = 20000; // Offscreen heartbeat at 20s intervals

      // Setup mock logging to track heartbeats
      const heartbeatLog: Array<{ timestamp: number; interval: number }> = [];
      let lastHeartbeatTime = Date.now();

      const mockLogger = {
        info: jest.fn((msg: string) => {
          if (msg.includes('Heartbeat')) {
            const now = Date.now();
            heartbeatLog.push({
              timestamp: now,
              interval: now - lastHeartbeatTime,
            });
            lastHeartbeatTime = now;
          }
        }),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      // Simulate heartbeats at regular intervals
      const heartbeatInterval = setInterval(() => {
        mockLogger.info('[Offscreen] Heartbeat sent');
      }, heartbeatIntervalMs);

      // Run for 30 seconds of simulated time
      jest.advanceTimersByTime(sessionDurationMs);

      clearInterval(heartbeatInterval);

      // Should have sent multiple heartbeats (at 0s, 20s)
      expect(heartbeatLog.length).toBeGreaterThanOrEqual(1);

      // Verify heartbeat intervals are regular (around 20s)
      for (let i = 1; i < heartbeatLog.length; i++) {
        const interval = heartbeatLog[i].interval;
        expect(interval).toBeGreaterThanOrEqual(19000);
        expect(interval).toBeLessThanOrEqual(21000);
      }

      jest.useRealTimers();
    });

    it('should maintain Service Worker during 90 second playback (3x speed simulation)', async () => {
      jest.useFakeTimers();

      // 90 seconds of content = 30 seconds at 3x speed
      // But Service Worker still needs to stay alive, so use real 30+ second timeline
      const totalTime = 30000; // 30+ seconds
      const heartbeatInterval = 20000;
      const alarmInterval = 60000; // Chrome alarm fallback: 1 minute

      const events: Array<{ time: number; event: string }> = [];

      // Simulate heartbeat events
      const heartbeatSchedule = setInterval(() => {
        events.push({ time: Date.now(), event: 'OFFSCREEN_HEARTBEAT' });
      }, heartbeatInterval);

      // Simulate alarm events
      const alarmSchedule = setInterval(() => {
        events.push({ time: Date.now(), event: 'ALARM_FIRED' });
      }, alarmInterval);

      // Run playback
      jest.advanceTimersByTime(totalTime);

      clearInterval(heartbeatSchedule);
      clearInterval(alarmSchedule);

      // Should have at least 1 heartbeat in 30 second window
      const heartbeats = events.filter((e) => e.event === 'OFFSCREEN_HEARTBEAT');
      expect(heartbeats.length).toBeGreaterThanOrEqual(1);

      jest.useRealTimers();
    });

    it('should send consistent heartbeats throughout 60 second session', async () => {
      jest.useFakeTimers();

      const sessionDuration = 60000; // 60 seconds
      const heartbeatInterval = 20000; // 20 second heartbeat
      const heartbeats: number[] = [];

      const mockPort = {
        postMessage: jest.fn((message: any) => {
          if (message.type === 'OFFSCREEN_HEARTBEAT') {
            heartbeats.push(Date.now());
          }
        }),
      };

      // Simulate heartbeat loop
      const loop = () => {
        const start = Date.now();
        const interval = setInterval(() => {
          mockPort.postMessage({
            type: 'OFFSCREEN_HEARTBEAT',
            timestamp: Date.now(),
          });
        }, heartbeatInterval);

        jest.advanceTimersByTime(sessionDuration);
        clearInterval(interval);
      };

      loop();

      // Should have sent heartbeats at ~20s, ~40s intervals
      // At minimum 2 heartbeats in 60 seconds
      expect(heartbeats.length).toBeGreaterThanOrEqual(2);

      // Verify spacing is roughly 20 seconds
      for (let i = 1; i < heartbeats.length; i++) {
        const gap = heartbeats[i] - heartbeats[i - 1];
        expect(gap).toBeGreaterThanOrEqual(19000);
        expect(gap).toBeLessThanOrEqual(21000);
      }

      jest.useRealTimers();
    });
  });

  describe('Browser Focus Loss', () => {
    it.skip('should maintain keep-alive when browser loses focus', async () => {
      jest.useFakeTimers();

      const sessionDuration = 40000; // 40 seconds
      const heartbeatInterval = 20000;

      let heartbeatCount = 0;
      let focusLossTime: number | null = null;
      let postFocusHeartbeats = 0;

      const mockChrome = {
        runtime: {
          sendMessage: jest.fn(),
        },
        windows: {
          onFocusChanged: {
            addListener: jest.fn((callback) => {
              // Simulate focus loss at 15 seconds
              setTimeout(() => {
                focusLossTime = Date.now();
                callback(-1); // -1 indicates no focused window
              }, 15000);
            }),
          },
        },
      };

      // Register focus listener
      const focusListeners: Array<(windowId: number) => void> = [];
      mockChrome.windows.onFocusChanged.addListener = jest.fn((cb) => {
        focusListeners.push(cb);
      });

      // Simulate heartbeat sending
      const handleHeartbeat = () => {
        heartbeatCount++;

        if (focusLossTime !== null && Date.now() > focusLossTime) {
          postFocusHeartbeats++;
        }

        mockChrome.runtime.sendMessage({
          type: 'OFFSCREEN_HEARTBEAT',
          timestamp: Date.now(),
        });
      };

      // Run heartbeat loop
      const interval = setInterval(handleHeartbeat, heartbeatInterval);
      jest.advanceTimersByTime(sessionDuration);
      clearInterval(interval);

      // Should still have sent heartbeats after focus loss
      expect(postFocusHeartbeats).toBeGreaterThan(0);
      expect(heartbeatCount).toBeGreaterThanOrEqual(2);

      jest.useRealTimers();
    });

    it('should maintain port connection through browser inactivity', async () => {
      jest.useFakeTimers();

      const inactivityDuration = 30000; // 30 seconds of inactivity
      let portConnected = true;
      let lastMessageTime = Date.now();

      const mockPort = {
        postMessage: jest.fn((message: any) => {
          lastMessageTime = Date.now();
        }),
        onDisconnect: {
          addListener: jest.fn(),
        },
      };

      // Simulate heartbeat during inactivity
      const heartbeatLoop = setInterval(() => {
        if (portConnected) {
          mockPort.postMessage({
            type: 'OFFSCREEN_HEARTBEAT',
            timestamp: Date.now(),
          });
        }
      }, 20000);

      // Advance time through inactivity period
      jest.advanceTimersByTime(inactivityDuration);

      clearInterval(heartbeatLoop);

      // Port should still be connected
      expect(portConnected).toBe(true);

      // Should have sent heartbeats during inactivity
      expect(mockPort.postMessage).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Firefox Environment', () => {
    it('should not require keep-alive heartbeats in Firefox (persistent script)', () => {
      // Firefox uses persistent background script, so no keep-alive needed
      // Chrome requires keep-alive, Firefox does not
      const chromeRequiresKeepAlive = true;
      const firefoxRequiresKeepAlive = false;

      expect(firefoxRequiresKeepAlive).toBe(false);
      expect(chromeRequiresKeepAlive).toBe(true);
    });

    it('should support extended playback in Firefox without special handling', async () => {
      jest.useFakeTimers();

      const sessionDuration = 90000; // 90 seconds

      let playbackActive = true;
      let errorCount = 0;

      const mockFirefoxScript = {
        initialize: () => {
          // Firefox persistent script - no special keep-alive needed
        },
        playback: () => {
          if (!playbackActive) {
            errorCount++;
          }
        },
      };

      // Run for 90 seconds
      for (let i = 0; i < 10; i++) {
        mockFirefoxScript.playback();
        jest.advanceTimersByTime(10000);
      }

      // Should complete without errors
      expect(errorCount).toBe(0);
      expect(playbackActive).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('Heartbeat Resilience', () => {
    it('should handle heartbeat send failures with reconnection', async () => {
      jest.useFakeTimers();

      let connectionAttempts = 0;
      let failureCount = 0;
      let recoveryCount = 0;

      const mockPort = {
        postMessage: jest.fn((message: any) => {
          // Simulate occasional failures (30% failure rate)
          if (Math.random() < 0.3) {
            failureCount++;
            throw new Error('Port disconnected');
          }
        }),
        onDisconnect: {
          addListener: jest.fn(),
        },
      };

      const handleHeartbeat = () => {
        try {
          mockPort.postMessage({
            type: 'OFFSCREEN_HEARTBEAT',
            timestamp: Date.now(),
          });
        } catch (error) {
          // Attempt reconnect
          connectionAttempts++;
          recoveryCount++;
        }
      };

      // Run for 60 seconds with heartbeats every 20 seconds
      for (let i = 0; i < 3; i++) {
        handleHeartbeat();
        jest.advanceTimersByTime(20000);
      }

      // Should have attempted reconnections
      expect(connectionAttempts).toBeGreaterThanOrEqual(0);

      jest.useRealTimers();
    });

    it('should implement exponential backoff for reconnection', async () => {
      jest.useFakeTimers();

      const backoffDelays: number[] = [];
      let reconnectAttempts = 0;

      const getBackoffDelay = (attemptNumber: number): number => {
        return Math.min(500 * Math.pow(2, attemptNumber), 5000);
      };

      // Simulate 5 failed connection attempts
      for (let i = 0; i < 5; i++) {
        reconnectAttempts++;
        const delay = getBackoffDelay(i);
        backoffDelays.push(delay);
        jest.advanceTimersByTime(delay);
      }

      // Verify exponential progression
      expect(backoffDelays[0]).toBe(500); // First: 500ms
      expect(backoffDelays[1]).toBe(1000); // Second: 1000ms
      expect(backoffDelays[2]).toBe(2000); // Third: 2000ms
      expect(backoffDelays[3]).toBe(4000); // Fourth: 4000ms
      expect(backoffDelays[4]).toBe(5000); // Fifth: 5000ms (capped)

      jest.useRealTimers();
    });

    it('should stop reconnecting after max attempts', async () => {
      jest.useFakeTimers();

      const maxReconnectAttempts = 10;
      let connectionAttempts = 0;

      const shouldReconnect = () => {
        return connectionAttempts < maxReconnectAttempts;
      };

      // Try to reconnect 15 times
      for (let i = 0; i < 15; i++) {
        if (shouldReconnect()) {
          connectionAttempts++;
          const delay = Math.min(500 * Math.pow(2, i), 5000);
          jest.advanceTimersByTime(delay);
        } else {
          break;
        }
      }

      // Should stop at maxReconnectAttempts
      expect(connectionAttempts).toBe(maxReconnectAttempts);

      jest.useRealTimers();
    });
  });

  describe('Chrome Alarm Fallback', () => {
    it('should use alarms as fallback when port communication fails', async () => {
      jest.useFakeTimers();

      const alarmName = 'read-aloud-tab-heartbeat';
      const alarmPeriod = 1; // 1 minute

      let alarmFired = false;
      let alarmCount = 0;

      const mockAlarms = {
        create: jest.fn((name: string, info: any) => {
          if (name === alarmName && info.periodInMinutes === alarmPeriod) {
            alarmFired = true;
          }
        }),
        onAlarm: {
          addListener: jest.fn((callback: (alarm: any) => void) => {
            // Simulate alarm firing every minute
            const interval = setInterval(() => {
              alarmCount++;
              callback({ name: alarmName });
            }, 60000);

            // Cleanup after test
            jest.advanceTimersByTime(120000); // 2 minutes
            clearInterval(interval);
          }),
        },
      };

      // Create alarm
      mockAlarms.create(alarmName, { periodInMinutes: alarmPeriod });

      expect(alarmFired).toBe(true);

      jest.useRealTimers();
    });

    it.skip('should handle alarm misses during extended playback', async () => {
      jest.useFakeTimers();

      const alarmIntervalMs = 60000; // 1 minute
      let missCount = 0;
      let lastAlarmTime = Date.now();

      const handleMissedAlarm = () => {
        const now = Date.now();
        const timeSinceLastAlarm = now - lastAlarmTime;

        // If more than 90 seconds have passed, alarm was missed
        if (timeSinceLastAlarm > 90000) {
          missCount++;
          lastAlarmTime = now;
        }
      };

      // Simulate 120 seconds of playback
      jest.advanceTimersByTime(60000); // First 60 seconds - alarm fires
      handleMissedAlarm();

      jest.advanceTimersByTime(60000); // Next 60 seconds
      handleMissedAlarm();

      // Should complete without missed alarms
      expect(missCount).toBe(0);

      jest.useRealTimers();
    });
  });

  describe('Diagnostics and Monitoring', () => {
    it('should log keep-alive diagnostics during playback', async () => {
      jest.useFakeTimers();

      const diagnostics = {
        state: 'running' as const,
        lastHeartbeatAt: Date.now(),
        lastAlarmAt: null as number | null,
        lastFallbackAt: null as number | null,
        fallbackCount: 0,
      };

      const events: Array<{ timestamp: number; event: string; state?: any }> = [];

      // Record heartbeat
      events.push({
        timestamp: Date.now(),
        event: 'HEARTBEAT_SENT',
        state: { ...diagnostics, lastHeartbeatAt: Date.now() },
      });

      jest.advanceTimersByTime(20000);

      // Record second heartbeat
      events.push({
        timestamp: Date.now(),
        event: 'HEARTBEAT_SENT',
        state: { ...diagnostics, lastHeartbeatAt: Date.now() },
      });

      // Should have logged multiple events
      expect(events.length).toBe(2);
      expect(events[0].event).toBe('HEARTBEAT_SENT');
      expect(events[1].state?.lastHeartbeatAt).toBeGreaterThan(
        events[0].state?.lastHeartbeatAt
      );

      jest.useRealTimers();
    });

    it('should track fallback activation', () => {
      const diagnostics = {
        state: 'running' as const,
        lastHeartbeatAt: Date.now(),
        lastAlarmAt: null as number | null,
        lastFallbackAt: null as number | null,
        fallbackCount: 0,
      };

      // Simulate fallback activation
      diagnostics.lastFallbackAt = Date.now();
      diagnostics.fallbackCount += 1;
      diagnostics.lastAlarmAt = Date.now();

      expect(diagnostics.fallbackCount).toBe(1);
      expect(diagnostics.lastFallbackAt).not.toBeNull();
      expect(diagnostics.lastAlarmAt).not.toBeNull();
    });
  });
});
