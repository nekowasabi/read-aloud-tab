/**
 * Offscreen Document Integration Tests for BackgroundOrchestrator
 */
import { BackgroundOrchestrator } from '../service';
import { TabManager } from '../tabManager';
import { BrowserAdapter } from '../../shared/utils/browser';

jest.mock('../../shared/utils/storage', () => ({
  StorageManager: {
    getDeveloperMode: jest.fn().mockResolvedValue(false),
  },
}));

describe('BackgroundOrchestrator Offscreen Integration', () => {
  let mockChrome: any;
  let mockOffscreen: any;
  let mockRuntime: any;
  let tabManager: TabManager;

  beforeEach(() => {
    // Mock chrome.offscreen API
    mockOffscreen = {
      createDocument: jest.fn().mockResolvedValue(undefined),
      closeDocument: jest.fn().mockResolvedValue(undefined),
    };

    mockRuntime = {
      getContexts: jest.fn().mockResolvedValue([]),
      onMessage: { addListener: jest.fn() },
      onConnect: { addListener: jest.fn() },
      sendMessage: jest.fn(),
    };

    mockChrome = {
      offscreen: mockOffscreen,
      runtime: mockRuntime,
      commands: { onCommand: { addListener: jest.fn() } },
      tabs: { sendMessage: jest.fn() },
    };

    global.chrome = mockChrome as any;

    // Mock BrowserAdapter
    jest.spyOn(BrowserAdapter, 'getBrowserType').mockReturnValue('chrome');
    jest.spyOn(BrowserAdapter, 'isFeatureSupported').mockImplementation((feature: string) => {
      return feature === 'offscreen';
    });

    // Mock TabManager
    tabManager = {
      initialize: jest.fn().mockResolvedValue(undefined),
      addStatusListener: jest.fn().mockReturnValue(() => {}),
      addProgressListener: jest.fn().mockReturnValue(() => {}),
      addErrorListener: jest.fn().mockReturnValue(() => {}),
      addCommandListener: jest.fn().mockReturnValue(() => {}),
      resumePlaybackIfNeeded: jest.fn().mockResolvedValue(undefined),
    } as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Offscreen Document Lifecycle', () => {
    it('should create offscreen document on initialization for Chrome', async () => {
      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      expect(mockRuntime.getContexts).toHaveBeenCalledWith({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
      });
      expect(mockOffscreen.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Text-to-speech audio playback',
        })
      );
    });

    it('should not create offscreen document if already exists', async () => {
      mockRuntime.getContexts.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);

      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      expect(mockOffscreen.createDocument).not.toHaveBeenCalled();
    });

    it('should not create offscreen document for Firefox', async () => {
      jest.spyOn(BrowserAdapter, 'getBrowserType').mockReturnValue('firefox');
      jest.spyOn(BrowserAdapter, 'isFeatureSupported').mockReturnValue(false);

      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      expect(mockOffscreen.createDocument).not.toHaveBeenCalled();
    });
  });

  describe('TTS Command Forwarding to Offscreen', () => {
    it('should forward START command to offscreen document', async () => {
      // Mock tabManager.getSnapshot to return a tab
      const mockTab = {
        tabId: 1,
        url: 'https://example.com',
        title: 'Test',
        content: 'Hello World',
        isIgnored: false,
      };
      const mockSnapshot = {
        tabs: [mockTab],
        currentIndex: 0,
        status: 'idle',
        settings: { rate: 1, pitch: 1, volume: 1 },
      };
      tabManager.getSnapshot = jest.fn().mockReturnValue(mockSnapshot);

      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      // Simulate QUEUE_CONTROL message with start action
      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const message = {
        type: 'QUEUE_CONTROL',
        payload: { action: 'start' },
      };

      await messageHandler(message, {}, jest.fn());

      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_START',
        })
      );
    });

    it('should forward PAUSE command to offscreen document', async () => {
      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const message = {
        type: 'QUEUE_CONTROL',
        payload: { action: 'pause' },
      };

      await messageHandler(message, {}, jest.fn());

      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_PAUSE',
        })
      );
    });

    it('should forward RESUME command to offscreen document', async () => {
      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const message = {
        type: 'QUEUE_CONTROL',
        payload: { action: 'resume' },
      };

      await messageHandler(message, {}, jest.fn());

      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_RESUME',
        })
      );
    });

    it('should forward STOP command to offscreen document', async () => {
      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const message = {
        type: 'QUEUE_CONTROL',
        payload: { action: 'stop' },
      };

      await messageHandler(message, {}, jest.fn());

      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_STOP',
        })
      );
    });
  });

  describe('Offscreen Status Updates', () => {
    it('should handle status updates from offscreen document', async () => {
      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const statusMessage = {
        type: 'OFFSCREEN_TTS_STATUS',
        payload: { status: 'speaking' },
      };

      await messageHandler(statusMessage, {}, jest.fn());

      // Should not throw error and handle gracefully
      expect(true).toBe(true);
    });

    it('should handle progress updates from offscreen document', async () => {
      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const progressMessage = {
        type: 'OFFSCREEN_TTS_PROGRESS',
        payload: { progress: 0.5, timestamp: Date.now() },
      };

      await messageHandler(progressMessage, {}, jest.fn());

      expect(true).toBe(true);
    });

    it('should handle error updates from offscreen document', async () => {
      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const errorMessage = {
        type: 'OFFSCREEN_TTS_ERROR',
        payload: { code: 'TTS_ERROR', message: 'Test error' },
      };

      await messageHandler(errorMessage, {}, jest.fn());

      expect(true).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle offscreen document creation failure', async () => {
      mockOffscreen.createDocument.mockRejectedValue(new Error('Failed to create offscreen document'));

      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      // Should not throw during initialization even if offscreen creation fails
      await expect(orchestrator.initialize()).resolves.not.toThrow();
    });

    it('should handle missing offscreen API gracefully', async () => {
      // Remove offscreen API
      const chromeWithoutOffscreen = {
        ...mockChrome,
        offscreen: undefined,
      };

      jest.spyOn(BrowserAdapter, 'isFeatureSupported').mockReturnValue(false);

      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: chromeWithoutOffscreen,
      });

      await orchestrator.initialize();

      // Should initialize without trying to create offscreen document
      expect(mockOffscreen.createDocument).not.toHaveBeenCalled();
    });

    it('should handle sendMessage failure to offscreen document', async () => {
      mockRuntime.sendMessage.mockRejectedValue(new Error('Message send failed'));

      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const message = {
        type: 'QUEUE_CONTROL',
        payload: { action: 'pause' },
      };

      const sendResponse = jest.fn();

      // Should not throw even if message send fails
      let error: Error | null = null;
      try {
        messageHandler(message, {}, sendResponse);
        // Wait a bit for async handling
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeNull();
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('Sequential TTS Operations', () => {
    it('should handle rapid START/STOP commands', async () => {
      const mockSnapshot = {
        tabs: [{
          tabId: 1,
          url: 'https://example.com',
          title: 'Test',
          content: 'Hello World',
          isIgnored: false,
        }],
        currentIndex: 0,
        status: 'idle',
        settings: { rate: 1, pitch: 1, volume: 1 },
      };
      tabManager.getSnapshot = jest.fn().mockReturnValue(mockSnapshot);

      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];

      // Rapid sequence of commands
      await messageHandler({ type: 'QUEUE_CONTROL', payload: { action: 'start' } }, {}, jest.fn());
      await messageHandler({ type: 'QUEUE_CONTROL', payload: { action: 'stop' } }, {}, jest.fn());
      await messageHandler({ type: 'QUEUE_CONTROL', payload: { action: 'start' } }, {}, jest.fn());

      // Should have sent multiple messages to offscreen
      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OFFSCREEN_TTS_START' })
      );
      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OFFSCREEN_TTS_STOP' })
      );
    });

    it('should forward settings updates to offscreen document', async () => {
      // Ensure BrowserAdapter returns correct values for this test
      jest.spyOn(BrowserAdapter, 'getBrowserType').mockReturnValue('chrome');
      jest.spyOn(BrowserAdapter, 'isFeatureSupported').mockReturnValue(true);

      // Clear any previous calls
      mockRuntime.sendMessage.mockClear();
      mockRuntime.sendMessage.mockResolvedValue(undefined);

      // Add updateSettings to tabManager mock
      tabManager.updateSettings = jest.fn().mockResolvedValue(undefined);

      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      // Clear calls from initialization
      mockRuntime.sendMessage.mockClear();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const settingsMessage = {
        type: 'QUEUE_UPDATE_SETTINGS',
        payload: {
          settings: {
            rate: 1.5,
            pitch: 1.2,
            volume: 0.8,
          },
        },
      };

      const sendResponse = jest.fn();
      messageHandler(settingsMessage, {}, sendResponse);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'OFFSCREEN_TTS_UPDATE_SETTINGS',
        })
      );
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('Offscreen End Event', () => {
    it('should handle OFFSCREEN_TTS_END message', async () => {
      const orchestrator = new BackgroundOrchestrator({
        tabManager,
        chrome: mockChrome,
      });

      await orchestrator.initialize();

      const messageHandler = mockRuntime.onMessage.addListener.mock.calls[0][0];
      const endMessage = {
        type: 'OFFSCREEN_TTS_END',
      };

      await messageHandler(endMessage, {}, jest.fn());

      // Should handle gracefully without errors
      expect(true).toBe(true);
    });
  });
});
