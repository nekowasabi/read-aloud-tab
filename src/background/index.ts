import { TTSEngine } from './ttsEngine';
import { TabManager } from './tabManager';
import { BackgroundOrchestrator } from './service';
import { TabInfo } from '../shared/types';

const ttsEngine = new TTSEngine();

const tabManager = new TabManager({
  playback: ttsEngine,
});

const orchestrator = new BackgroundOrchestrator({
  tabManager,
});

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
