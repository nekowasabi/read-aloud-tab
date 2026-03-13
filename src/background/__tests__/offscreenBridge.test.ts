/**
 * offscreenBridge.test.ts
 * Process 50 Red: offscreenBridge 抽出前の契約テスト
 *
 * These tests define the interface contract for OffscreenBridge.
 * They will be expanded once offscreenBridge.ts is extracted from service.ts.
 */
import { OffscreenBridge } from '../offscreenBridge';
import { BrowserAdapter } from '../../shared/utils/browser';

jest.mock('../../shared/utils/browser', () => ({
  BrowserAdapter: {
    getBrowserType: jest.fn(() => 'chrome'),
    isFeatureSupported: jest.fn(() => true),
    hasOffscreenDocument: jest.fn(),
    createOffscreenDocument: jest.fn(),
  },
}));

const mockBrowserAdapter = BrowserAdapter as jest.Mocked<typeof BrowserAdapter>;

describe('OffscreenBridge', () => {
  let bridge: OffscreenBridge;
  let mockRuntime: {
    sendMessage: jest.Mock;
  };
  let mockLogger: {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRuntime = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(true);
    mockBrowserAdapter.createOffscreenDocument.mockResolvedValue(undefined);

    bridge = new OffscreenBridge({
      runtime: mockRuntime,
      logger: mockLogger,
    });
  });

  describe('setup', () => {
    it('should skip setup when browser is not chrome', async () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('firefox');
      await bridge.setup();
      expect(mockBrowserAdapter.createOffscreenDocument).not.toHaveBeenCalled();
    });

    it('should skip setup when offscreen is not supported', async () => {
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(false);
      await bridge.setup();
      expect(mockBrowserAdapter.createOffscreenDocument).not.toHaveBeenCalled();
    });

    it('should skip creation if offscreen document already exists', async () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(true);
      mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(true);

      await bridge.setup();
      expect(mockBrowserAdapter.createOffscreenDocument).not.toHaveBeenCalled();
    });

    it('should create offscreen document if it does not exist', async () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(true);
      mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(false);

      await bridge.setup();
      expect(mockBrowserAdapter.createOffscreenDocument).toHaveBeenCalledWith(
        'offscreen.html',
        expect.any(Array),
        expect.any(String),
      );
    });

    it('should not throw if creation fails', async () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(true);
      mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(false);
      mockBrowserAdapter.createOffscreenDocument.mockRejectedValue(new Error('creation failed'));

      await expect(bridge.setup()).resolves.not.toThrow();
    });
  });

  describe('ensure', () => {
    it('should return false when browser is not chrome', async () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('firefox');
      const result = await bridge.ensure();
      expect(result).toBe(false);
    });

    it('should return true if offscreen document already exists', async () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(true);
      mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(true);

      const result = await bridge.ensure();
      expect(result).toBe(true);
    });

    it('should recreate and return true if document was missing', async () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(true);
      mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(false);
      mockBrowserAdapter.createOffscreenDocument.mockResolvedValue(undefined);

      const result = await bridge.ensure();
      expect(result).toBe(true);
      expect(mockBrowserAdapter.createOffscreenDocument).toHaveBeenCalled();
    });

    it('should return false if recreation fails', async () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(true);
      mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(false);
      mockBrowserAdapter.createOffscreenDocument.mockRejectedValue(new Error('failed'));

      const result = await bridge.ensure();
      expect(result).toBe(false);
    });
  });

  describe('sendCommand', () => {
    beforeEach(() => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(true);
      mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(true);
    });

    it('should send start command to offscreen', async () => {
      const tab = { tabId: 1, url: 'https://example.com', title: 'Test', content: 'content', isIgnored: false, extractedAt: new Date() };
      const settings = { rate: 1, pitch: 1, volume: 1, voice: null };

      await bridge.sendCommand('start', { tab, settings });

      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OFFSCREEN_TTS_START' }),
      );
    });

    it('should send pause command to offscreen', async () => {
      await bridge.sendCommand('pause');
      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OFFSCREEN_TTS_PAUSE' }),
      );
    });

    it('should send resume command to offscreen', async () => {
      await bridge.sendCommand('resume');
      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OFFSCREEN_TTS_RESUME' }),
      );
    });

    it('should send stop command to offscreen', async () => {
      await bridge.sendCommand('stop');
      expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OFFSCREEN_TTS_STOP' }),
      );
    });

    it('should throw if offscreen document is unavailable', async () => {
      mockBrowserAdapter.hasOffscreenDocument.mockResolvedValue(false);
      mockBrowserAdapter.createOffscreenDocument.mockRejectedValue(new Error('failed'));

      await expect(bridge.sendCommand('pause')).rejects.toThrow();
    });

    it('should retry once on send failure', async () => {
      mockBrowserAdapter.hasOffscreenDocument
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      mockRuntime.sendMessage
        .mockRejectedValueOnce(new Error('first attempt failed'))
        .mockResolvedValueOnce(undefined);

      await bridge.sendCommand('pause');
      expect(mockRuntime.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('isAvailable', () => {
    it('should return false for firefox', () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('firefox');
      expect(bridge.isAvailable()).toBe(false);
    });

    it('should return false when offscreen not supported', () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(false);
      expect(bridge.isAvailable()).toBe(false);
    });

    it('should return true for chrome with offscreen support', () => {
      mockBrowserAdapter.getBrowserType.mockReturnValue('chrome');
      mockBrowserAdapter.isFeatureSupported.mockReturnValue(true);
      expect(bridge.isAvailable()).toBe(true);
    });
  });
});
