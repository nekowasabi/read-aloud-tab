/**
 * useAddTabsActions.ts
 * Extracted from App.tsx (Process 100)
 *
 * Provides add-current-tab and add-all-tabs actions with filtering logic.
 */
import { useCallback } from 'react';
import { BrowserAdapter } from '../../shared/utils/browser';
import { getIgnoredDomains } from '../../shared/utils/storage';
import { QueueTabInput } from '../../shared/messages';

type AddTabFn = (tab: QueueTabInput) => Promise<void>;

export interface UseAddTabsActionsResult {
  handleAddCurrentTab: (activeTab: chrome.tabs.Tab | null) => Promise<string | null>;
  handleAddAllTabs: () => Promise<string | null>;
}

export function useAddTabsActions(addTab: AddTabFn): UseAddTabsActionsResult {
  const handleAddCurrentTab = useCallback(
    async (activeTab: chrome.tabs.Tab | null): Promise<string | null> => {
      if (!activeTab || typeof activeTab.id !== 'number' || !activeTab.url) {
        return '追加できるタブが見つかりません';
      }
      try {
        await addTab({
          tabId: activeTab.id,
          url: activeTab.url,
          title: activeTab.title || activeTab.url,
        });
        return null;
      } catch (commandError) {
        console.error('Failed to add tab to queue:', commandError);
        return commandError instanceof Error ? commandError.message : 'キューへの追加に失敗しました';
      }
    },
    [addTab],
  );

  const handleAddAllTabs = useCallback(async (): Promise<string | null> => {
    try {
      const browserAPI = BrowserAdapter.getInstance();
      const tabs = await browserAPI.tabs.query({ currentWindow: true });
      const ignoredDomains = await getIgnoredDomains();
      const ignoredSet = new Set(ignoredDomains.map((d) => d.toLowerCase()));

      const validTabs = tabs.filter((tab) => {
        if (!tab.id || !tab.url) return false;
        if (
          tab.url.startsWith('chrome://') ||
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('about:')
        ) {
          return false;
        }
        try {
          const url = new URL(tab.url);
          if (ignoredSet.has(url.hostname.toLowerCase())) return false;
        } catch {
          return false;
        }
        return true;
      });

      if (validTabs.length === 0) {
        return '追加できるタブがありません';
      }

      let successCount = 0;
      for (const tab of validTabs) {
        try {
          await addTab({
            tabId: tab.id!,
            url: tab.url!,
            title: tab.title || tab.url!,
          });
          successCount++;
        } catch (tabError) {
          console.error('Failed to add tab:', tab.id, tabError);
        }
      }

      return successCount > 0
        ? `${successCount}個のタブをキューに追加しました`
        : 'タブの追加に失敗しました';
    } catch (commandError) {
      console.error('Failed to add all tabs:', commandError);
      return commandError instanceof Error
        ? commandError.message
        : 'すべてのタブの追加に失敗しました';
    }
  }, [addTab]);

  return { handleAddCurrentTab, handleAddAllTabs };
}
