/**
 * usePopupSettingsSync.ts
 * Extracted from App.tsx (Process 100)
 *
 * Listens to chrome.storage.onChanged and propagates TTS settings and
 * developer-mode changes to local state.
 */
import { useEffect } from 'react';
import { TTSSettings } from '../../shared/types';
import { STORAGE_KEYS } from '../../shared/types';

export interface UsePopupSettingsSyncOptions {
  onSettingsChange: (settings: TTSSettings) => void;
  onDeveloperModeChange: (enabled: boolean) => void;
}

export function usePopupSettingsSync({
  onSettingsChange,
  onDeveloperModeChange,
}: UsePopupSettingsSyncOptions): void {
  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'sync') return;
      if (changes.tts_settings?.newValue) {
        onSettingsChange(changes.tts_settings.newValue as TTSSettings);
      }
      if (changes[STORAGE_KEYS.DEVELOPER_MODE]) {
        onDeveloperModeChange(Boolean(changes[STORAGE_KEYS.DEVELOPER_MODE].newValue));
      }
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    } else if (typeof browser !== 'undefined' && (browser as any).storage) {
      (browser as any).storage.onChanged.addListener(handleStorageChange);
      return () => {
        (browser as any).storage.onChanged.removeListener(handleStorageChange);
      };
    }
    return undefined;
  }, [onSettingsChange, onDeveloperModeChange]);
}
