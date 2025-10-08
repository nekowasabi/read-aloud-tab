import { BrowserAdapter } from '../browser';

describe('BrowserAdapter', () => {
  describe('getBrowserType()', () => {
    let originalChrome: any;
    let originalBrowser: any;

    beforeEach(() => {
      originalChrome = (global as any).chrome;
      originalBrowser = (global as any).browser;
    });

    afterEach(() => {
      (global as any).chrome = originalChrome;
      (global as any).browser = originalBrowser;
    });

    it('should return "chrome" when Chrome API is available', () => {
      (global as any).chrome = {
        runtime: {
          getManifest: jest.fn(),
        },
      };
      (global as any).browser = undefined;

      expect(BrowserAdapter.getBrowserType()).toBe('chrome');
    });

    it('should return "firefox" when Firefox API is available', () => {
      (global as any).chrome = undefined;
      (global as any).browser = {
        runtime: {},
      };

      expect(BrowserAdapter.getBrowserType()).toBe('firefox');
    });

    it('should return "unknown" when no browser API is available', () => {
      (global as any).chrome = undefined;
      (global as any).browser = undefined;

      expect(BrowserAdapter.getBrowserType()).toBe('unknown');
    });
  });

  describe('isFeatureSupported()', () => {
    let originalChrome: any;
    let originalBrowser: any;
    let originalSpeechSynthesis: any;

    beforeEach(() => {
      originalChrome = (global as any).chrome;
      originalBrowser = (global as any).browser;
      originalSpeechSynthesis = (global as any).speechSynthesis;
    });

    afterEach(() => {
      (global as any).chrome = originalChrome;
      (global as any).browser = originalBrowser;
      (global as any).speechSynthesis = originalSpeechSynthesis;
    });

    describe('offscreen feature', () => {
      it('should return true when Chrome offscreen API is available', () => {
        (global as any).chrome = {
          offscreen: {
            createDocument: jest.fn(),
          },
        };

        expect(BrowserAdapter.isFeatureSupported('offscreen')).toBe(true);
      });

      it('should return false when Chrome offscreen API is not available', () => {
        (global as any).chrome = {
          runtime: {},
        };

        expect(BrowserAdapter.isFeatureSupported('offscreen')).toBe(false);
      });

      it('should return false for Firefox (no offscreen API)', () => {
        (global as any).chrome = undefined;
        (global as any).browser = {
          runtime: {},
        };

        expect(BrowserAdapter.isFeatureSupported('offscreen')).toBe(false);
      });
    });

    describe('speechSynthesis feature', () => {
      it('should return true when speechSynthesis is available', () => {
        (global as any).speechSynthesis = {};

        expect(BrowserAdapter.isFeatureSupported('speechSynthesis')).toBe(true);
      });

      it('should return false when speechSynthesis is not available', () => {
        (global as any).speechSynthesis = undefined;

        expect(BrowserAdapter.isFeatureSupported('speechSynthesis')).toBe(false);
      });
    });

    describe('storageSync feature', () => {
      it('should return true when Chrome storage.sync is available', () => {
        (global as any).chrome = {
          storage: {
            sync: {},
          },
        };

        expect(BrowserAdapter.isFeatureSupported('storageSync')).toBe(true);
      });

      it('should return true when Firefox storage.sync is available', () => {
        (global as any).chrome = undefined;
        (global as any).browser = {
          storage: {
            sync: {},
          },
        };

        expect(BrowserAdapter.isFeatureSupported('storageSync')).toBe(true);
      });

      it('should return false when storage.sync is not available', () => {
        (global as any).chrome = undefined;
        (global as any).browser = undefined;

        expect(BrowserAdapter.isFeatureSupported('storageSync')).toBe(false);
      });
    });

    describe('unknown feature', () => {
      it('should return false for unknown features', () => {
        expect(BrowserAdapter.isFeatureSupported('unknownFeature')).toBe(false);
      });
    });
  });

  describe('Offscreen Document API', () => {
    let originalChrome: any;

    beforeEach(() => {
      originalChrome = (global as any).chrome;
    });

    afterEach(() => {
      (global as any).chrome = originalChrome;
    });

    describe('createOffscreenDocument()', () => {
      it('should call chrome.offscreen.createDocument when offscreen API is available', async () => {
        const mockCreateDocument = jest.fn().mockResolvedValue(undefined);
        (global as any).chrome = {
          offscreen: {
            createDocument: mockCreateDocument,
          },
        };

        await BrowserAdapter.createOffscreenDocument(
          'offscreen.html',
          ['AUDIO_PLAYBACK' as any],
          'Test justification'
        );

        expect(mockCreateDocument).toHaveBeenCalledWith({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Test justification',
        });
      });

      it('should throw error when offscreen API is not available', async () => {
        (global as any).chrome = undefined;

        await expect(
          BrowserAdapter.createOffscreenDocument(
            'offscreen.html',
            ['AUDIO_PLAYBACK' as any],
            'Test justification'
          )
        ).rejects.toThrow('Offscreen API is not supported in this browser');
      });

      it('should throw error for Firefox', async () => {
        (global as any).chrome = undefined;
        (global as any).browser = {
          runtime: {},
        };

        await expect(
          BrowserAdapter.createOffscreenDocument(
            'offscreen.html',
            ['AUDIO_PLAYBACK' as any],
            'Test justification'
          )
        ).rejects.toThrow('Offscreen API is not supported in this browser');
      });
    });

    describe('closeOffscreenDocument()', () => {
      it('should call chrome.offscreen.closeDocument when offscreen API is available', async () => {
        const mockCloseDocument = jest.fn().mockResolvedValue(undefined);
        (global as any).chrome = {
          offscreen: {
            closeDocument: mockCloseDocument,
          },
        };

        await BrowserAdapter.closeOffscreenDocument();

        expect(mockCloseDocument).toHaveBeenCalled();
      });

      it('should not throw error when offscreen API is not available (no-op)', async () => {
        (global as any).chrome = undefined;

        await expect(BrowserAdapter.closeOffscreenDocument()).resolves.toBeUndefined();
      });

      it('should not throw error for Firefox (no-op)', async () => {
        (global as any).chrome = undefined;
        (global as any).browser = {
          runtime: {},
        };

        await expect(BrowserAdapter.closeOffscreenDocument()).resolves.toBeUndefined();
      });
    });

    describe('hasOffscreenDocument()', () => {
      it('should return true when offscreen document exists', async () => {
        const mockGetContexts = jest.fn().mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
        (global as any).chrome = {
          offscreen: {},
          runtime: {
            getContexts: mockGetContexts,
          },
        };

        const result = await BrowserAdapter.hasOffscreenDocument();

        expect(result).toBe(true);
        expect(mockGetContexts).toHaveBeenCalledWith({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
        });
      });

      it('should return false when no offscreen document exists', async () => {
        const mockGetContexts = jest.fn().mockResolvedValue([]);
        (global as any).chrome = {
          offscreen: {},
          runtime: {
            getContexts: mockGetContexts,
          },
        };

        const result = await BrowserAdapter.hasOffscreenDocument();

        expect(result).toBe(false);
      });

      it('should return false when offscreen API is not available', async () => {
        (global as any).chrome = undefined;

        const result = await BrowserAdapter.hasOffscreenDocument();

        expect(result).toBe(false);
      });

      it('should return false for Firefox', async () => {
        (global as any).chrome = undefined;
        (global as any).browser = {
          runtime: {},
        };

        const result = await BrowserAdapter.hasOffscreenDocument();

        expect(result).toBe(false);
      });

      it('should return false and log error when getContexts throws', async () => {
        const mockGetContexts = jest.fn().mockRejectedValue(new Error('API error'));
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        (global as any).chrome = {
          offscreen: {},
          runtime: {
            getContexts: mockGetContexts,
          },
        };

        const result = await BrowserAdapter.hasOffscreenDocument();

        expect(result).toBe(false);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to check offscreen document',
          expect.any(Error)
        );

        consoleErrorSpy.mockRestore();
      });
    });
  });

  describe('Instance methods', () => {
    it('should provide singleton instance', () => {
      const instance1 = BrowserAdapter.getInstance();
      const instance2 = BrowserAdapter.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should have tabs API wrapper', () => {
      const instance = BrowserAdapter.getInstance();

      expect(instance.tabs).toBeDefined();
      expect(instance.tabs.query).toBeDefined();
      expect(instance.tabs.sendMessage).toBeDefined();
    });

    it('should have storage API wrapper', () => {
      const instance = BrowserAdapter.getInstance();

      expect(instance.storage).toBeDefined();
      expect(instance.storage.sync).toBeDefined();
      expect(instance.storage.sync.get).toBeDefined();
      expect(instance.storage.sync.set).toBeDefined();
    });

    it('should have runtime API wrapper', () => {
      const instance = BrowserAdapter.getInstance();

      expect(instance.runtime).toBeDefined();
      expect(instance.runtime.sendMessage).toBeDefined();
      expect(instance.runtime.onMessage).toBeDefined();
      expect(instance.runtime.onConnect).toBeDefined();
    });

    it('should have commands API wrapper', () => {
      const instance = BrowserAdapter.getInstance();

      expect(instance.commands).toBeDefined();
      expect(instance.commands.onCommand).toBeDefined();
    });
  });

  describe('openOptionsPage()', () => {
    let originalChrome: any;
    let originalBrowser: any;

    beforeEach(() => {
      originalChrome = (global as any).chrome;
      originalBrowser = (global as any).browser;
    });

    afterEach(() => {
      (global as any).chrome = originalChrome;
      (global as any).browser = originalBrowser;
    });

    it('should call chrome.runtime.openOptionsPage for Chrome', async () => {
      const mockOpenOptionsPage = jest.fn((callback?: () => void) => {
        if (callback) callback();
      });
      (global as any).chrome = {
        runtime: {
          openOptionsPage: mockOpenOptionsPage,
          getManifest: jest.fn(),
        },
      };
      (global as any).browser = undefined;

      const instance = BrowserAdapter.getInstance();
      await instance.runtime.openOptionsPage();

      expect(mockOpenOptionsPage).toHaveBeenCalled();
    });

    it('should call browser.runtime.openOptionsPage for Firefox', async () => {
      const mockOpenOptionsPage = jest.fn().mockResolvedValue(undefined);
      (global as any).chrome = undefined;
      (global as any).browser = {
        runtime: {
          openOptionsPage: mockOpenOptionsPage,
        },
      };

      const instance = BrowserAdapter.getInstance();
      await instance.runtime.openOptionsPage();

      expect(mockOpenOptionsPage).toHaveBeenCalled();
    });

    it('should throw error when browser API is not available', async () => {
      (global as any).chrome = undefined;
      (global as any).browser = undefined;

      const instance = BrowserAdapter.getInstance();

      await expect(instance.runtime.openOptionsPage()).rejects.toThrow(
        'Browser API not available'
      );
    });
  });
});
