import { TTSEngine } from './ttsEngine';
import { TabManager } from './tabManager';
import { BackgroundOrchestrator } from './service';
import { AiPrefetcher } from './aiPrefetcher';
import { TabInfo } from '../shared/types';

const ttsEngine = new TTSEngine();

const tabManager = new TabManager({
  playback: ttsEngine,
});

const aiPrefetcher = new AiPrefetcher({
  tabManager,
  logger: console,
  maxPrefetchAhead: 1,
});

const orchestrator = new BackgroundOrchestrator({
  tabManager,
  prefetcher: aiPrefetcher,
});

aiPrefetcher.initialize();

orchestrator.initialize().catch((error) => {
  console.error('Failed to initialize Read Aloud Tab background service', error);
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await tabManager.refreshIgnoredDomains();
  } catch (error) {
    console.warn('Failed to refresh ignored domains on install', error);
  }
});

// Listen for storage changes to refresh ignored domains (Chrome/Firefox)
const handleStorageChange = (changes: any, areaName: string) => {
  if (areaName === 'sync' && changes.ignoredDomains) {
    tabManager.refreshIgnoredDomains().catch((error) => {
      console.warn('Failed to refresh ignored domains on change', error);
    });
  }
};

if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener(handleStorageChange);
} else if (typeof browser !== 'undefined' && browser.storage) {
  browser.storage.onChanged.addListener(handleStorageChange);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabManager.onTabClosed(tabId).catch((error) => {
    console.warn('Failed to handle tab removal', error);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url) {
    return;
  }

  if (changeInfo.status === 'loading') {
    tabManager.onTabLoading(tabId).catch((error) => {
      console.warn('Failed to handle tab loading', error);
    });
  }

  const update: Partial<Pick<TabInfo, 'title' | 'url'>> = {
    url: tab.url,
  };

  if (typeof tab.title === 'string') {
    update.title = tab.title;
  }

  if (changeInfo.status === 'complete') {
    tabManager.onTabUpdated(tabId, update).catch((error) => {
      console.warn('Failed to handle tab update', error);
    });
  }
});

export {}; // Keep the file as a module
