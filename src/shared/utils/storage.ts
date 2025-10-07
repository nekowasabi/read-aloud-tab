import { TTSSettings, STORAGE_KEYS, ReadingQueue, TabInfo } from '../types';
import { BrowserAdapter } from './browser';

export class StorageManager {
  private static readonly DEFAULT_SETTINGS: TTSSettings = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: null,
  };

  private static readonly DEFAULT_QUEUE: ReadingQueue = {
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

  private static readonly CURRENT_SCHEMA_VERSION = 2;

  static async getSettings(): Promise<TTSSettings> {
    try {
      const browserAPI = BrowserAdapter.getInstance();
      const result = await browserAPI.storage.sync.get(STORAGE_KEYS.TTS_SETTINGS);
      return result[STORAGE_KEYS.TTS_SETTINGS] || this.DEFAULT_SETTINGS;
    } catch (error) {
      console.error('Failed to load settings:', error);
      return this.DEFAULT_SETTINGS;
    }
  }

  static async saveSettings(settings: TTSSettings): Promise<void> {
    try {
      const browserAPI = BrowserAdapter.getInstance();
      await browserAPI.storage.sync.set({ [STORAGE_KEYS.TTS_SETTINGS]: settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  static async clearSettings(): Promise<void> {
    try {
      const browserAPI = BrowserAdapter.getInstance();
      await browserAPI.storage.sync.remove(STORAGE_KEYS.TTS_SETTINGS);
    } catch (error) {
      console.error('Failed to clear settings:', error);
      throw error;
    }
  }

  // 設定の妥当性をチェック
  static validateSettings(settings: Partial<TTSSettings>): TTSSettings {
    return {
      rate: this.clamp(settings.rate || this.DEFAULT_SETTINGS.rate, 0.5, 3.0),
      pitch: this.clamp(settings.pitch || this.DEFAULT_SETTINGS.pitch, 0, 2.0),
      volume: this.clamp(settings.volume || this.DEFAULT_SETTINGS.volume, 0, 1.0),
      voice: settings.voice || this.DEFAULT_SETTINGS.voice,
    };
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}

// Queue management functions for Phase 2

/**
 * Saves the reading queue to browser storage
 * @param queue - The reading queue to save
 * @throws {Error} When storage operation fails
 */
export async function saveQueue(queue: ReadingQueue): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.READING_QUEUE]: queue,
      [STORAGE_KEYS.SCHEMA_VERSION]: 2,
    });
  } catch (error) {
    console.error('Failed to save reading queue:', error);
    throw error;
  }
}

/**
 * Loads the reading queue from browser storage
 * Handles schema migration from v1 to v2 automatically
 * @returns {Promise<ReadingQueue>} The loaded queue or default empty queue
 */
export async function loadQueue(): Promise<ReadingQueue> {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.READING_QUEUE,
      STORAGE_KEYS.SCHEMA_VERSION,
    ]);

    // Handle schema migration
    if (result[STORAGE_KEYS.SCHEMA_VERSION] === 1) {
      return await migrateStorageSchema(result);
    }

    if (result[STORAGE_KEYS.READING_QUEUE]) {
      // Convert Date strings back to Date objects
      const queue = result[STORAGE_KEYS.READING_QUEUE] as ReadingQueue;
      queue.tabs = queue.tabs.map(tab => ({
        ...tab,
        extractedAt: new Date(tab.extractedAt),
      }));
      return queue;
    }

    return { ...StorageManager['DEFAULT_QUEUE'] };
  } catch (error) {
    console.error('Failed to load reading queue:', error);
    return { ...StorageManager['DEFAULT_QUEUE'] };
  }
}

/**
 * Clears the reading queue from browser storage
 * @throws {Error} When storage operation fails
 */
export async function clearQueue(): Promise<void> {
  try {
    await chrome.storage.local.remove([STORAGE_KEYS.READING_QUEUE]);
  } catch (error) {
    console.error('Failed to clear reading queue:', error);
    throw error;
  }
}

// Ignored domains management

/**
 * Gets the list of ignored domains from storage
 * @returns {Promise<string[]>} Array of ignored domain names
 */
export async function getIgnoredDomains(): Promise<string[]> {
  try {
    const browserAPI = BrowserAdapter.getInstance();
    const result = await browserAPI.storage.sync.get([STORAGE_KEYS.IGNORED_DOMAINS]);
    return result[STORAGE_KEYS.IGNORED_DOMAINS] || [];
  } catch (error) {
    console.error('Failed to get ignored domains:', error);
    return [];
  }
}

/**
 * Adds a domain to the ignored list
 * Automatically normalizes domain to lowercase and handles duplicates
 * @param domain - Domain name to add to ignore list
 * @throws {Error} When storage operation fails
 */
export async function addIgnoredDomain(domain: string): Promise<void> {
  try {
    const normalizedDomain = domain.toLowerCase().trim();
    const currentDomains = await getIgnoredDomains();

    const browserAPI = BrowserAdapter.getInstance();

    if (!currentDomains.includes(normalizedDomain)) {
      currentDomains.push(normalizedDomain);
      await browserAPI.storage.sync.set({
        [STORAGE_KEYS.IGNORED_DOMAINS]: currentDomains,
      });
    } else {
      // Domain already exists, save anyway to ensure consistency
      await browserAPI.storage.sync.set({
        [STORAGE_KEYS.IGNORED_DOMAINS]: currentDomains,
      });
    }
  } catch (error) {
    console.error('Failed to add ignored domain:', error);
    throw error;
  }
}

/**
 * Removes a domain from the ignored list
 * @param domain - Domain name to remove from ignore list
 * @throws {Error} When storage operation fails
 */
export async function removeIgnoredDomain(domain: string): Promise<void> {
  try {
    const normalizedDomain = domain.toLowerCase().trim();
    const currentDomains = await getIgnoredDomains();
    const filteredDomains = currentDomains.filter(d => d !== normalizedDomain);

    const browserAPI = BrowserAdapter.getInstance();
    await browserAPI.storage.sync.set({
      [STORAGE_KEYS.IGNORED_DOMAINS]: filteredDomains,
    });
  } catch (error) {
    console.error('Failed to remove ignored domain:', error);
    throw error;
  }
}

/**
 * Migrates storage schema from v1 to v2
 * @param oldData - Legacy v1 storage data
 * @returns {Promise<ReadingQueue>} Migrated reading queue
 */
export async function migrateStorageSchema(oldData: any): Promise<ReadingQueue> {
  console.log('Migrating storage schema from v1 to v2');

  const migratedQueue: ReadingQueue = {
    tabs: [],
    currentIndex: 0,
    status: 'idle',
    settings: oldData.settings || { ...StorageManager['DEFAULT_SETTINGS'] },
  };

  // Migrate current tab if exists
  if (oldData.currentTab && typeof oldData.currentTab === 'object') {
    const currentTab = oldData.currentTab;
    if (currentTab.tabId && currentTab.url && currentTab.title) {
      const migratedTab: TabInfo = {
        tabId: currentTab.tabId,
        url: currentTab.url,
        title: currentTab.title,
        content: currentTab.text || currentTab.content,
        isIgnored: false,
        extractedAt: new Date(currentTab.extractedAt || Date.now()),
      };
      migratedQueue.tabs.push(migratedTab);
    }
  }

  // Save migrated data
  await saveQueue(migratedQueue);

  return migratedQueue;
}