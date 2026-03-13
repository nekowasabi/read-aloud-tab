/**
 * useOptionsData.ts
 * Extracted from OptionsApp.tsx (Process 100)
 *
 * Loads TTS settings, ignored domains, AI settings and developer mode flag
 * from storage on mount.
 */
import { useEffect, useState } from 'react';
import { TTSSettings, AiSettings } from '../../shared/types';
import { StorageManager, getIgnoredDomains } from '../../shared/utils/storage';

const DEFAULT_SETTINGS: TTSSettings = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: null,
};

const DEFAULT_AI_SETTINGS: AiSettings = StorageManager.validateAiSettings({});

export interface UseOptionsDataResult {
  settings: TTSSettings;
  ignoredDomains: string[];
  aiSettings: AiSettings;
  developerMode: boolean;
  isLoading: boolean;
  loadError: string | null;
  setSettings: React.Dispatch<React.SetStateAction<TTSSettings>>;
  setIgnoredDomains: React.Dispatch<React.SetStateAction<string[]>>;
  setAiSettings: React.Dispatch<React.SetStateAction<AiSettings>>;
  setDeveloperMode: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useOptionsData(): UseOptionsDataResult {
  const [settings, setSettings] = useState<TTSSettings>(DEFAULT_SETTINGS);
  const [ignoredDomains, setIgnoredDomains] = useState<string[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [developerMode, setDeveloperMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [loadedSettings, domains, loadedAiSettings, devModeFlag] = await Promise.all([
          StorageManager.getSettings(),
          getIgnoredDomains(),
          StorageManager.getAiSettings(),
          StorageManager.getDeveloperMode(),
        ]);
        if (!mounted) return;
        setSettings(loadedSettings);
        setIgnoredDomains(domains);
        setAiSettings(loadedAiSettings);
        setDeveloperMode(devModeFlag);
      } catch (error) {
        console.error('[useOptionsData] failed to load data', error);
        if (mounted) setLoadError('設定の読み込みに失敗しました');
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return {
    settings,
    ignoredDomains,
    aiSettings,
    developerMode,
    isLoading,
    loadError,
    setSettings,
    setIgnoredDomains,
    setAiSettings,
    setDeveloperMode,
  };
}
