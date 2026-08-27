import { TTSEngine } from './ttsEngine';
import { TabManager } from './tabManager';
import { BackgroundOrchestrator } from './service';
import { AiPrefetcher } from './aiPrefetcher';
import { TabInfo } from '../shared/types';
import { AutoQueueManager } from './autoQueueManager';

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

const autoQueueManager = new AutoQueueManager(tabManager, (tab, ignored) =>
  orchestrator.isTabQueueCandidate(tab, ignored)
);

orchestrator.initialize().catch(error => {
  console.error('Failed to initialize Read Aloud Tab background service', error);
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await tabManager.refreshIgnoredDomains();
  } catch (error) {
    console.warn('Failed to refresh ignored domains on install', error);
  }
});

if (chrome.runtime.onStartup)
  chrome.runtime.onStartup.addListener(() => autoQueueManager.onStartup());

// Listen for storage changes to refresh ignored domains (Chrome/Firefox)
const handleStorageChange = (changes: any, areaName: string) => {
  if (
    areaName === 'sync' &&
    changes.autoQueueNewTabs &&
    typeof changes.autoQueueNewTabs.newValue === 'boolean'
  ) {
    autoQueueManager.onSettingChanged(changes.autoQueueNewTabs.newValue);
  }
  if (areaName === 'sync' && changes.ignoredDomains) {
    tabManager.refreshIgnoredDomains().catch(error => {
      console.warn('Failed to refresh ignored domains on change', error);
    });
  }
};

if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener(handleStorageChange);
} else if (typeof browser !== 'undefined' && browser.storage) {
  browser.storage.onChanged.addListener(handleStorageChange);
}

chrome.tabs.onRemoved.addListener(tabId => {
  autoQueueManager.onRemoved(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  autoQueueManager.onUpdated(tabId, { ...tab, url: changeInfo.url ?? tab.url });
  if (!tab.url) {
    return;
  }

  if (changeInfo.status === 'loading') {
    tabManager.onTabLoading(tabId).catch(error => {
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
    tabManager.onTabUpdated(tabId, update).catch(error => {
      console.warn('Failed to handle tab update', error);
    });
  }
});

chrome.tabs.onCreated.addListener(tab => autoQueueManager.onCreated(tab));

export {}; // Keep the file as a module
