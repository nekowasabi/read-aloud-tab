import React, { useMemo } from 'react';
import { TTSSettings } from '../../shared/types';

interface Props {
  settings: TTSSettings;
  onChange: (settings: TTSSettings) => void;
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

export default function QuickControls({ settings, onChange }: Props) {
  // Create debounced onChange handler (300ms delay, same as SettingsPanel)
  const debouncedOnChange = useMemo(() => debounce(onChange, 300), [onChange]);

  const handleSettingChange = (key: keyof TTSSettings, value: number) => {
    const newSettings = { ...settings, [key]: value };
    debouncedOnChange(newSettings);
  };

  return (
    <div className="quick-controls">
      <div className="quick-control-item">
        <label>
          <span className="quick-control-label">
            🔊 音量: {Math.round(settings.volume * 100)}%
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={settings.volume}
            onChange={(e) => handleSettingChange('volume', parseFloat(e.target.value))}
            className="range-input"
          />
        </label>
      </div>

      <div className="quick-control-item">
        <label>
          <span className="quick-control-label">
            ⚡ 速度: {settings.rate.toFixed(1)}x
          </span>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={settings.rate}
            onChange={(e) => handleSettingChange('rate', parseFloat(e.target.value))}
            className="range-input"
          />
        </label>
      </div>
    </div>
  );
}
