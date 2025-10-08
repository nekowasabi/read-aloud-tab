/**
 * @file Storage utilities test suite
 * TDD RED Phase: These tests will fail until storage methods are implemented
 */

import { ReadingQueue, TabInfo, AiSettings } from '../../types';

// Mock BrowserAdapter first
const mockBrowserStorage = {
  sync: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
};

jest.mock('../browser', () => ({
  BrowserAdapter: {
    getInstance: jest.fn(() => ({
      storage: mockBrowserStorage,
    })),
  },
}));

import {
  saveQueue,
  loadQueue,
  clearQueue,
  addIgnoredDomain,
  removeIgnoredDomain,
  getIgnoredDomains,
  migrateStorageSchema,
  StorageManager,
} from '../storage';
import { BrowserAdapter } from '../browser';

// Mock chrome.storage for local storage (not using BrowserAdapter yet)
const mockLocalStorage = {
  get: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
  clear: jest.fn(),
};

// @ts-ignore
global.chrome = {
  // @ts-ignore
  storage: {
    // @ts-ignore
    local: mockLocalStorage,
  },
};

// Helper to get mocked BrowserAdapter storage
const getMockBrowserStorage = () => mockBrowserStorage;

describe('Storage Utilities - Queue Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveQueue', () => {
    it('should save queue to storage', async () => {
      const mockQueue: ReadingQueue = {
        tabs: [
          {
            tabId: 1,
            url: 'https://example.com',
            title: 'Example',
            isIgnored: false,
            extractedAt: new Date(),
          },
        ],
        currentIndex: 0,
        status: 'idle',
        settings: {
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          voice: null,
        },
      };

      mockLocalStorage.set.mockResolvedValue(undefined);

      await saveQueue(mockQueue);

      expect(mockLocalStorage.set).toHaveBeenCalledWith({
        readingQueue: mockQueue,
        schemaVersion: 2,
      });
    });

    it('should handle storage errors gracefully', async () => {
      const mockQueue: ReadingQueue = {
        tabs: [],
        currentIndex: 0,
        status: 'idle',
        settings: {
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          voice: null,
        },
      };

      mockLocalStorage.set.mockRejectedValue(new Error('Storage error'));

      await expect(saveQueue(mockQueue)).rejects.toThrow('Storage error');
    });
  });

  describe('loadQueue', () => {
    it('should load queue from storage', async () => {
      const mockStoredQueue: ReadingQueue = {
        tabs: [
          {
            tabId: 2,
            url: 'https://stored.com',
            title: 'Stored Page',
            isIgnored: false,
            extractedAt: new Date(),
          },
        ],
        currentIndex: 0,
        status: 'reading',
        settings: {
          rate: 1.2,
          pitch: 1.0,
          volume: 0.8,
          voice: null,
        },
      };

      mockLocalStorage.get.mockResolvedValue({
        readingQueue: mockStoredQueue,
        schemaVersion: 2,
      });

      const result = await loadQueue();

      expect(mockLocalStorage.get).toHaveBeenCalledWith([
        'readingQueue',
        'schemaVersion',
      ]);
      expect(result).toEqual(mockStoredQueue);
    });

    it('should return default queue when no data exists', async () => {
      mockLocalStorage.get.mockResolvedValue({});

      const result = await loadQueue();

      const expectedDefault: ReadingQueue = {
        tabs: [],
        currentIndex: 0,
        status: 'idle',
        settings: {
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          voice: null,
        },
      };

      expect(result).toEqual(expectedDefault);
    });

    it('should trigger migration for v1 data', async () => {
      // Mock v1 data structure
      const v1Data = {
        currentTab: {
          tabId: 1,
          title: 'Old Format',
          url: 'https://old.com',
        },
        settings: {
          rate: 1.5,
          pitch: 1.2,
          volume: 0.9,
          voice: null,
        },
        schemaVersion: 1,
      };

      mockLocalStorage.get.mockResolvedValue(v1Data);
      mockLocalStorage.set.mockResolvedValue(undefined);

      const result = await loadQueue();

      // Should return migrated data
      expect(result.tabs).toHaveLength(1);
      expect(result.tabs[0].tabId).toBe(1);
      expect(result.settings.rate).toBe(1.5);
    });
  });

  describe('clearQueue', () => {
    it('should clear queue from storage', async () => {
      mockLocalStorage.remove.mockResolvedValue(undefined);

      await clearQueue();

      expect(mockLocalStorage.remove).toHaveBeenCalledWith(['readingQueue']);
    });
  });
});

