/**
 * settingsTransfer.ts
 * Extracted from OptionsApp.tsx (Process 100)
 *
 * Pure service functions for exporting and importing settings as JSON.
 * Does NOT hold React state – callers are responsible for updating UI state.
 */
import { STORAGE_KEYS, TTSSettings, AiSettings } from '../../shared/types';
import { StorageManager } from '../../shared/utils/storage';

export interface ExportPayload {
  version: number;
  settings: TTSSettings;
  ignoredDomains: string[];
  aiSettings?: AiSettings;
}

/**
 * Builds an export payload, strips the API key for security, triggers a
 * browser download, and returns the blob for testing purposes.
 */
export async function exportSettings(
  settings: TTSSettings,
  ignoredDomains: string[],
  aiSettings: AiSettings,
): Promise<Blob> {
  const payload: ExportPayload = {
    version: 2,
    settings,
    ignoredDomains,
    aiSettings: {
      ...aiSettings,
      openRouterApiKey: '', // exclude API key for security
    },
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'read-aloud-tab-settings.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return blob;
}

export interface ImportResult {
  settings: TTSSettings;
  ignoredDomains: string[];
  aiSettings?: AiSettings;
}

/**
 * Parses, validates, and persists imported settings JSON.
 * Returns the applied values so callers can update local state.
 */
export async function importSettings(raw: string): Promise<ImportResult> {
  const parsed = JSON.parse(raw) as ExportPayload;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid data');
  }
  if (!parsed.settings || typeof parsed.settings !== 'object') {
    throw new Error('Invalid settings data');
  }
  if (!Array.isArray(parsed.ignoredDomains)) {
    throw new Error('Invalid ignored domains');
  }

  await StorageManager.saveSettings(parsed.settings);
  await chrome.storage.sync.set({ [STORAGE_KEYS.IGNORED_DOMAINS]: parsed.ignoredDomains });

  let validatedAi: AiSettings | undefined;
  if (parsed.aiSettings) {
    validatedAi = StorageManager.validateAiSettings(parsed.aiSettings);
    await StorageManager.saveAiSettings(validatedAi);
  }

  return {
    settings: parsed.settings,
    ignoredDomains: parsed.ignoredDomains,
    aiSettings: validatedAi,
  };
}

/** Reads a File as UTF-8 text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
