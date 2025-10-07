import React, { useState, useEffect, useMemo } from 'react';
import { TTSSettings } from '../../shared/types';
import IgnoreListManager from './IgnoreListManager';

interface Props {
  settings: TTSSettings;
  onChange: (settings: TTSSettings) => void;
  onClose: () => void;
}

// Debounce function to prevent rapid successive calls
function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
}

export default function SettingsPanel({ settings, onChange, onClose }: Props) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [localSettings, setLocalSettings] = useState<TTSSettings>(settings);

  // Create debounced onChange handler (300ms delay)
  const debouncedOnChange = useMemo(() => debounce(onChange, 300), [onChange]);

  useEffect(() => {
    loadVoices();
    // 親のsettingsが変更された場合、ローカルの状態も更新
    setLocalSettings(settings);
  }, [settings]);

  const loadVoices = () => {
    const loadAvailableVoices = () => {
      const availableVoices = speechSynthesis.getVoices();
      setVoices(availableVoices);
    };

    loadAvailableVoices();

    // 音声リストの読み込みが非同期の場合に対応
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadAvailableVoices;
    }
  };

  const handleSettingChange = (key: keyof TTSSettings, value: number | string) => {
    const newSettings = { ...localSettings, [key]: value };
    // Update local state immediately for instant UI feedback
    setLocalSettings(newSettings);
    // Debounce actual onChange call to prevent race conditions
    debouncedOnChange(newSettings);
  };

  const formatValue = (value: number, decimals: number = 1): string => {
    return value.toFixed(decimals);
  };

  const getJapaneseVoices = (): SpeechSynthesisVoice[] => {
    return voices.filter(voice =>
      voice.lang.startsWith('ja') ||
      voice.lang.includes('JP') ||
      voice.name.includes('Japanese') ||
      voice.name.includes('日本')
    );
  };

  const getAllVoices = (): SpeechSynthesisVoice[] => {
    const japaneseVoices = getJapaneseVoices();
    const otherVoices = voices.filter(voice => !japaneseVoices.includes(voice));
    return [...japaneseVoices, ...otherVoices];
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>設定</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="settings-content">
        <div className="setting-group">
          <div className="setting-item">
            <label>
              <span className="setting-label">
                読み上げ速度: {formatValue(localSettings.rate)}x
              </span>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={localSettings.rate}
                onChange={(e) => handleSettingChange('rate', parseFloat(e.target.value))}
                className="range-input"
              />
              <div className="range-labels">
                <span>遅い</span>
                <span>普通</span>
                <span>速い</span>
              </div>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <span className="setting-label">
                音量: {Math.round(localSettings.volume * 100)}%
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={localSettings.volume}
                onChange={(e) => handleSettingChange('volume', parseFloat(e.target.value))}
                className="range-input"
              />
              <div className="range-labels">
                <span>小</span>
                <span>中</span>
                <span>大</span>
              </div>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <span className="setting-label">
                音の高さ: {formatValue(localSettings.pitch)}
              </span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={localSettings.pitch}
                onChange={(e) => handleSettingChange('pitch', parseFloat(e.target.value))}
                className="range-input"
              />
              <div className="range-labels">
                <span>低い</span>
                <span>普通</span>
                <span>高い</span>
              </div>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <span className="setting-label">音声</span>
              <select
                value={localSettings.voice || ''}
                onChange={(e) => handleSettingChange('voice', e.target.value)}
                className="voice-select"
              >
                <option value="">デフォルト</option>
                {getJapaneseVoices().length > 0 && (
                  <optgroup label="日本語音声">
                    {getJapaneseVoices().map(voice => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </optgroup>
                )}
                {voices.filter(voice => !getJapaneseVoices().includes(voice)).length > 0 && (
                  <optgroup label="その他の音声">
                    {voices.filter(voice => !getJapaneseVoices().includes(voice)).map(voice => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          </div>
        </div>

        <div className="settings-subsection">
          <h4>無視リスト</h4>
          <IgnoreListManager />
        </div>

        <div className="settings-info">
          <p className="info-text">
            💡 設定は自動的に保存されます
          </p>
          {voices.length === 0 && (
            <p className="warning-text">
              ⚠️ 音声リストを読み込み中です...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
