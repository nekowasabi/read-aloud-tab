/**
 * usePopupBootstrap.ts
 * Extracted from App.tsx (Process 100)
 *
 * Queries the active tab and loads initial settings on mount.
 */
import { useEffect, useState } from 'react';
import { TTSSettings } from '../../shared/types';
import { StorageManager } from '../../shared/utils/storage';
import { BrowserAdapter } from '../../shared/utils/browser';

const DEFAULT_SETTINGS: TTSSettings = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: null,
};

export interface UsePopupBootstrapResult {
  settings: TTSSettings;
  setSettings: React.Dispatch<React.SetStateAction<TTSSettings>>;
  activeTab: chrome.tabs.Tab | null;
  developerMode: boolean;
  setDeveloperMode: React.Dispatch<React.SetStateAction<boolean>>;
  aiEnabled: boolean;
  summaryWaitMode: 'wait' | 'skip';
  setSummaryWaitMode: React.Dispatch<React.SetStateAction<'wait' | 'skip'>>;
  isLoading: boolean;
  initError: string | null;
}

export function usePopupBootstrap(): UsePopupBootstrapResult {
  const [settings, setSettings] = useState<TTSSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [developerMode, setDeveloperMode] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [summaryWaitMode, setSummaryWaitMode] = useState<'wait' | 'skip'>('wait');
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const browserAPI = BrowserAdapter.getInstance();
        const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });

        if (mounted && tabs[0]) {
          setActiveTab(tabs[0]);
        } else {
          console.warn('[usePopupBootstrap] No active tab found');
        }

        const [savedSettings, devMode, aiSettings] = await Promise.all([
          StorageManager.getSettings(),
          StorageManager.getDeveloperMode(),
          StorageManager.getAiSettings(),
        ]);

        if (mounted) {
          setSettings(savedSettings);
          setDeveloperMode(devMode);
          setAiEnabled(aiSettings.enableAiSummary && Boolean(aiSettings.openRouterApiKey));
          setSummaryWaitMode(aiSettings.summaryWaitMode ?? 'wait');
        }
      } catch (initError) {
        console.error('[usePopupBootstrap] Initialization failed:', initError);
        if (mounted) {
          const errorMsg =
            initError instanceof Error
              ? `初期化に失敗しました: ${(initError as Error).message}`
              : '初期化に失敗しました';
          setInitError(errorMsg);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, []);

  return {
    settings,
    setSettings,
    activeTab,
    developerMode,
    setDeveloperMode,
    aiEnabled,
    summaryWaitMode,
    setSummaryWaitMode,
    isLoading,
    initError,
  };
}
