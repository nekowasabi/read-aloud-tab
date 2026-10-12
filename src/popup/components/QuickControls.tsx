import React, { useEffect, useRef, useState } from 'react';
import { TTSSettings } from '../../shared/types';

interface Props {
  settings: TTSSettings;
  onChange: (settings: TTSSettings) => void;
}

const DEBOUNCE_MS = 300;

export default function QuickControls({ settings, onChange }: Props) {
  const [localRate, setLocalRate] = useState(settings.rate);
  const [localVolume, setLocalVolume] = useState(settings.volume);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<TTSSettings>(settings);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Ignore parent prop echoes while a local change is pending.
  useEffect(() => {
    if (timerRef.current !== null) {
      return;
    }
    setLocalRate(settings.rate);
    setLocalVolume(settings.volume);
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

  const schedule = (next: TTSSettings): void => {
    latestRef.current = next;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onChangeRef.current(latestRef.current);
    }, DEBOUNCE_MS);
  };

  const handleRateChange = (value: number): void => {
    setLocalRate(value);
    schedule({ ...latestRef.current, rate: value });
  };

  const handleVolumeChange = (value: number): void => {
    setLocalVolume(value);
    schedule({ ...latestRef.current, volume: value });
  };

  return (
    <div className="quick-controls">
      <div className="quick-control-item">
        <label>
          <span className="quick-control-label">🔊 音量: {Math.round(localVolume * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={localVolume}
            onChange={e => handleVolumeChange(parseFloat(e.target.value))}
            className="range-input"
          />
        </label>
      </div>

      <div className="quick-control-item">
        <label>
          <span className="quick-control-label">⚡ 速度: {localRate.toFixed(1)}x</span>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={localRate}
            onChange={e => handleRateChange(parseFloat(e.target.value))}
            className="range-input"
          />
        </label>
      </div>
    </div>
  );
}
