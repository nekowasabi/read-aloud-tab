import React, { useEffect, useState } from 'react';
import IgnoreListManager from '../popup/components/IgnoreListManager';
import { StorageManager } from '../shared/utils/storage';
import { getIgnoredDomains } from '../shared/utils/storage';
import { STORAGE_KEYS, TTSSettings, AiSettings } from '../shared/types';

interface ExportPayload {
  version: number;
  settings: TTSSettings;
  ignoredDomains: string[];
  aiSettings?: AiSettings;
}

const DEFAULT_SETTINGS: TTSSettings = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: null,
};

const DEFAULT_AI_SETTINGS: AiSettings = {
  openRouterApiKey: '',
  openRouterModel: 'meta-llama/llama-3.2-1b-instruct',
  enableAiSummary: false,
  enableAiTranslation: false,
};

export default function OptionsApp() {
  const [settings, setSettings] = useState<TTSSettings>(DEFAULT_SETTINGS);
  const [ignoredDomains, setIgnoredDomains] = useState<string[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [exportData, setExportData] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const [loadedSettings, domains, loadedAiSettings] = await Promise.all([
        StorageManager.getSettings(),
        getIgnoredDomains(),
        StorageManager.getAiSettings(),
      ]);
      setSettings(loadedSettings);
      setIgnoredDomains(domains);
      setAiSettings(loadedAiSettings);
    } catch (error) {
      console.error('OptionsApp: failed to load data', error);
      setMessage('設定の読み込みに失敗しました');
    }
  };

  const handleSettingChange = async (key: keyof TTSSettings, value: number | string | null) => {
    const updated: TTSSettings = {
      ...settings,
      [key]: value,
    } as TTSSettings;

    setSettings(updated);

    try {
      await StorageManager.saveSettings(updated);
      setMessage('設定を保存しました');
    } catch (error) {
      console.error('OptionsApp: failed to save settings', error);
      setMessage('設定の保存に失敗しました');
    }
  };

  const handleAiSettingChange = async (key: keyof AiSettings, value: string | boolean) => {
    const updated: AiSettings = {
      ...aiSettings,
      [key]: value,
    };

    setAiSettings(updated);

    try {
      await StorageManager.saveAiSettings(updated);
      setMessage('AI設定を保存しました');
    } catch (error) {
      console.error('OptionsApp: failed to save AI settings', error);
      setMessage('AI設定の保存に失敗しました');
    }
  };

  const handleExport = async () => {
    try {
      const payload: ExportPayload = {
        version: 2,
        settings,
        ignoredDomains,
        aiSettings: {
          ...aiSettings,
          openRouterApiKey: '', // セキュリティのためAPIキーは除外
        },
      };
      setExportData(JSON.stringify(payload));
      setMessage('エクスポートデータを生成しました');
    } catch (error) {
      console.error('OptionsApp: failed to export data', error);
      setMessage('エクスポートに失敗しました');
    }
  };

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(exportData) as ExportPayload;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid data');
      }

      await StorageManager.saveSettings(parsed.settings);
      await chrome.storage.sync.set({ [STORAGE_KEYS.IGNORED_DOMAINS]: parsed.ignoredDomains });

      if (parsed.aiSettings) {
        await StorageManager.saveAiSettings(parsed.aiSettings);
        setAiSettings(parsed.aiSettings);
      }

      setSettings(parsed.settings);
      setIgnoredDomains(parsed.ignoredDomains);
      setMessage('インポートが完了しました');
    } catch (error) {
      console.error('OptionsApp: failed to import data', error);
      setMessage('インポートに失敗しました。データ形式を確認してください');
    }
  };

  const handleIgnoreListChange = (domains: string[]) => {
    setIgnoredDomains(domains);
  };

  return (
    <div className="options-container">
      <header className="options-header">
        <h1>Read Aloud Tab 設定</h1>
        <p>読み上げ体験をカスタマイズします。</p>
      </header>

      {message && (
        <div className="options-message" role="status">
          {message}
        </div>
      )}

      <section className="options-section">
        <h2>音声設定</h2>
        <div className="setting-item">
          <label htmlFor="rate">読み上げ速度</label>
          <input
            id="rate"
            type="number"
            min={0.5}
            max={3}
            step={0.1}
            value={settings.rate}
            onChange={(event) => handleSettingChange('rate', parseFloat(event.target.value))}
          />
        </div>
        <div className="setting-item">
          <label htmlFor="pitch">音の高さ</label>
          <input
            id="pitch"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={settings.pitch}
            onChange={(event) => handleSettingChange('pitch', parseFloat(event.target.value))}
          />
        </div>
        <div className="setting-item">
          <label htmlFor="volume">音量</label>
          <input
            id="volume"
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={settings.volume}
            onChange={(event) => handleSettingChange('volume', parseFloat(event.target.value))}
          />
        </div>
        <div className="setting-item">
          <label htmlFor="voice">音声</label>
          <input
            id="voice"
            type="text"
            value={settings.voice ?? ''}
            onChange={(event) => handleSettingChange('voice', event.target.value || null)}
            placeholder="システムデフォルト"
          />
        </div>
      </section>

      <section className="options-section">
        <h2>無視リスト</h2>
        <IgnoreListManager onChange={handleIgnoreListChange} />
      </section>

      <section className="options-section">
        <h2>AI 要約設定</h2>
        <div className="setting-item">
          <label htmlFor="enableAiSummary">
            <input
              id="enableAiSummary"
              type="checkbox"
              checked={aiSettings.enableAiSummary}
              onChange={(event) => handleAiSettingChange('enableAiSummary', event.target.checked)}
              aria-label="AI要約を有効化"
            />
            AI要約を有効化
          </label>
        </div>
        <div className="setting-item">
          <label htmlFor="enableAiTranslation">
            <input
              id="enableAiTranslation"
              type="checkbox"
              checked={aiSettings.enableAiTranslation}
              onChange={(event) => handleAiSettingChange('enableAiTranslation', event.target.checked)}
              aria-label="AI翻訳を有効化"
            />
            AI翻訳を有効化
          </label>
        </div>
        <div className="setting-item">
          <label htmlFor="openRouterApiKey">OpenRouter APIキー</label>
          <input
            id="openRouterApiKey"
            type="password"
            value={aiSettings.openRouterApiKey}
            onChange={(event) => handleAiSettingChange('openRouterApiKey', event.target.value)}
            placeholder="sk-or-..."
            aria-label="OpenRouter APIキー"
          />
        </div>
        <div className="setting-item">
          <label htmlFor="openRouterModel">OpenRouterモデル名</label>
          <input
            id="openRouterModel"
            type="text"
            value={aiSettings.openRouterModel}
            onChange={(event) => handleAiSettingChange('openRouterModel', event.target.value)}
            placeholder="meta-llama/llama-3.2-1b-instruct"
            aria-label="OpenRouterモデル名"
          />
        </div>
      </section>

      <section className="options-section">
        <h2>エクスポート / インポート</h2>
        <div className="export-actions">
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            エクスポート
          </button>
          <button type="button" className="btn btn-primary" onClick={handleImport}>
            インポート
          </button>
        </div>
        <label htmlFor="export-data" className="textarea-label">
          エクスポートデータ
        </label>
        <textarea
          id="export-data"
          aria-label="エクスポートデータ"
          value={exportData}
          onChange={(event) => setExportData(event.target.value)}
          placeholder='{"version":2,"settings":{...}}'
          rows={8}
          className="export-textarea"
        />
      </section>

      <section className="options-section">
        <h2>キーボードショートカット</h2>
        <p>以下のショートカットはブラウザ側の設定画面で変更できます（Chrome: <code>chrome://extensions/shortcuts</code>）。</p>
        <ul className="shortcut-list">
          <li><code>Ctrl+Shift+S</code> / <code>Command+Shift+S</code>: 読み上げを開始</li>
          <li><code>Ctrl+Shift+X</code> / <code>Command+Shift+X</code>: 読み上げを停止</li>
          <li><code>Ctrl+Shift+.</code> / <code>Command+Shift+.</code>: 次のタブへ移動</li>
          <li><code>Ctrl+Shift+,</code> / <code>Command+Shift+,</code>: 前のタブへ移動</li>
          <li><code>Ctrl+Shift+Z</code> / <code>Command+Shift+Z</code>: 一時停止</li>
          <li><code>Ctrl+Shift+R</code> / <code>Command+Shift+R</code>: 再開</li>
        </ul>
      </section>
    </div>
  );
}
