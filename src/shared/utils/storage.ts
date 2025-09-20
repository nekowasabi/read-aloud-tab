import { TTSSettings, STORAGE_KEYS } from '../types';

export class StorageManager {
  private static readonly DEFAULT_SETTINGS: TTSSettings = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: '',
  };

  static async getSettings(): Promise<TTSSettings> {
    try {
      const result = await chrome.storage.sync.get(STORAGE_KEYS.TTS_SETTINGS);
      return result[STORAGE_KEYS.TTS_SETTINGS] || this.DEFAULT_SETTINGS;
    } catch (error) {
      console.error('Failed to load settings:', error);
      return this.DEFAULT_SETTINGS;
    }
  }

  static async saveSettings(settings: TTSSettings): Promise<void> {
    try {
      await chrome.storage.sync.set({ [STORAGE_KEYS.TTS_SETTINGS]: settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    }
  }

  static async clearSettings(): Promise<void> {
    try {
      await chrome.storage.sync.remove(STORAGE_KEYS.TTS_SETTINGS);
    } catch (error) {
      console.error('Failed to clear settings:', error);
      throw error;
    }
  }

  // 設定の妥当性をチェック
  static validateSettings(settings: Partial<TTSSettings>): TTSSettings {
    return {
      rate: this.clamp(settings.rate || this.DEFAULT_SETTINGS.rate, 0.5, 2.0),
      pitch: this.clamp(settings.pitch || this.DEFAULT_SETTINGS.pitch, 0, 2.0),
      volume: this.clamp(settings.volume || this.DEFAULT_SETTINGS.volume, 0, 1.0),
      voice: settings.voice || this.DEFAULT_SETTINGS.voice,
    };
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}