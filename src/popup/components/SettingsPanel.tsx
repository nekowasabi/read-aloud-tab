import React, { useState, useEffect, useRef } from 'react';
import { TTSSettings } from '../../shared/types';
import IgnoreListManager from './IgnoreListManager';
// === process5 sub4: UI改善（設定パネルに性別フィルター追加）===
import { filterVoices } from '../../shared/utils/voiceSelector';

interface Props {
  settings: TTSSettings;
  onChange: (settings: TTSSettings) => void;
  onClose: () => void;
}

// Debounce delay for settings changes (single 300ms debounce at the component layer)
const SETTINGS_DEBOUNCE_MS = 300;

export default function SettingsPanel({ settings, onChange, onClose }: Props) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [localSettings, setLocalSettings] = useState<TTSSettings>(settings);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<TTSSettings>(settings);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    loadVoices();
  }, []);

  // Do not let a prop echo overwrite an in-flight local value.
  useEffect(() => {
    if (timerRef.current !== null) {
      return;
    }
    setLocalSettings(settings);
    latestRef.current = settings;
  }, [settings]);

  // Flush the pending change on unmount and on pagehide: closing the Chrome
  // popup destroys the page without running React cleanup or the timer.
  useEffect(() => {
    const flush = (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        onChangeRef.current(latestRef.current);
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

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
    const newSettings = { ...latestRef.current, [key]: value } as TTSSettings;
    // Update local state immediately for instant UI feedback
    setLocalSettings(newSettings);
    latestRef.current = newSettings;
    // Debounce actual onChange call to prevent race conditions
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onChangeRef.current(latestRef.current);
    }, SETTINGS_DEBOUNCE_MS);
  };

  const formatValue = (value: number, decimals: number = 1): string => {
    return value.toFixed(decimals);
  };

  // === process5 sub4: UI改善（設定パネルに性別フィルター追加）===
  const getJapaneseVoices = (): SpeechSynthesisVoice[] => {
    return filterVoices(voices, { language: 'ja' });
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>設定</h3>
        <button className="close-btn" onClick={onClose}>
          ×
        </button>
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
                onChange={e => handleSettingChange('rate', parseFloat(e.target.value))}
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
              <span className="setting-label">音量: {Math.round(localSettings.volume * 100)}%</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={localSettings.volume}
                onChange={e => handleSettingChange('volume', parseFloat(e.target.value))}
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
              <span className="setting-label">音の高さ: {formatValue(localSettings.pitch)}</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={localSettings.pitch}
                onChange={e => handleSettingChange('pitch', parseFloat(e.target.value))}
                className="range-input"
              />
              <div className="range-labels">
                <span>低い</span>
                <span>普通</span>
                <span>高い</span>
              </div>
            </label>
          </div>

          {/* === process5 sub4: UI改善（設定パネルに性別フィルター追加）=== */}
          <div className="setting-item">
            <label>
              <span className="setting-label">性別フィルター</span>
              <select
                value={localSettings.preferredGender || 'female'}
                onChange={e => handleSettingChange('preferredGender', e.target.value)}
                className="voice-select"
              >
                <option value="any">すべて</option>
                <option value="female">女性優先</option>
                <option value="male">男性優先</option>
              </select>
            </label>
          </div>

          <div className="setting-item">
            <label>
              <span className="setting-label">音声</span>
              <select
                value={localSettings.voice || ''}
                onChange={e => handleSettingChange('voice', e.target.value)}
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
                    {voices
                      .filter(voice => !getJapaneseVoices().includes(voice))
                      .map(voice => (
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
          <p className="info-text">💡 設定は自動的に保存されます</p>
          {voices.length === 0 && <p className="warning-text">⚠️ 音声リストを読み込み中です...</p>}
        </div>
      </div>
    </div>
  );
}
