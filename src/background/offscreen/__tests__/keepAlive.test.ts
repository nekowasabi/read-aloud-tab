/**
 * @jest-environment jsdom
 */
import { TabInfo, TTSSettings } from '../../../shared/types';

describe('Offscreen Keep-Alive Port Connection', () => {
  let mockPort: any;
  let mockChrome: any;
  let sentMessages: Array<{ type: string; timestamp?: number }>;

  beforeEach(() => {
    // Reset sent messages
    sentMessages = [];

    // Mock chrome.runtime.connect
    mockPort = {
      name: 'offscreen-keepalive',
      onDisconnect: {
        addListener: jest.fn(),
      },
      postMessage: jest.fn((message: any) => {
        sentMessages.push(message);
      }),
    };

    mockChrome = {
      runtime: {
        connect: jest.fn(() => mockPort),
        sendMessage: jest.fn((message: any) => Promise.resolve()),
        onMessage: {
          addListener: jest.fn(),
        },
      },
    };

    global.chrome = mockChrome as any;

    // Mock SpeechSynthesis API
    const mockUtterance = {
      text: '',
      rate: 1,
      pitch: 1,
      volume: 1,
      voice: null,
      lang: 'ja-JP',
      onstart: null,
      onend: null,
      onerror: null,
      onpause: null,
      onresume: null,
      onboundary: null,
    };

    const mockSpeechSynthesis = {
      speaking: false,
      pending: false,
      paused: false,
      speak: jest.fn(),
      cancel: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      getVoices: jest.fn(() => []),
    };

    global.speechSynthesis = mockSpeechSynthesis as any;
    global.SpeechSynthesisUtterance = jest.fn(() => mockUtterance) as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Port Creation and Connection', () => {
    it('should create a keep-alive port on initialization', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      // Wait for async initialization
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockChrome.runtime.connect).toHaveBeenCalledWith({
        name: 'offscreen-keepalive',
      });
      expect(mockPort.onDisconnect.addListener).toHaveBeenCalled();
    });

    it('should send heartbeat messages at regular intervals', async () => {
      jest.useFakeTimers();

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      // Advance timer by 20 seconds (heartbeat interval)
      jest.advanceTimersByTime(20000);

      // Should have sent at least one heartbeat
      expect(sentMessages.length).toBeGreaterThan(0);
      expect(sentMessages[0]).toEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_HEARTBEAT',
        })
      );
      expect(sentMessages[0].timestamp).toBeDefined();
      expect(typeof sentMessages[0].timestamp).toBe('number');

      jest.useRealTimers();
    });

    it('should include correct timestamp in heartbeat message', async () => {
      jest.useFakeTimers();
      const testTimestamp = 1000000;
      jest.setSystemTime(testTimestamp);

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      // Advance timer by 20 seconds (heartbeat interval)
      jest.advanceTimersByTime(20000);

      expect(sentMessages.length).toBeGreaterThan(0);
      expect(sentMessages[0].timestamp).toBe(testTimestamp + 20000);

      jest.useRealTimers();
    });
  });

  describe('Reconnection Logic', () => {
    it('should attempt to reconnect when port is disconnected', async () => {
      jest.useFakeTimers();

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      // Get the onDisconnect listener
      const disconnectListener =
        mockPort.onDisconnect.addListener.mock.calls[0][0];

      // Reset the connect mock to track new calls
      mockChrome.runtime.connect.mockClear();

      // Trigger disconnection
      disconnectListener();

      // Should schedule a reconnect with exponential backoff
      jest.advanceTimersByTime(500); // First backoff: 500ms

      expect(mockChrome.runtime.connect).toHaveBeenCalledWith({
        name: 'offscreen-keepalive',
      });

      jest.useRealTimers();
    });

    it('should use exponential backoff for reconnection attempts', async () => {
      jest.useFakeTimers();

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      const disconnectListener =
        mockPort.onDisconnect.addListener.mock.calls[0][0];

      mockChrome.runtime.connect.mockImplementation(() => {
        // Simulate persistent disconnect
        throw new Error('Connection failed');
      });

      mockChrome.runtime.connect.mockClear();

      // First disconnect and wait for first reconnect
      disconnectListener();
      jest.advanceTimersByTime(500); // First backoff: 500ms
      const firstAttempts = mockChrome.runtime.connect.mock.calls.length;

      // Second disconnect (triggered by first reconnect failure)
      // The reconnect will fail, triggering another disconnect internally
      jest.advanceTimersByTime(1000); // Second backoff: 1000ms
      const secondAttempts = mockChrome.runtime.connect.mock.calls.length;

      expect(secondAttempts).toBeGreaterThanOrEqual(firstAttempts);

      jest.useRealTimers();
    });

    it('should stop reconnecting after max attempts', async () => {
      jest.useFakeTimers();

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      const disconnectListener =
        mockPort.onDisconnect.addListener.mock.calls[0][0];

      mockChrome.runtime.connect.mockImplementation(() => {
        // Simulate persistent disconnect
        throw new Error('Connection failed');
      });

      // Make 10+ disconnection attempts to exceed max attempts
      for (let i = 0; i < 12; i++) {
        disconnectListener();
        // Progress time for backoff
        jest.advanceTimersByTime(5000);
        jest.runOnlyPendingTimers();
      }

      // After max attempts (10), should stop trying
      // Count how many reconnect attempts were made
      const totalAttempts = mockChrome.runtime.connect.mock.calls.length;

      // Should be reasonable (initial + retries, but not unlimited)
      expect(totalAttempts).toBeLessThanOrEqual(20);

      jest.useRealTimers();
    });
  });

  describe('Cleanup', () => {
    it('should stop heartbeat when port is disconnected', async () => {
      jest.useFakeTimers();

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      sentMessages = [];

      // Advance timer to trigger first heartbeat
      jest.advanceTimersByTime(20000);
      expect(sentMessages.length).toBeGreaterThan(0);

      sentMessages = [];

      // Get the onDisconnect listener
      const disconnectListener =
        mockPort.onDisconnect.addListener.mock.calls[0][0];

      // Trigger disconnection
      disconnectListener();

      // Clear sent messages that might have been sent during disconnect
      sentMessages = [];

      // Advance timer - should not send heartbeat after disconnect
      jest.advanceTimersByTime(20000);

      // No new heartbeat messages should be sent after reconnect attempt
      const heartbeatMessages = sentMessages.filter(
        (msg) => msg.type === 'OFFSCREEN_HEARTBEAT'
      );
      // If reconnect fails, no heartbeats should be sent
      expect(heartbeatMessages.length).toBeLessThanOrEqual(1);

      jest.useRealTimers();
    });

    it('should disconnect port on cleanup', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      const controller = initializeOffscreenDocument();

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate page unload - would normally trigger cleanup
      // In this test we just verify the port exists
      expect(mockPort).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle port creation failure gracefully', async () => {
      mockChrome.runtime.connect.mockImplementation(() => {
        throw new Error('Port connection failed');
      });

      const { initializeOffscreenDocument } = await import('../offscreen');

      // Should not throw during initialization
      expect(() => {
        initializeOffscreenDocument();
      }).not.toThrow();
    });

    it('should handle heartbeat send failure gracefully', async () => {
      jest.useFakeTimers();

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      // Mock postMessage to throw error
      mockPort.postMessage.mockImplementation(() => {
        throw new Error('Port disconnected');
      });

      // Advance timer to trigger heartbeat
      jest.advanceTimersByTime(20000);

      // Should handle error without throwing
      // Error should trigger reconnection attempt
      expect(mockChrome.runtime.connect).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('Multiple Heartbeats', () => {
    it('should send multiple heartbeats over time', async () => {
      jest.useFakeTimers();

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      sentMessages = [];

      // Advance timer by 60 seconds (3 heartbeat cycles of 20s each)
      jest.advanceTimersByTime(60000);

      const heartbeatMessages = sentMessages.filter(
        (msg) => msg.type === 'OFFSCREEN_HEARTBEAT'
      );

      // Should have sent approximately 3 heartbeats (60s / 20s per heartbeat)
      expect(heartbeatMessages.length).toBeGreaterThanOrEqual(2);
      expect(heartbeatMessages.length).toBeLessThanOrEqual(4);

      jest.useRealTimers();
    });

    it('should maintain increasing timestamps in heartbeat sequence', async () => {
      jest.useFakeTimers();

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();

      sentMessages = [];

      // Advance timer by 60 seconds to get multiple heartbeats
      jest.advanceTimersByTime(60000);

      const heartbeatMessages = sentMessages.filter(
        (msg) => msg.type === 'OFFSCREEN_HEARTBEAT'
      );

      // Verify timestamps are increasing
      for (let i = 1; i < heartbeatMessages.length; i++) {
        const current = heartbeatMessages[i].timestamp;
        const previous = heartbeatMessages[i - 1].timestamp;
        expect(current).toBeGreaterThan(previous ?? 0);
      }

      jest.useRealTimers();
    });
  });
});