describe('Storage Utilities - Ignored Domains', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getIgnoredDomains', () => {
    it('should return list of ignored domains', async () => {
      const mockStorage = getMockBrowserStorage();
      mockStorage.sync.get.mockResolvedValue({
        ignoredDomains: ['example.com', 'test.org'],
      });

      const domains = await getIgnoredDomains();

      expect(mockStorage.sync.get).toHaveBeenCalledWith(['ignoredDomains']);
      expect(domains).toEqual(['example.com', 'test.org']);
    });

    it('should return empty array when no domains are ignored', async () => {
      const mockStorage = getMockBrowserStorage();
      mockStorage.sync.get.mockResolvedValue({});

      const domains = await getIgnoredDomains();

      expect(domains).toEqual([]);
    });
  });

  describe('addIgnoredDomain', () => {
    it('should add domain to ignored list', async () => {
      const mockStorage = getMockBrowserStorage();
      mockStorage.sync.get.mockResolvedValue({
        ignoredDomains: ['existing.com'],
      });
      mockStorage.sync.set.mockResolvedValue(undefined);

      await addIgnoredDomain('newdomain.com');

      expect(mockStorage.sync.set).toHaveBeenCalledWith({
        ignoredDomains: ['existing.com', 'newdomain.com'],
      });
    });

    it('should not add duplicate domains', async () => {
      const mockStorage = getMockBrowserStorage();
      mockStorage.sync.get.mockResolvedValue({
        ignoredDomains: ['existing.com'],
      });
      mockStorage.sync.set.mockResolvedValue(undefined);

      await addIgnoredDomain('existing.com');

      expect(mockStorage.sync.set).toHaveBeenCalledWith({
        ignoredDomains: ['existing.com'],
      });
    });

    it('should normalize domain names', async () => {
      const mockStorage = getMockBrowserStorage();
      mockStorage.sync.get.mockResolvedValue({
        ignoredDomains: [],
      });
      mockStorage.sync.set.mockResolvedValue(undefined);

      await addIgnoredDomain('EXAMPLE.COM');

      expect(mockStorage.sync.set).toHaveBeenCalledWith({
        ignoredDomains: ['example.com'],
      });
    });
  });

  describe('removeIgnoredDomain', () => {
    it('should remove domain from ignored list', async () => {
      const mockStorage = getMockBrowserStorage();
      mockStorage.sync.get.mockResolvedValue({
        ignoredDomains: ['keep.com', 'remove.com', 'also-keep.org'],
      });
      mockStorage.sync.set.mockResolvedValue(undefined);

      await removeIgnoredDomain('remove.com');

      expect(mockStorage.sync.set).toHaveBeenCalledWith({
        ignoredDomains: ['keep.com', 'also-keep.org'],
      });
    });

    it('should handle removing non-existent domain', async () => {
      const mockStorage = getMockBrowserStorage();
      mockStorage.sync.get.mockResolvedValue({
        ignoredDomains: ['keep.com'],
      });
      mockStorage.sync.set.mockResolvedValue(undefined);

      await removeIgnoredDomain('notfound.com');

      expect(mockStorage.sync.set).toHaveBeenCalledWith({
        ignoredDomains: ['keep.com'],
      });
    });
  });
});

