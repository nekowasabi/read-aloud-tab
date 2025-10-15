/**
 * @jest-environment jsdom
 */
import { TabInfo, TTSSettings } from '../../../shared/types';
import { OffscreenCommandMessage, OffscreenBroadcastMessage } from '../../../shared/messages';

describe('Offscreen Document', () => {
  let mockSpeechSynthesis: any;
  let mockUtterance: any;
  let sentMessages: OffscreenBroadcastMessage[];

  beforeEach(() => {
    // Mock chrome.runtime.sendMessage
    sentMessages = [];
    global.chrome = {
      runtime: {
        sendMessage: jest.fn((message: OffscreenBroadcastMessage) => {
          sentMessages.push(message);
          return Promise.resolve();
        }),
        onMessage: {
          addListener: jest.fn(),
        },
      },
    } as any;

    // Mock SpeechSynthesis API
    mockUtterance = {
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

    mockSpeechSynthesis = {
      speaking: false,
      pending: false,
      paused: false,
      speak: jest.fn((utterance: any) => {
        mockSpeechSynthesis.speaking = true;
        setTimeout(() => {
          if (utterance.onstart) utterance.onstart({} as any);
        }, 0);
      }),
      cancel: jest.fn(() => {
        mockSpeechSynthesis.speaking = false;
        mockSpeechSynthesis.paused = false;
      }),
      pause: jest.fn(() => {
        mockSpeechSynthesis.paused = true;
      }),
      resume: jest.fn(() => {
        mockSpeechSynthesis.paused = false;
      }),
      getVoices: jest.fn(() => []),
    };

    global.speechSynthesis = mockSpeechSynthesis;
    global.SpeechSynthesisUtterance = jest.fn(() => mockUtterance) as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Message Handling', () => {
    it('should handle OFFSCREEN_TTS_START command', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      const controller = initializeOffscreenDocument();
      expect(controller).toBeDefined();

      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: {
            tabId: 1,
            url: 'https://example.com',
            title: 'Test',
            content: 'Hello World',
          } as TabInfo,
          settings: {
            rate: 1,
            pitch: 1,
            volume: 1,
            voice: null,
          } as TTSSettings,
        },
      };

      // Simulate message from service worker
      const addListenerMock = chrome.runtime.onMessage.addListener as jest.Mock;
      expect(addListenerMock).toHaveBeenCalled();

      const listener = addListenerMock.mock.calls[0][0];
      expect(listener).toBeDefined();

      const sendResponse = jest.fn();
      await listener(message, {}, sendResponse);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSpeechSynthesis.speak).toHaveBeenCalled();
      expect(sentMessages.length).toBeGreaterThan(0);
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_STATUS',
          payload: { status: 'speaking' },
        })
      );
    });

    it('should handle OFFSCREEN_TTS_PAUSE command', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      // Start speaking first
      mockSpeechSynthesis.speaking = true;

      const message: OffscreenCommandMessage = { type: 'OFFSCREEN_TTS_PAUSE' };
      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      await listener(message, {}, jest.fn());

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_STATUS',
          payload: { status: 'paused' },
        })
      );
    });

    it('should handle OFFSCREEN_TTS_RESUME command', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const message: OffscreenCommandMessage = { type: 'OFFSCREEN_TTS_RESUME' };
      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      await listener(message, {}, jest.fn());

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Resume should trigger speaking status
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_STATUS',
          payload: { status: 'speaking' },
        })
      );
    });

    it('should handle OFFSCREEN_TTS_STOP command', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      mockSpeechSynthesis.speaking = true;

      const message: OffscreenCommandMessage = { type: 'OFFSCREEN_TTS_STOP' };
      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      await listener(message, {}, jest.fn());

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSpeechSynthesis.cancel).toHaveBeenCalled();
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_STATUS',
          payload: { status: 'idle' },
        })
      );
    });

    it('should handle OFFSCREEN_TTS_UPDATE_SETTINGS command', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_UPDATE_SETTINGS',
        payload: {
          settings: {
            rate: 1.5,
            pitch: 1.2,
            volume: 0.8,
          } as TTSSettings,
        },
      };

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      const sendResponse = jest.fn();
      await listener(message, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should complete without error
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('Progress Reporting', () => {
    it('should send progress updates during speech', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: {
            tabId: 1,
            url: 'https://example.com',
            title: 'Test',
            content: 'Hello World',
          } as TabInfo,
          settings: {
            rate: 1,
            pitch: 1,
            volume: 1,
            voice: null,
          } as TTSSettings,
        },
      };

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      await listener(message, {}, jest.fn());

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate boundary event
      if (mockUtterance.onboundary) {
        mockUtterance.onboundary({ charIndex: 5 } as any);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_PROGRESS',
        })
      );
    });

    it('should send end notification when speech completes', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: {
            tabId: 1,
            url: 'https://example.com',
            title: 'Test',
            content: 'Hello World',
          } as TabInfo,
          settings: {
            rate: 1,
            pitch: 1,
            volume: 1,
            voice: null,
          } as TTSSettings,
        },
      };

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      await listener(message, {}, jest.fn());

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate end event
      if (mockUtterance.onend) {
        mockUtterance.onend({} as any);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_END',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should send error notification on speech error', async () => {
      // Configure mock to trigger error on each speak call
      let errorCallCount = 0;
      const maxErrorCalls = 3; // Initial + 2 retries

      mockSpeechSynthesis.speak.mockImplementation((utterance: any) => {
        mockSpeechSynthesis.speaking = true;
        setTimeout(() => {
          if (utterance.onstart) utterance.onstart({} as any);
          // Trigger error for first 3 calls (initial + 2 retries)
          if (errorCallCount < maxErrorCalls && utterance.onerror) {
            errorCallCount++;
            utterance.onerror({ error: 'synthesis-failed' } as any);
          }
        }, 0);
      });

      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: {
            tabId: 1,
            url: 'https://example.com',
            title: 'Test',
            content: 'Hello World',
          } as TabInfo,
          settings: {
            rate: 1,
            pitch: 1,
            volume: 1,
            voice: null,
          } as TTSSettings,
        },
      };

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      await listener(message, {}, jest.fn());

      // Wait for all retries to complete (3 attempts * 100ms delay + buffer)
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_ERROR',
        })
      );
    });

    it('should handle invalid message format gracefully', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const invalidMessage = {
        type: 'INVALID_MESSAGE_TYPE',
        payload: {},
      };

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      const sendResponse = jest.fn();

      await listener(invalidMessage, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should complete without throwing error
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should handle message with missing payload', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const invalidMessage = {
        type: 'OFFSCREEN_TTS_START',
        // Missing payload
      };

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      const sendResponse = jest.fn();

      await listener(invalidMessage, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should handle gracefully (sendResponse might be called with error or success)
      expect(sendResponse).toHaveBeenCalled();
    });

    it('should handle TTS engine failure during start', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      // Mock speak to throw error
      mockSpeechSynthesis.speak.mockImplementation(() => {
        throw new Error('TTS engine failed');
      });

      initializeOffscreenDocument();
      sentMessages = [];

      const message: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: {
            tabId: 1,
            url: 'https://example.com',
            title: 'Test',
            content: 'Hello World',
          } as TabInfo,
          settings: {
            rate: 1,
            pitch: 1,
            volume: 1,
            voice: null,
          } as TTSSettings,
        },
      };

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];
      const sendResponse = jest.fn();

      await listener(message, {}, sendResponse);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should send error and call sendResponse with error
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_ERROR',
        })
      );
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        })
      );
    });
  });

  describe('Sequential Commands', () => {
    it('should handle multiple START commands sequentially', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];

      const message1: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: {
            tabId: 1,
            url: 'https://example.com',
            title: 'Test 1',
            content: 'Hello World',
          } as TabInfo,
          settings: {
            rate: 1,
            pitch: 1,
            volume: 1,
            voice: null,
          } as TTSSettings,
        },
      };

      const message2: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: {
            tabId: 2,
            url: 'https://example.com/2',
            title: 'Test 2',
            content: 'Second content',
          } as TabInfo,
          settings: {
            rate: 1,
            pitch: 1,
            volume: 1,
            voice: null,
          } as TTSSettings,
        },
      };

      await listener(message1, {}, jest.fn());
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second start should override first
      await listener(message2, {}, jest.fn());
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have multiple speaking status updates
      const speakingStatusCount = sentMessages.filter(
        (msg) => msg.type === 'OFFSCREEN_TTS_STATUS' && msg.payload.status === 'speaking'
      ).length;

      expect(speakingStatusCount).toBeGreaterThanOrEqual(2);
    });

    it('should handle STOP followed by START', async () => {
      const { initializeOffscreenDocument } = await import('../offscreen');

      initializeOffscreenDocument();
      sentMessages = [];

      const listener = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls[0][0];

      // Start
      const startMessage: OffscreenCommandMessage = {
        type: 'OFFSCREEN_TTS_START',
        payload: {
          tab: {
            tabId: 1,
            url: 'https://example.com',
            title: 'Test',
            content: 'Hello World',
          } as TabInfo,
          settings: {
            rate: 1,
            pitch: 1,
            volume: 1,
            voice: null,
          } as TTSSettings,
        },
      };

      await listener(startMessage, {}, jest.fn());
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Stop
      const stopMessage: OffscreenCommandMessage = { type: 'OFFSCREEN_TTS_STOP' };
      await listener(stopMessage, {}, jest.fn());
      await new Promise((resolve) => setTimeout(resolve, 50));

      sentMessages = []; // Clear for next assertion

      // Start again
      await listener(startMessage, {}, jest.fn());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_STATUS',
          payload: { status: 'speaking' },
        })
      );
    });
  });
});
