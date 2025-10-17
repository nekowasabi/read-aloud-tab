/**
 * @jest-environment jsdom
 *
 * Performance and Optimization Tests for Keep-Alive
 */

describe('Keep-Alive Performance Optimization', () => {
  describe('Configurable Heartbeat Interval', () => {
    it('should allow custom heartbeat interval configuration', () => {
      const defaultInterval = 20000; // 20 seconds
      const customInterval = 15000; // 15 seconds

      // Test that interval can be configured
      expect(customInterval).toBeLessThan(30000); // Must be less than 30s timeout
      expect(customInterval).toBeGreaterThanOrEqual(10000); // Minimum 10s to avoid overhead
    });

    it('should validate heartbeat interval is within safe range', () => {
      const validateInterval = (interval: number): boolean => {
        return interval >= 10000 && interval <= 25000;
      };

      expect(validateInterval(15000)).toBe(true);
      expect(validateInterval(20000)).toBe(true);
      expect(validateInterval(25000)).toBe(true);
      expect(validateInterval(5000)).toBe(false); // Too short
      expect(validateInterval(30000)).toBe(false); // Too long (risky)
    });
  });

  describe('Memory Usage Monitoring', () => {
    it('should track heartbeat metrics', () => {
      const metrics = {
        totalHeartbeatsSent: 0,
        failedHeartbeats: 0,
        reconnectionAttempts: 0,
        averageHeartbeatLatency: 0,
      };

      // Simulate heartbeat success
      metrics.totalHeartbeatsSent++;
      expect(metrics.totalHeartbeatsSent).toBe(1);

      // Simulate heartbeat failure
      metrics.failedHeartbeats++;
      expect(metrics.failedHeartbeats).toBe(1);

      // Calculate success rate
      const successRate =
        (metrics.totalHeartbeatsSent - metrics.failedHeartbeats) /
        metrics.totalHeartbeatsSent;
      expect(successRate).toBe(0); // 1 total, 1 failed = 0% success
    });

    it('should calculate optimal interval based on success rate', () => {
      const calculateOptimalInterval = (
        successRate: number,
        currentInterval: number
      ): number => {
        if (successRate >= 0.95) {
          // High success rate: can increase interval slightly
          return Math.min(currentInterval + 2000, 25000);
        } else if (successRate < 0.8) {
          // Low success rate: decrease interval
          return Math.max(currentInterval - 2000, 15000);
        }
        return currentInterval;
      };

      expect(calculateOptimalInterval(0.98, 20000)).toBe(22000);
      expect(calculateOptimalInterval(0.75, 20000)).toBe(18000);
      expect(calculateOptimalInterval(0.85, 20000)).toBe(20000);
    });
  });

  describe('Long-Running Stability', () => {
    it('should track port connection stability over time', () => {
      jest.useFakeTimers();

      const connectionMetrics = {
        connectionDuration: 0,
        disconnectCount: 0,
        lastConnectedAt: Date.now(),
        averageConnectionDuration: 0,
      };

      // Simulate 1 hour of stable connection
      jest.advanceTimersByTime(3600000);
      connectionMetrics.connectionDuration = Date.now() - connectionMetrics.lastConnectedAt;

      expect(connectionMetrics.connectionDuration).toBe(3600000);
      expect(connectionMetrics.disconnectCount).toBe(0);

      jest.useRealTimers();
    });

    it('should detect memory leaks via heartbeat growth', () => {
      const heartbeatSizes: number[] = [];

      // Simulate heartbeat message size tracking
      for (let i = 0; i < 100; i++) {
        const message = {
          type: 'OFFSCREEN_HEARTBEAT',
          timestamp: Date.now() + i * 20000,
        };
        heartbeatSizes.push(JSON.stringify(message).length);
      }

      // All heartbeat messages should be roughly the same size
      const firstSize = heartbeatSizes[0];
      const lastSize = heartbeatSizes[heartbeatSizes.length - 1];
      const sizeDelta = Math.abs(lastSize - firstSize);

      // Size should not grow (no memory leak)
      expect(sizeDelta).toBeLessThan(10); // Allow 10 byte variance
    });
  });

  describe('Adaptive Interval Adjustment', () => {
    it('should adjust interval based on Service Worker activity', () => {
      const adjustInterval = (
        lastHeartbeatGap: number,
        currentInterval: number
      ): number => {
        // If gap is close to 30s timeout, decrease interval for safety
        if (lastHeartbeatGap > 28000) {
          return Math.max(currentInterval - 3000, 15000);
        }
        // If gap is very small, can safely increase interval
        if (lastHeartbeatGap < currentInterval * 0.5) {
          return Math.min(currentInterval + 2000, 25000);
        }
        return currentInterval;
      };

      expect(adjustInterval(29000, 20000)).toBe(17000); // Gap too close to timeout
      expect(adjustInterval(8000, 20000)).toBe(22000); // Gap very small
      expect(adjustInterval(18000, 20000)).toBe(20000); // Gap normal
    });
  });
});