describe('Storage Migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('migrateStorageSchema', () => {
    it('should migrate v1 to v2 schema', async () => {
      const v1Data = {
        currentTab: {
          tabId: 123,
          title: 'Current Tab',
          url: 'https://current.com',
        },
        settings: {
          rate: 1.3,
          pitch: 0.9,
          volume: 0.7,
          voice: 'Microsoft Zira',
        },
        schemaVersion: 1,
      };

      mockLocalStorage.get.mockResolvedValue(v1Data);
      mockLocalStorage.set.mockResolvedValue(undefined);

      const migratedQueue = await migrateStorageSchema(v1Data);

      expect(migratedQueue.tabs).toHaveLength(1);
      expect(migratedQueue.tabs[0].tabId).toBe(123);
      expect(migratedQueue.tabs[0].title).toBe('Current Tab');
      expect(migratedQueue.settings.rate).toBe(1.3);
      expect(migratedQueue.currentIndex).toBe(0);
      expect(migratedQueue.status).toBe('idle');

      // Should save migrated data
      expect(mockLocalStorage.set).toHaveBeenCalledWith({
        readingQueue: migratedQueue,
        schemaVersion: 2,
      });
    });

    it('should handle empty v1 data', async () => {
      const v1Data = {
        schemaVersion: 1,
      };

      const migratedQueue = await migrateStorageSchema(v1Data);

      expect(migratedQueue.tabs).toEqual([]);
      expect(migratedQueue.currentIndex).toBe(0);
      expect(migratedQueue.status).toBe('idle');
    });

    it('should return data as-is for v2 schema', async () => {
      const v2Data = {
        readingQueue: {
          tabs: [],
          currentIndex: 0,
          status: 'idle' as const,
          settings: {
            rate: 1.0,
            pitch: 1.0,
            volume: 1.0,
            voice: null,
          },
        },
        schemaVersion: 2,
      };

      const result = await migrateStorageSchema(v2Data);

      expect(result).toEqual(v2Data.readingQueue);
    });
  });
});

describe('StorageManager - AI Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAiSettings', () => {
    it('should return AI settings from storage', async () => {
      const mockStorage = getMockBrowserStorage();
      const mockAiSettings: AiSettings = {
        openRouterApiKey: 'test-api-key',
        openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
        enableAiSummary: true,
        enableAiTranslation: false,
      };

      mockStorage.sync.get.mockResolvedValue({
        ai_settings: mockAiSettings,
      });

      const result = await StorageManager.getAiSettings();

      expect(mockStorage.sync.get).toHaveBeenCalledWith(['ai_settings']);
      expect(result).toEqual(mockAiSettings);
    });

    it('should return default AI settings when no data exists', async () => {
      const mockStorage = getMockBrowserStorage();
      mockStorage.sync.get.mockResolvedValue({});

      const result = await StorageManager.getAiSettings();

      expect(result).toEqual({
        openRouterApiKey: '',
        openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
        enableAiSummary: false,
        enableAiTranslation: false,
      });
    });
  });

  describe('saveAiSettings', () => {
    it('should save AI settings to storage', async () => {
      const mockStorage = getMockBrowserStorage();
      const aiSettings: AiSettings = {
        openRouterApiKey: 'new-api-key',
        openRouterModel: 'gpt-4',
        enableAiSummary: true,
        enableAiTranslation: false,
      };

      mockStorage.sync.set.mockResolvedValue(undefined);

      await StorageManager.saveAiSettings(aiSettings);

      expect(mockStorage.sync.set).toHaveBeenCalledWith({
        ai_settings: aiSettings,
      });
    });

    it('should handle storage errors gracefully', async () => {
      const mockStorage = getMockBrowserStorage();
      const aiSettings: AiSettings = {
        openRouterApiKey: 'test-key',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
      };

      mockStorage.sync.set.mockRejectedValue(new Error('Storage error'));

      await expect(StorageManager.saveAiSettings(aiSettings)).rejects.toThrow(
        'Storage error'
      );
    });
  });

  describe('validateAiSettings', () => {
    it('should return valid settings as-is', () => {
      const validSettings: AiSettings = {
        openRouterApiKey: 'valid-key',
        openRouterModel: 'valid-model',
        enableAiSummary: true,
        enableAiTranslation: true,
      };

      const result = StorageManager.validateAiSettings(validSettings);

      expect(result).toEqual(validSettings);
    });

    it('should apply default values for missing fields', () => {
      const partialSettings: Partial<AiSettings> = {
        enableAiSummary: true,
      };

      const result = StorageManager.validateAiSettings(partialSettings);

      expect(result).toEqual({
        openRouterApiKey: '',
        openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
        enableAiSummary: true,
        enableAiTranslation: false,
      });
    });

    it('should handle empty object', () => {
      const result = StorageManager.validateAiSettings({});

      expect(result).toEqual({
        openRouterApiKey: '',
        openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
        enableAiSummary: false,
        enableAiTranslation: false,
      });
    });

    it('should trim API key', () => {
      const settingsWithWhitespace: AiSettings = {
        openRouterApiKey: '  test-key  ',
        openRouterModel: 'test-model',
        enableAiSummary: false,
        enableAiTranslation: false,
      };

      const result = StorageManager.validateAiSettings(settingsWithWhitespace);

      expect(result.openRouterApiKey).toBe('test-key');
    });
  });
});